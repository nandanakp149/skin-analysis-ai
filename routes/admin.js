const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { isAdmin } = require('../middleware/auth');
const router = express.Router();

// Apply isAdmin middleware only to /api/admin/* routes (not globally on the router)
router.use('/api/admin', isAdmin);

// ==================== DASHBOARD ====================

router.get('/api/admin/dashboard', async (req, res) => {
    try {
        // Aggregate queries for dashboard stats
        const [totalUsers] = await pool.query("SELECT COUNT(*) as count FROM Users WHERE role = 'user'");
        const [totalProducts] = await pool.query('SELECT COUNT(*) as count FROM Products');
        const [totalReviews] = await pool.query('SELECT COUNT(*) as count FROM Reviews');
        const [totalIngredients] = await pool.query('SELECT COUNT(*) as count FROM Ingredients');
        const [avgRating] = await pool.query('SELECT COALESCE(ROUND(AVG(rating), 2), 0) as avg FROM Reviews');

        // Products per category (aggregate)
        const [productsPerCategory] = await pool.query(
            'SELECT category, COUNT(*) as count FROM Products GROUP BY category ORDER BY count DESC'
        );

        // Users per skin type (aggregate with JOIN)
        const [usersPerSkinType] = await pool.query(
            `SELECT st.skin_type_name, COUNT(u.user_id) as count
             FROM Skin_Type st
             LEFT JOIN Users u ON st.skin_type_id = u.skin_type_id AND u.role = 'user'
             GROUP BY st.skin_type_id, st.skin_type_name`
        );

        // Most reviewed products (aggregate)
        const [mostReviewed] = await pool.query(
            `SELECT p.product_name, p.brand, COUNT(r.review_id) as review_count, ROUND(AVG(r.rating), 2) as avg_rating
             FROM Products p
             JOIN Reviews r ON p.product_id = r.product_id
             GROUP BY p.product_id, p.product_name, p.brand
             ORDER BY review_count DESC LIMIT 5`
        );

        // Top rated products (aggregate)
        const [topRated] = await pool.query(
            `SELECT p.product_name, p.brand, ROUND(AVG(r.rating), 2) as avg_rating, COUNT(r.review_id) as review_count
             FROM Products p
             JOIN Reviews r ON p.product_id = r.product_id
             GROUP BY p.product_id, p.product_name, p.brand
             HAVING review_count >= 1
             ORDER BY avg_rating DESC LIMIT 5`
        );

        // Max price per category (aggregate)
        const [maxPricePerCategory] = await pool.query(
            'SELECT category, MAX(price) as max_price, MIN(price) as min_price, ROUND(AVG(price), 2) as avg_price FROM Products GROUP BY category'
        );

        // Users who gave highest avg rating (aggregate)
        const [topRaters] = await pool.query(
            `SELECT u.name, u.email, ROUND(AVG(r.rating), 2) as avg_rating, COUNT(r.review_id) as review_count
             FROM Users u
             JOIN Reviews r ON u.user_id = r.user_id
             GROUP BY u.user_id, u.name, u.email
             HAVING review_count >= 1
             ORDER BY avg_rating DESC LIMIT 5`
        );

        // Recent reviews (from view)
        const [recentReviews] = await pool.query('SELECT * FROM RecentReviews LIMIT 5');

        // High risk ingredient count
        const [riskyCount] = await pool.query(
            `SELECT COUNT(DISTINCT product_id) as count FROM RiskyIngredients`
        );

        // Deleted products audit
        const [deletedCount] = await pool.query('SELECT COUNT(*) as count FROM Deleted_Products_Audit');

        res.json({
            success: true,
            stats: {
                totalUsers: totalUsers[0].count,
                totalProducts: totalProducts[0].count,
                totalReviews: totalReviews[0].count,
                totalIngredients: totalIngredients[0].count,
                avgRating: avgRating[0].avg,
                riskyProductCount: riskyCount[0].count,
                deletedProductCount: deletedCount[0].count
            },
            productsPerCategory,
            usersPerSkinType,
            mostReviewed,
            topRated,
            maxPricePerCategory,
            topRaters,
            recentReviews
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

// ==================== MANAGE USERS ====================

router.get('/api/admin/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = 'WHERE 1=1';
        let params = [];
        if (search) {
            where += ' AND (u.name LIKE ? OR u.email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM Users u ${where}`, params
        );

        const [users] = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.age, u.gender, u.role, u.registration_date,
                    st.skin_type_name,
                    COUNT(DISTINCT r.review_id) as review_count,
                    COUNT(DISTINCT rec.recommendation_id) as recommendation_count
             FROM Users u
             LEFT JOIN Skin_Type st ON u.skin_type_id = st.skin_type_id
             LEFT JOIN Reviews r ON u.user_id = r.user_id
             LEFT JOIN Recommendations rec ON u.user_id = rec.user_id
             ${where}
             GROUP BY u.user_id, u.name, u.email, u.age, u.gender, u.role, u.registration_date, st.skin_type_name
             ORDER BY u.user_id DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            success: true, users,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, pages: Math.ceil(countResult[0].total / parseInt(limit)) }
        });
    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ success: false, message: 'Failed to load users' });
    }
});

// GET single user (for edit modal)
router.get('/api/admin/users/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.age, u.gender, u.role, u.registration_date, u.skin_type_id, st.skin_type_name
             FROM Users u
             LEFT JOIN Skin_Type st ON u.skin_type_id = st.skin_type_id
             WHERE u.user_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user: rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, message: 'Failed to load user' });
    }
});

router.put('/api/admin/users/:id', async (req, res) => {
    try {
        const { name, email, age, gender, skin_type_id, role } = req.body;
        await pool.query(
            'UPDATE Users SET name=?, email=?, age=?, gender=?, skin_type_id=?, role=? WHERE user_id=?',
            [name, email, parseInt(age), gender, skin_type_id || null, role, req.params.id]
        );
        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

router.delete('/api/admin/users/:id', async (req, res) => {
    try {
        if (parseInt(req.params.id) === req.session.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }
        await pool.query('DELETE FROM Users WHERE user_id = ?', [req.params.id]);
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// ==================== MANAGE PRODUCTS ====================

router.get('/api/admin/products', async (req, res) => {
    try {
        const { page = 1, limit = 20, search, category } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = 'WHERE 1=1';
        let params = [];
        if (search) {
            where += ' AND (p.product_name LIKE ? OR p.brand LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (category) {
            where += ' AND p.category = ?';
            params.push(category);
        }

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM Products p ${where}`, params
        );

        const [products] = await pool.query(
            `SELECT p.*, ps.avg_rating, ps.review_count, ps.ingredient_count
             FROM Products p
             LEFT JOIN ProductSummary ps ON p.product_id = ps.product_id
             ${where}
             ORDER BY p.product_id DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            success: true, products,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, pages: Math.ceil(countResult[0].total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load products' });
    }
});

// GET single product (for edit modal)
router.get('/api/admin/products/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.*, ps.avg_rating, ps.review_count
             FROM Products p
             LEFT JOIN ProductSummary ps ON p.product_id = ps.product_id
             WHERE p.product_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found' });

        const product = rows[0];
        const [ingredients] = await pool.query(
            `SELECT i.ingredient_id, i.ingredient_name
             FROM Ingredients i
             JOIN Product_Ingredients pi ON i.ingredient_id = pi.ingredient_id
             WHERE pi.product_id = ?`,
            [req.params.id]
        );

        res.json({ success: true, product: { ...product, ingredients } });
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ success: false, message: 'Failed to load product' });
    }
});

router.post('/api/admin/products', async (req, res) => {
    try {
        const { product_name, brand, category, price, description, expiry_date, ingredient_ids } = req.body;

        if (!product_name || !brand || !category || !price || !expiry_date) {
            return res.status(400).json({ success: false, message: 'All required fields must be filled' });
        }
        if (parseFloat(price) <= 0) {
            return res.status(400).json({ success: false, message: 'Price must be greater than 0' });
        }

        const [result] = await pool.query(
            'INSERT INTO Products (product_name, brand, category, price, description, expiry_date) VALUES (?, ?, ?, ?, ?, ?)',
            [product_name, brand, category, parseFloat(price), description, expiry_date]
        );

        // Assign ingredients
        if (ingredient_ids && ingredient_ids.length > 0) {
            const values = ingredient_ids.map(id => `(${result.insertId}, ${parseInt(id)})`).join(',');
            await pool.query(`INSERT INTO Product_Ingredients (product_id, ingredient_id) VALUES ${values}`);
        }

        res.json({ success: true, message: 'Product added', productId: result.insertId });
    } catch (error) {
        console.error('Add product error:', error);
        res.status(500).json({ success: false, message: 'Failed to add product' });
    }
});

router.put('/api/admin/products/:id', async (req, res) => {
    try {
        const { product_name, brand, category, price, description, expiry_date, ingredient_ids } = req.body;
        await pool.query(
            'UPDATE Products SET product_name=?, brand=?, category=?, price=?, description=?, expiry_date=? WHERE product_id=?',
            [product_name, brand, category, parseFloat(price), description, expiry_date, req.params.id]
        );

        // Update ingredients
        if (ingredient_ids !== undefined) {
            await pool.query('DELETE FROM Product_Ingredients WHERE product_id = ?', [req.params.id]);
            if (ingredient_ids.length > 0) {
                const values = ingredient_ids.map(id => `(${req.params.id}, ${parseInt(id)})`).join(',');
                await pool.query(`INSERT INTO Product_Ingredients (product_id, ingredient_id) VALUES ${values}`);
            }
        }

        res.json({ success: true, message: 'Product updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update product' });
    }
});

router.delete('/api/admin/products/:id', async (req, res) => {
    try {
        // Trigger will log to audit table
        await pool.query('DELETE FROM Products WHERE product_id = ?', [req.params.id]);
        res.json({ success: true, message: 'Product deleted (archived to audit)' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete product' });
    }
});

// ==================== MANAGE INGREDIENTS ====================

router.get('/api/admin/ingredients', async (req, res) => {
    try {
        const { search, safety_level } = req.query;
        let where = 'WHERE 1=1';
        let params = [];
        if (search) { where += ' AND i.ingredient_name LIKE ?'; params.push(`%${search}%`); }
        if (safety_level) { where += ' AND i.safety_level = ?'; params.push(safety_level); }

        const [ingredients] = await pool.query(
            `SELECT i.*, COUNT(pi.product_id) as product_count
             FROM Ingredients i
             LEFT JOIN Product_Ingredients pi ON i.ingredient_id = pi.ingredient_id
             ${where}
             GROUP BY i.ingredient_id
             ORDER BY i.ingredient_name`,
            params
        );
        res.json({ success: true, ingredients });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load ingredients' });
    }
});

// GET single ingredient (for edit modal)
router.get('/api/admin/ingredients/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Ingredients WHERE ingredient_id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Ingredient not found' });
        res.json({ success: true, ingredient: rows[0] });
    } catch (error) {
        console.error('Get ingredient error:', error);
        res.status(500).json({ success: false, message: 'Failed to load ingredient' });
    }
});

router.post('/api/admin/ingredients', async (req, res) => {
    try {
        const { ingredient_name, safety_level, description } = req.body;
        if (!ingredient_name || !safety_level) {
            return res.status(400).json({ success: false, message: 'Name and safety level are required' });
        }
        // Validate safety_level against DB enum
        const validLevels = ['Safe', 'Moderate', 'High Risk'];
        if (!validLevels.includes(safety_level)) {
            return res.status(400).json({ success: false, message: 'Invalid safety level. Use Safe, Moderate, or High Risk.' });
        }
        const [result] = await pool.query(
            'INSERT INTO Ingredients (ingredient_name, safety_level, description) VALUES (?, ?, ?)',
            [ingredient_name, safety_level, description || null]
        );
        res.json({ success: true, message: 'Ingredient added', ingredientId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Ingredient already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to add ingredient' });
    }
});

router.put('/api/admin/ingredients/:id', async (req, res) => {
    try {
        const { ingredient_name, safety_level, description } = req.body;
        const validLevels = ['Safe', 'Moderate', 'High Risk'];
        if (!ingredient_name || !safety_level || !validLevels.includes(safety_level)) {
            return res.status(400).json({ success: false, message: 'Invalid ingredient data' });
        }
        await pool.query(
            'UPDATE Ingredients SET ingredient_name=?, safety_level=?, description=? WHERE ingredient_id=?',
            [ingredient_name, safety_level, description || null, req.params.id]
        );
        res.json({ success: true, message: 'Ingredient updated' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Ingredient name already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to update ingredient' });
    }
});

router.delete('/api/admin/ingredients/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM Ingredients WHERE ingredient_id = ?', [req.params.id]);
        res.json({ success: true, message: 'Ingredient deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete ingredient' });
    }
});

// ==================== MANAGE REVIEWS ====================

router.get('/api/admin/reviews', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const [countResult] = await pool.query('SELECT COUNT(*) as total FROM Reviews');

        const [reviews] = await pool.query(
            `SELECT r.*, u.name AS user_name, u.email, p.product_name, p.brand
             FROM Reviews r
             JOIN Users u ON r.user_id = u.user_id
             JOIN Products p ON r.product_id = p.product_id
             ORDER BY r.review_date DESC
             LIMIT ? OFFSET ?`,
            [parseInt(limit), offset]
        );

        res.json({
            success: true, reviews,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, pages: Math.ceil(countResult[0].total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load reviews' });
    }
});

router.put('/api/admin/reviews/:id', async (req, res) => {
    try {
        const { rating, comment } = req.body;
        await pool.query('UPDATE Reviews SET rating=?, comment=? WHERE review_id=?', [parseInt(rating), comment, req.params.id]);
        res.json({ success: true, message: 'Review updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update review' });
    }
});

router.delete('/api/admin/reviews/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM Reviews WHERE review_id = ?', [req.params.id]);
        res.json({ success: true, message: 'Review deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
});

// ==================== MANAGE RECOMMENDATIONS ====================

router.get('/api/admin/recommendations', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const [countResult] = await pool.query('SELECT COUNT(*) as total FROM Recommendations');
        const [recommendations] = await pool.query(
            `SELECT recommendation_id, user_id, user_name, email, product_name, brand, category, price,
                    skin_issue AS reason, recommendation_date AS recommended_at
             FROM UserRecommendations ORDER BY recommendation_date DESC LIMIT ? OFFSET ?`,
            [parseInt(limit), offset]
        );
        res.json({
            success: true, recommendations,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, pages: Math.ceil(countResult[0].total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load recommendations' });
    }
});

router.post('/api/admin/recommendations', async (req, res) => {
    try {
        const { user_id, product_id, skin_issue } = req.body;
        await pool.query(
            'INSERT INTO Recommendations (user_id, product_id, skin_issue) VALUES (?, ?, ?)',
            [user_id, product_id, skin_issue]
        );
        res.json({ success: true, message: 'Recommendation added' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add recommendation' });
    }
});

router.delete('/api/admin/recommendations/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM Recommendations WHERE recommendation_id = ?', [req.params.id]);
        res.json({ success: true, message: 'Recommendation deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete recommendation' });
    }
});

// ==================== REPORTS ====================

router.get('/api/admin/reports/risky-ingredients', async (req, res) => {
    try {
        const [data] = await pool.query('SELECT * FROM RiskyIngredients ORDER BY product_name');
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load report' });
    }
});

router.get('/api/admin/reports/audit-log', async (req, res) => {
    try {
        const [data] = await pool.query('SELECT * FROM Deleted_Products_Audit ORDER BY deleted_at DESC');
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load audit log' });
    }
});

// ==================== CSV EXPORT ====================

router.get('/api/admin/export/:table', async (req, res) => {
    try {
        const allowedTables = ['Users', 'Products', 'Ingredients', 'Reviews', 'Recommendations', 'Product_Ingredients'];
        const table = req.params.table;
        if (!allowedTables.includes(table)) {
            return res.status(400).json({ success: false, message: 'Invalid table name' });
        }

        const [rows] = await pool.query(`SELECT * FROM ${table}`);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No data to export' });
        }

        const headers = Object.keys(rows[0]);
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += headers.map(h => {
                let val = row[h];
                if (val === null) return '';
                val = String(val).replace(/"/g, '""');
                return `"${val}"`;
            }).join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${table}_export.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to export' });
    }
});

// ==================== ADMIN SETTINGS ====================

router.put('/api/admin/change-password', async (req, res) => {
    try {
        // Accept both camelCase (from form) and snake_case field names
        const current_password = req.body.current_password || req.body.currentPassword;
        const new_password     = req.body.new_password     || req.body.newPassword;

        if (!current_password || !new_password || new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'Invalid password data. New password must be at least 6 characters.' });
        }

        const [users] = await pool.query('SELECT password FROM Users WHERE user_id = ?', [req.session.user.id]);
        if (!users.length) return res.status(404).json({ success: false, message: 'User not found' });

        const isMatch = await bcrypt.compare(current_password, users[0].password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }

        const hash = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE Users SET password = ? WHERE user_id = ?', [hash, req.session.user.id]);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, message: 'Failed to change password' });
    }
});

module.exports = router;
