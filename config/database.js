const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'skin_analyser',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Initialize database with all tables, views, triggers, and seed data
async function initializeDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        const DB = process.env.DB_NAME || 'skin_analyser';
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\``);
        await connection.query(`USE \`${DB}\``);

        // ==================== DDL: CREATE TABLES ====================

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Skin_Type (
                skin_type_id INT AUTO_INCREMENT PRIMARY KEY,
                skin_type_name ENUM('Oily', 'Dry', 'Combination', 'Sensitive', 'Normal') NOT NULL UNIQUE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                user_id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                age INT NOT NULL,
                gender ENUM('Male', 'Female', 'Other') NOT NULL,
                skin_type_id INT,
                role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
                registration_date DATE DEFAULT (CURRENT_DATE),
                FOREIGN KEY (skin_type_id) REFERENCES Skin_Type(skin_type_id) ON DELETE SET NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Products (
                product_id INT AUTO_INCREMENT PRIMARY KEY,
                product_name VARCHAR(200) NOT NULL,
                brand VARCHAR(100) NOT NULL,
                category ENUM('Cleanser', 'Moisturizer', 'Sunscreen', 'Serum', 'Toner') NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                description TEXT,
                image_url VARCHAR(500) DEFAULT NULL,
                expiry_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Ingredients (
                ingredient_id INT AUTO_INCREMENT PRIMARY KEY,
                ingredient_name VARCHAR(150) NOT NULL UNIQUE,
                safety_level ENUM('Safe', 'Moderate', 'High Risk') NOT NULL DEFAULT 'Safe',
                description TEXT
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Product_Ingredients (
                product_id INT NOT NULL,
                ingredient_id INT NOT NULL,
                PRIMARY KEY (product_id, ingredient_id),
                FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE,
                FOREIGN KEY (ingredient_id) REFERENCES Ingredients(ingredient_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Reviews (
                review_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                product_id INT NOT NULL,
                rating INT NOT NULL,
                comment TEXT,
                review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Recommendations (
                recommendation_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                product_id INT NOT NULL,
                skin_issue VARCHAR(200) NOT NULL,
                recommendation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Deleted_Products_Audit (
                audit_id INT AUTO_INCREMENT PRIMARY KEY,
                product_id INT,
                product_name VARCHAR(200),
                brand VARCHAR(100),
                category VARCHAR(50),
                price DECIMAL(10,2),
                expiry_date DATE,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_by VARCHAR(100) DEFAULT 'system'
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Analysis_History (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                image_path VARCHAR(500) NOT NULL,
                analysis_result LONGTEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
            )
        `);

        // ==================== VIEWS ====================

        await connection.query(`
            CREATE OR REPLACE VIEW ProductSummary AS
            SELECT 
                p.product_id, p.product_name, p.brand, p.category, p.price, p.expiry_date,
                COALESCE(ROUND(AVG(r.rating), 2), 0) AS avg_rating,
                COUNT(DISTINCT r.review_id) AS review_count,
                COUNT(DISTINCT pi.ingredient_id) AS ingredient_count
            FROM Products p
            LEFT JOIN Reviews r ON p.product_id = r.product_id
            LEFT JOIN Product_Ingredients pi ON p.product_id = pi.product_id
            GROUP BY p.product_id, p.product_name, p.brand, p.category, p.price, p.expiry_date
        `);

        await connection.query(`
            CREATE OR REPLACE VIEW UserRecommendations AS
            SELECT 
                u.user_id, u.name AS user_name, u.email,
                p.product_id, p.product_name, p.brand, p.category, p.price,
                rec.skin_issue, rec.recommendation_date, rec.recommendation_id
            FROM Recommendations rec
            JOIN Users u ON rec.user_id = u.user_id
            JOIN Products p ON rec.product_id = p.product_id
        `);

        await connection.query(`
            CREATE OR REPLACE VIEW RiskyIngredients AS
            SELECT 
                p.product_id, p.product_name, p.brand,
                i.ingredient_id, i.ingredient_name, i.safety_level, i.description AS ingredient_description
            FROM Products p
            JOIN Product_Ingredients pi ON p.product_id = pi.product_id
            JOIN Ingredients i ON pi.ingredient_id = i.ingredient_id
            WHERE i.safety_level = 'High Risk'
        `);

        await connection.query(`
            CREATE OR REPLACE VIEW RecentReviews AS
            SELECT 
                r.review_id, u.user_id, u.name AS user_name, u.email,
                p.product_id, p.product_name, p.brand, r.rating, r.comment, r.review_date
            FROM Reviews r
            JOIN Users u ON r.user_id = u.user_id
            JOIN Products p ON r.product_id = p.product_id
            ORDER BY r.review_date DESC
            LIMIT 50
        `);

        // ==================== TRIGGERS ====================

        // Drop existing triggers first
        await connection.query(`DROP TRIGGER IF EXISTS prevent_review_on_expired_product`);
        await connection.query(`DROP TRIGGER IF EXISTS update_recommendation_timestamp`);
        await connection.query(`DROP TRIGGER IF EXISTS log_deleted_product`);
        await connection.query(`DROP TRIGGER IF EXISTS prevent_duplicate_review`);

        await connection.query(`
            CREATE TRIGGER prevent_review_on_expired_product
            BEFORE INSERT ON Reviews
            FOR EACH ROW
            BEGIN
                DECLARE prod_expiry DATE;
                SELECT expiry_date INTO prod_expiry FROM Products WHERE product_id = NEW.product_id;
                IF prod_expiry IS NOT NULL AND prod_expiry < CURDATE() THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot review an expired product';
                END IF;
            END
        `);

        await connection.query(`
            CREATE TRIGGER update_recommendation_timestamp
            BEFORE UPDATE ON Recommendations
            FOR EACH ROW
            BEGIN
                SET NEW.recommendation_date = CURRENT_TIMESTAMP;
            END
        `);

        await connection.query(`
            CREATE TRIGGER log_deleted_product
            BEFORE DELETE ON Products
            FOR EACH ROW
            BEGIN
                INSERT INTO Deleted_Products_Audit (product_id, product_name, brand, category, price, expiry_date)
                VALUES (OLD.product_id, OLD.product_name, OLD.brand, OLD.category, OLD.price, OLD.expiry_date);
            END
        `);

        await connection.query(`
            CREATE TRIGGER prevent_duplicate_review
            BEFORE INSERT ON Reviews
            FOR EACH ROW
            BEGIN
                DECLARE review_count INT;
                SELECT COUNT(*) INTO review_count FROM Reviews WHERE user_id = NEW.user_id AND product_id = NEW.product_id;
                IF review_count > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You have already reviewed this product';
                END IF;
            END
        `);

        // ==================== SEED DATA ====================

        // Check if data already exists
        const [skinCheck] = await connection.query('SELECT COUNT(*) as cnt FROM Skin_Type');
        if (skinCheck[0].cnt === 0) {
            console.log('📦 Seeding database with sample data...');

            // Skin Types
            await connection.query(`INSERT INTO Skin_Type (skin_type_name) VALUES ('Oily'),('Dry'),('Combination'),('Sensitive'),('Normal')`);

            // Admin user (password: admin123)
            const adminHash = await bcrypt.hash('admin123', 12);
            await connection.query(
                `INSERT INTO Users (name, email, password, age, gender, skin_type_id, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['Admin User', 'admin@skincare.com', adminHash, 30, 'Other', 5, 'admin']
            );

            // 55 Sample Users
            const userHash = await bcrypt.hash('password123', 12);
            const userNames = [
                ['Aarav Sharma', 'Male', 1], ['Priya Patel', 'Female', 2], ['Rahul Kumar', 'Male', 3],
                ['Ananya Singh', 'Female', 4], ['Vikram Reddy', 'Male', 5], ['Sneha Gupta', 'Female', 1],
                ['Arjun Nair', 'Male', 2], ['Divya Joshi', 'Female', 3], ['Karthik Menon', 'Male', 4],
                ['Meera Iyer', 'Female', 5], ['Rohan Desai', 'Male', 1], ['Pooja Verma', 'Female', 2],
                ['Aditya Rao', 'Male', 3], ['Kavya Krishnan', 'Female', 4], ['Siddharth Banerjee', 'Male', 5],
                ['Riya Chopra', 'Female', 1], ['Nikhil Agarwal', 'Male', 2], ['Ishita Malhotra', 'Female', 3],
                ['Varun Saxena', 'Male', 4], ['Nisha Kapoor', 'Female', 5], ['Manish Dubey', 'Male', 1],
                ['Swati Kulkarni', 'Female', 2], ['Deepak Mishra', 'Male', 3], ['Anjali Tiwari', 'Female', 4],
                ['Amit Pandey', 'Male', 5], ['Shruti Bhatt', 'Female', 1], ['Raj Singhania', 'Male', 2],
                ['Tanvi Mehta', 'Female', 3], ['Gaurav Shetty', 'Male', 4], ['Neha Pillai', 'Female', 5],
                ['Akash Bhat', 'Male', 1], ['Simran Kaur', 'Female', 2], ['Pranav Goyal', 'Male', 3],
                ['Aditi Chauhan', 'Female', 4], ['Suresh Naidu', 'Male', 5], ['Pallavi Deshpande', 'Female', 1],
                ['Harsh Trivedi', 'Male', 2], ['Megha Rastogi', 'Female', 3], ['Vivek Choudhary', 'Male', 4],
                ['Sakshi Ahuja', 'Female', 5], ['Om Prakash', 'Male', 1], ['Jyoti Srivastava', 'Female', 2],
                ['Kunal Thakur', 'Male', 3], ['Reema Bajaj', 'Female', 4], ['Tarun Hegde', 'Male', 5],
                ['Bhavna Parmar', 'Female', 1], ['Ashwin Nambiar', 'Male', 2], ['Kritika Sethi', 'Female', 3],
                ['Sanjay Mistry', 'Male', 4], ['Aparna George', 'Female', 5],
                ['Ravi Shankar', 'Male', 1], ['Lakshmi Sundaram', 'Female', 2], ['Naveen Jain', 'Male', 3],
                ['Diya Fernandes', 'Female', 4], ['Mohan Das', 'Male', 5]
            ];

            for (let i = 0; i < userNames.length; i++) {
                const [n, g, st] = userNames[i];
                const age = 18 + Math.floor(Math.random() * 35);
                const email = n.toLowerCase().replace(/\s+/g, '.') + '@email.com';
                await connection.query(
                    `INSERT INTO Users (name, email, password, age, gender, skin_type_id, role) VALUES (?, ?, ?, ?, ?, ?, 'user')`,
                    [n, email, userHash, age, g, st]
                );
            }

            // 55 Products
            await connection.query(`
                INSERT INTO Products (product_name, brand, category, price, description, expiry_date) VALUES
                ('Gentle Foaming Cleanser', 'CeraVe', 'Cleanser', 14.99, 'A gentle foaming cleanser with ceramides and niacinamide', '2027-06-15'),
                ('Hydrating Facial Cleanser', 'CeraVe', 'Cleanser', 15.99, 'Cream-to-foam cleanser for normal to dry skin', '2027-08-20'),
                ('Salicylic Acid Cleanser', 'Paulas Choice', 'Cleanser', 12.50, 'BHA cleanser for acne-prone skin', '2027-05-10'),
                ('Rice Water Cleanser', 'The Face Shop', 'Cleanser', 9.99, 'Brightening rice water cleanser', '2027-04-25'),
                ('Oil-Free Acne Wash', 'Neutrogena', 'Cleanser', 8.49, 'Salicylic acid acne cleanser', '2027-07-12'),
                ('Soy Face Cleanser', 'Fresh', 'Cleanser', 38.00, 'Gentle gel cleanser with soy proteins', '2027-09-01'),
                ('Milky Jelly Cleanser', 'Glossier', 'Cleanser', 19.00, 'Conditioning face wash', '2027-03-18'),
                ('Green Tea Foam Cleanser', 'Innisfree', 'Cleanser', 11.50, 'Amino acid based green tea cleanser', '2027-06-30'),
                ('Ultra Gentle Cleanser', 'Vanicream', 'Cleanser', 9.39, 'Fragrance-free gentle cleanser', '2027-08-15'),
                ('Deep Clean Charcoal Cleanser', 'Biore', 'Cleanser', 7.99, 'Charcoal pore-minimizing cleanser', '2027-05-22'),
                ('Moisturizing Cream', 'CeraVe', 'Moisturizer', 18.99, 'Daily moisturizing cream with hyaluronic acid', '2027-09-15'),
                ('Dramatically Different Gel', 'Clinique', 'Moisturizer', 32.00, 'Oil-free moisturizing gel', '2027-07-20'),
                ('Water Cream', 'Tatcha', 'Moisturizer', 68.00, 'Oil-free water cream moisturizer', '2027-11-10'),
                ('Hydro Boost Gel Cream', 'Neutrogena', 'Moisturizer', 22.99, 'Hyaluronic acid water gel', '2027-08-05'),
                ('Aqua Bomb', 'Belif', 'Moisturizer', 38.00, 'Ultra-hydrating moisture bomb', '2027-10-12'),
                ('Daily Moisture SPF', 'Aveeno', 'Moisturizer', 16.49, 'Oat-based daily moisturizer', '2027-06-18'),
                ('Overnight Recovery Cream', 'Kiehls', 'Moisturizer', 52.00, 'Nighttime recovery cream with squalane', '2027-12-01'),
                ('Aloe Vera Gel', 'Nature Republic', 'Moisturizer', 7.99, 'Soothing aloe vera moisturizer', '2027-04-30'),
                ('Snail Mucin Cream', 'COSRX', 'Moisturizer', 25.00, 'Snail secretion filtrate cream', '2027-09-22'),
                ('Barrier Repair Cream', 'La Roche-Posay', 'Moisturizer', 29.99, 'Cicaplast barrier cream', '2027-11-15'),
                ('Ultra Sheer Sunscreen SPF 70', 'Neutrogena', 'Sunscreen', 12.99, 'Lightweight SPF 70 sunscreen', '2027-03-15'),
                ('UV Aqua Rich Watery Essence', 'Biore', 'Sunscreen', 15.50, 'Japanese watery sunscreen SPF 50+', '2027-05-20'),
                ('Anthelios Melt-in Milk SPF 60', 'La Roche-Posay', 'Sunscreen', 35.99, 'Body and face sunscreen', '2027-08-10'),
                ('Unseen Sunscreen SPF 40', 'Supergoop', 'Sunscreen', 36.00, 'Invisible weightless sunscreen', '2027-07-25'),
                ('Mineral Sunscreen SPF 30', 'EltaMD', 'Sunscreen', 39.00, 'Zinc oxide mineral sunscreen', '2027-10-05'),
                ('Sun Bum SPF 50', 'Sun Bum', 'Sunscreen', 17.99, 'Reef-friendly moisturizing sunscreen', '2027-06-12'),
                ('Daily UV Defense SPF 36', 'Shiseido', 'Sunscreen', 42.00, 'Urban environment sun protection', '2027-09-18'),
                ('Banana Boat Sport SPF 50', 'Banana Boat', 'Sunscreen', 9.99, 'Water-resistant sport sunscreen', '2027-04-15'),
                ('Clear Face Sunscreen SPF 55', 'Neutrogena', 'Sunscreen', 13.49, 'Oil-free breakout-free sunscreen', '2027-07-30'),
                ('Tone Up Sun Base SPF 50', 'Missha', 'Sunscreen', 14.00, 'Tone-up sun base with lavender tint', '2027-08-22'),
                ('Vitamin C Serum 20%', 'Timeless', 'Serum', 24.95, 'Pure vitamin C serum with ferulic acid', '2027-04-15'),
                ('Niacinamide 10% + Zinc 1%', 'The Ordinary', 'Serum', 6.50, 'Oil control and blemish serum', '2027-06-20'),
                ('Hyaluronic Acid 2% + B5', 'The Ordinary', 'Serum', 7.90, 'Hydration support serum', '2027-05-30'),
                ('Retinol 0.5% Serum', 'Paulas Choice', 'Serum', 34.00, 'Anti-aging retinol treatment', '2027-07-10'),
                ('Snail 96 Mucin Essence', 'COSRX', 'Serum', 21.00, 'Snail mucin power essence for repair', '2027-08-25'),
                ('Azelaic Acid Suspension', 'The Ordinary', 'Serum', 8.90, 'Brightening azelaic acid treatment', '2027-06-05'),
                ('Advanced Night Repair', 'Estee Lauder', 'Serum', 75.00, 'Synchronized recovery complex serum', '2027-12-15'),
                ('Lactic Acid 10% + HA', 'The Ordinary', 'Serum', 7.50, 'Gentle exfoliating serum', '2027-05-18'),
                ('Bakuchiol Retinol Alternative', 'Herbivore', 'Serum', 54.00, 'Plant-based retinol alternative serum', '2027-10-20'),
                ('Centella Unscented Serum', 'Purito', 'Serum', 16.00, 'Centella asiatica recovery serum', '2027-07-28'),
                ('Alpha Arbutin 2% + HA', 'The Ordinary', 'Serum', 9.90, 'Brightening and dark spot serum', '2027-09-10'),
                ('Glycolic Acid 7% Toning Solution', 'The Ordinary', 'Toner', 9.60, 'Exfoliating glycolic acid toner', '2027-06-15'),
                ('Facial Treatment Essence', 'SK-II', 'Toner', 99.00, 'Pitera essence facial treatment', '2027-11-20'),
                ('Witch Hazel Toner', 'Thayers', 'Toner', 10.95, 'Alcohol-free witch hazel with aloe', '2027-05-25'),
                ('Klairs Supple Preparation Toner', 'Dear Klairs', 'Toner', 22.00, 'Gentle hydrating toner', '2027-08-15'),
                ('AHA/BHA Clarifying Toner', 'COSRX', 'Toner', 15.00, 'Natural BHA clarifying toner', '2027-07-08'),
                ('Rose Water Toner', 'Heritage Store', 'Toner', 8.99, 'Rosewater facial toner', '2027-04-20'),
                ('Pixi Glow Tonic', 'Pixi', 'Toner', 15.00, '5% glycolic acid exfoliating toner', '2027-09-05'),
                ('Hada Labo Lotion', 'Hada Labo', 'Toner', 13.50, 'Super hyaluronic acid hydrating lotion', '2027-10-18'),
                ('Tea Tree Toner', 'Lush', 'Toner', 12.95, 'Tea tree water toner for oily skin', '2027-06-28'),
                ('Cucumber Toner', 'Mario Badescu', 'Toner', 14.00, 'Aloe cucumber green tea toner', '2027-08-02'),
                ('Propolis Synergy Toner', 'COSRX', 'Toner', 23.00, 'Full fit propolis synergy toner', '2027-11-10'),
                ('Green Tea Seed Toner', 'Innisfree', 'Toner', 17.00, 'Hydrating green tea seed toner', '2027-07-15'),
                ('BHA Blackhead Power Liquid', 'COSRX', 'Toner', 18.00, 'Betaine salicylate BHA toner', '2027-09-25'),
                ('Mugwort Essence Toner', 'Im From', 'Toner', 24.00, 'Mugwort calming essence toner', '2027-10-30')
            `);

            // 55 Ingredients
            await connection.query(`
                INSERT INTO Ingredients (ingredient_name, safety_level, description) VALUES
                ('Hyaluronic Acid', 'Safe', 'A powerful humectant that retains moisture in the skin'),
                ('Niacinamide', 'Safe', 'Vitamin B3 that helps minimize pores and improve skin tone'),
                ('Salicylic Acid', 'Safe', 'Beta hydroxy acid for acne treatment and exfoliation'),
                ('Vitamin C (Ascorbic Acid)', 'Safe', 'Antioxidant that brightens skin and stimulates collagen'),
                ('Retinol', 'Moderate', 'Vitamin A derivative for anti-aging; can cause irritation'),
                ('Ceramides', 'Safe', 'Lipids that help restore the skin barrier'),
                ('Glycolic Acid', 'Moderate', 'Alpha hydroxy acid for chemical exfoliation'),
                ('Zinc Oxide', 'Safe', 'Mineral sunscreen ingredient and anti-inflammatory'),
                ('Titanium Dioxide', 'Safe', 'Physical sunscreen ingredient providing UV protection'),
                ('Aloe Vera', 'Safe', 'Soothing plant extract for hydration and healing'),
                ('Tea Tree Oil', 'Moderate', 'Antibacterial essential oil; can irritate sensitive skin'),
                ('Benzoyl Peroxide', 'Moderate', 'Acne treatment that kills bacteria; can cause dryness'),
                ('Squalane', 'Safe', 'Plant-derived oil that mimics natural skin oils'),
                ('Peptides', 'Safe', 'Amino acid chains that stimulate collagen production'),
                ('Centella Asiatica', 'Safe', 'Cica extract that soothes and repairs skin barrier'),
                ('Green Tea Extract', 'Safe', 'Antioxidant-rich extract for protection and soothing'),
                ('Snail Mucin', 'Safe', 'Snail secretion filtrate for hydration and repair'),
                ('Azelaic Acid', 'Safe', 'Brightening acid effective against rosacea and acne'),
                ('Lactic Acid', 'Moderate', 'Gentle AHA exfoliant from fermented milk sugars'),
                ('Bakuchiol', 'Safe', 'Natural retinol alternative from Psoralea corylifolia'),
                ('Witch Hazel', 'Safe', 'Natural astringent that tightens pores'),
                ('Rose Water', 'Safe', 'Gentle toner with anti-inflammatory properties'),
                ('Propolis', 'Safe', 'Bee-derived ingredient with antibacterial and healing properties'),
                ('Mugwort Extract', 'Safe', 'Calming botanical for sensitive and irritated skin'),
                ('Alpha Arbutin', 'Safe', 'Skin brightener that inhibits melanin production'),
                ('Ferulic Acid', 'Safe', 'Antioxidant that stabilizes vitamin C and E'),
                ('Panthenol (Vitamin B5)', 'Safe', 'Moisturizer and skin protectant'),
                ('Jojoba Oil', 'Safe', 'Non-comedogenic oil similar to skin sebum'),
                ('Shea Butter', 'Safe', 'Rich emollient for dry skin hydration'),
                ('Glycerin', 'Safe', 'Humectant that draws moisture to the skin'),
                ('Sodium Hyaluronate', 'Safe', 'Lower molecular weight form of hyaluronic acid'),
                ('Tocopherol (Vitamin E)', 'Safe', 'Antioxidant that protects and moisturizes'),
                ('Allantoin', 'Safe', 'Soothing and anti-irritant compound'),
                ('Colloidal Oatmeal', 'Safe', 'Skin protectant that soothes itching and irritation'),
                ('Mandelic Acid', 'Moderate', 'Gentle AHA suitable for darker skin tones'),
                ('Kojic Acid', 'Moderate', 'Skin lightening agent for hyperpigmentation'),
                ('Hydroquinone', 'High Risk', 'Strong skin bleaching agent; restricted in many countries'),
                ('Mercury Compounds', 'High Risk', 'Toxic skin lightener; banned in cosmetics'),
                ('Formaldehyde', 'High Risk', 'Preservative linked to cancer; highly irritating'),
                ('Parabens (Methylparaben)', 'Moderate', 'Preservative with potential hormonal disruption'),
                ('Triclosan', 'High Risk', 'Antibacterial agent linked to hormone disruption'),
                ('Phthalates', 'High Risk', 'Plasticizers that may disrupt endocrine system'),
                ('Toluene', 'High Risk', 'Solvent that can cause neurological damage'),
                ('Lead Acetate', 'High Risk', 'Toxic heavy metal compound; banned in EU cosmetics'),
                ('Coal Tar', 'High Risk', 'Carcinogenic ingredient formerly used in dandruff treatment'),
                ('Oxybenzone', 'Moderate', 'Chemical sunscreen filter; potential hormone disruptor'),
                ('Octinoxate', 'Moderate', 'UV filter harmful to coral reefs'),
                ('Sulfates (SLS)', 'Moderate', 'Foaming agent that can strip natural oils'),
                ('Synthetic Fragrance', 'Moderate', 'Mixture of chemicals that can cause sensitization'),
                ('Alcohol Denat', 'Moderate', 'Drying alcohol used as solvent'),
                ('Pitera', 'Safe', 'Bio-ingredient from sake fermentation rich in vitamins'),
                ('Rice Extract', 'Safe', 'Brightening and nourishing grain extract'),
                ('Betaine Salicylate', 'Safe', 'Gentle BHA alternative derived from sugar beets'),
                ('Cucumber Extract', 'Safe', 'Cooling and soothing botanical extract'),
                ('Charcoal', 'Safe', 'Activated carbon for drawing out impurities')
            `);

            // Product_Ingredients (120+ records)
            await connection.query(`
                INSERT INTO Product_Ingredients (product_id, ingredient_id) VALUES
                (1,6),(1,2),(1,30),(2,6),(2,1),(2,30),(3,3),(3,16),(3,10),(4,52),(4,6),
                (5,3),(5,10),(6,30),(6,22),(6,10),(7,33),(7,30),(8,16),(8,30),(9,30),(9,33),
                (10,55),(10,3),(11,6),(11,1),(11,30),(12,30),(12,10),(12,32),(13,16),(13,30),(13,52),
                (14,1),(14,30),(15,27),(15,6),(15,30),(16,34),(16,30),(16,8),(17,13),(17,32),(17,30),
                (18,10),(18,30),(19,17),(19,27),(19,30),(20,27),(20,29),(20,30),(20,15),
                (21,46),(21,47),(21,30),(22,30),(22,1),(22,32),(23,9),(23,32),(23,30),
                (24,30),(24,32),(25,8),(25,9),(25,2),(26,32),(26,10),(26,30),(27,9),(27,30),
                (28,46),(28,47),(28,10),(29,30),(29,10),(30,2),(30,30),(30,9),
                (31,4),(31,26),(31,32),(32,2),(32,8),(32,30),(33,1),(33,31),(33,27),
                (34,5),(34,14),(34,13),(35,17),(35,27),(35,33),(36,18),(36,2),
                (37,1),(37,14),(37,32),(38,19),(38,1),(39,20),(39,13),(39,28),
                (40,15),(40,27),(41,25),(41,1),(42,7),(42,10),(42,30),(43,51),(43,30),
                (44,21),(44,10),(44,22),(45,1),(45,15),(45,27),(46,53),(46,7),(46,10),
                (47,22),(47,30),(47,10),(48,7),(48,10),(48,21),(49,1),(49,31),(49,30),
                (50,11),(50,30),(51,54),(51,10),(51,16),(52,23),(52,30),(52,27),
                (53,16),(53,30),(54,53),(54,21),(55,24),(55,15)
            `);

            // 60 Reviews (spread across users and products)
            const reviewData = [];
            const comments = [
                'Amazing product! My skin feels so much better.',
                'Good value for money. Would recommend.',
                'Not bad, but I expected more from this brand.',
                'Holy grail product! Repurchasing immediately.',
                'Works well for my skin type. Very gentle.',
                'Great texture, absorbs quickly without greasiness.',
                'Made my skin break out unfortunately.',
                'Love this! My skin looks brighter after 2 weeks.',
                'Decent product, nothing extraordinary.',
                'Best cleanser I have ever used!',
                'A bit pricey but totally worth it.',
                'Leaves my skin feeling soft and hydrated.',
                'The scent is a bit strong but it works.',
                'Perfect for sensitive skin like mine.',
                'Noticed visible improvement in just one week.',
                'Would give 6 stars if I could!',
                'Nice product but packaging could be better.',
                'My dermatologist recommended this and it works.',
                'Good for daily use, very mild formula.',
                'This really helped with my acne scars.'
            ];
            for (let i = 0; i < 60; i++) {
                const userId = (i % 55) + 2; // users start at id 2
                const productId = (i % 55) + 1;
                const rating = Math.floor(Math.random() * 3) + 3; // 3-5 rating
                const comment = comments[i % comments.length];
                reviewData.push(`(${userId}, ${productId}, ${rating}, '${comment}')`);
            }
            await connection.query(`INSERT INTO Reviews (user_id, product_id, rating, comment) VALUES ${reviewData.join(',')}`);

            // 55 Recommendations
            const skinIssues = ['Acne', 'Dark Spots', 'Dryness', 'Oiliness', 'Wrinkles', 'Redness', 'Uneven Tone', 'Large Pores', 'Sun Damage', 'Sensitivity'];
            const recData = [];
            for (let i = 0; i < 55; i++) {
                const userId = (i % 55) + 2;
                const productId = (i % 55) + 1;
                const issue = skinIssues[i % skinIssues.length];
                recData.push(`(${userId}, ${productId}, '${issue}')`);
            }
            await connection.query(`INSERT INTO Recommendations (user_id, product_id, skin_issue) VALUES ${recData.join(',')}`);

            console.log('✅ Seed data inserted successfully (50+ records per table)');
        }

        await connection.end();
        console.log('✅ Database initialized successfully with tables, views, and triggers');
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        console.error('   Make sure MySQL is running and credentials in .env are correct.');
    }
}

module.exports = { pool, initializeDatabase };
