-- =====================================================
-- Skincare Product Recommendation & Analysis System
-- Complete Database Schema - DDL, DML, Views, Triggers
-- =====================================================

CREATE DATABASE IF NOT EXISTS skin_analyser;
USE skin_analyser;

-- =====================================================
-- DDL: TABLE CREATION WITH INTEGRITY CONSTRAINTS
-- =====================================================

-- 1. Skin_Type Table
CREATE TABLE IF NOT EXISTS Skin_Type (
    skin_type_id INT AUTO_INCREMENT PRIMARY KEY,
    skin_type_name ENUM('Oily', 'Dry', 'Combination', 'Sensitive', 'Normal') NOT NULL UNIQUE
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS Users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    age INT NOT NULL CHECK (age >= 18),
    gender ENUM('Male', 'Female', 'Other') NOT NULL,
    skin_type_id INT,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    registration_date DATE DEFAULT (CURRENT_DATE),
    FOREIGN KEY (skin_type_id) REFERENCES Skin_Type(skin_type_id) ON DELETE SET NULL
);

-- 3. Products Table
CREATE TABLE IF NOT EXISTS Products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    product_name VARCHAR(200) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    category ENUM('Cleanser', 'Moisturizer', 'Sunscreen', 'Serum', 'Toner') NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price > 0),
    description TEXT,
    image_url VARCHAR(500) DEFAULT NULL,
    expiry_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Ingredients Table
CREATE TABLE IF NOT EXISTS Ingredients (
    ingredient_id INT AUTO_INCREMENT PRIMARY KEY,
    ingredient_name VARCHAR(150) NOT NULL UNIQUE,
    safety_level ENUM('Safe', 'Moderate', 'High Risk') NOT NULL DEFAULT 'Safe',
    description TEXT
);

-- 5. Product_Ingredients Junction Table
CREATE TABLE IF NOT EXISTS Product_Ingredients (
    product_id INT NOT NULL,
    ingredient_id INT NOT NULL,
    PRIMARY KEY (product_id, ingredient_id),
    FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES Ingredients(ingredient_id) ON DELETE CASCADE
);

-- 6. Reviews Table
CREATE TABLE IF NOT EXISTS Reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
);

-- 7. Recommendations Table
CREATE TABLE IF NOT EXISTS Recommendations (
    recommendation_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    skin_issue VARCHAR(200) NOT NULL,
    recommendation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES Products(product_id) ON DELETE CASCADE
);

-- 8. Audit table for deleted products
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
);

-- 9. Analysis History (AI image analysis)
CREATE TABLE IF NOT EXISTS Analysis_History (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    image_path VARCHAR(500) NOT NULL,
    analysis_result LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

-- =====================================================
-- VIEWS
-- =====================================================

-- View 1: ProductSummary
CREATE OR REPLACE VIEW ProductSummary AS
SELECT 
    p.product_id, p.product_name, p.brand, p.category, p.price, p.expiry_date,
    COALESCE(ROUND(AVG(r.rating), 2), 0) AS avg_rating,
    COUNT(DISTINCT r.review_id) AS review_count,
    COUNT(DISTINCT pi.ingredient_id) AS ingredient_count
FROM Products p
LEFT JOIN Reviews r ON p.product_id = r.product_id
LEFT JOIN Product_Ingredients pi ON p.product_id = pi.product_id
GROUP BY p.product_id, p.product_name, p.brand, p.category, p.price, p.expiry_date;

-- View 2: UserRecommendations
CREATE OR REPLACE VIEW UserRecommendations AS
SELECT 
    u.user_id, u.name AS user_name, u.email,
    p.product_name, p.brand, p.category, p.price,
    rec.skin_issue, rec.recommendation_date, rec.recommendation_id
FROM Recommendations rec
JOIN Users u ON rec.user_id = u.user_id
JOIN Products p ON rec.product_id = p.product_id;

-- View 3: RiskyIngredients
CREATE OR REPLACE VIEW RiskyIngredients AS
SELECT 
    p.product_id, p.product_name, p.brand,
    i.ingredient_id, i.ingredient_name, i.safety_level, i.description AS ingredient_description
FROM Products p
JOIN Product_Ingredients pi ON p.product_id = pi.product_id
JOIN Ingredients i ON pi.ingredient_id = i.ingredient_id
WHERE i.safety_level = 'High Risk';

-- View 4: RecentReviews
CREATE OR REPLACE VIEW RecentReviews AS
SELECT 
    r.review_id, u.name AS user_name, u.email,
    p.product_name, p.brand, r.rating, r.comment, r.review_date
FROM Reviews r
JOIN Users u ON r.user_id = u.user_id
JOIN Products p ON r.product_id = p.product_id
ORDER BY r.review_date DESC
LIMIT 10;

-- =====================================================
-- TRIGGERS
-- =====================================================

DROP TRIGGER IF EXISTS prevent_review_on_expired_product;
DROP TRIGGER IF EXISTS update_recommendation_timestamp;
DROP TRIGGER IF EXISTS log_deleted_product;
DROP TRIGGER IF EXISTS prevent_duplicate_review;

DELIMITER //

CREATE TRIGGER prevent_review_on_expired_product
BEFORE INSERT ON Reviews
FOR EACH ROW
BEGIN
    DECLARE prod_expiry DATE;
    SELECT expiry_date INTO prod_expiry FROM Products WHERE product_id = NEW.product_id;
    IF prod_expiry IS NOT NULL AND prod_expiry < CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot review an expired product';
    END IF;
END //

CREATE TRIGGER update_recommendation_timestamp
BEFORE UPDATE ON Recommendations
FOR EACH ROW
BEGIN
    SET NEW.recommendation_date = CURRENT_TIMESTAMP;
END //

CREATE TRIGGER log_deleted_product
BEFORE DELETE ON Products
FOR EACH ROW
BEGIN
    INSERT INTO Deleted_Products_Audit (product_id, product_name, brand, category, price, expiry_date)
    VALUES (OLD.product_id, OLD.product_name, OLD.brand, OLD.category, OLD.price, OLD.expiry_date);
END //

CREATE TRIGGER prevent_duplicate_review
BEFORE INSERT ON Reviews
FOR EACH ROW
BEGIN
    DECLARE review_count INT;
    SELECT COUNT(*) INTO review_count FROM Reviews WHERE user_id = NEW.user_id AND product_id = NEW.product_id;
    IF review_count > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'You have already reviewed this product';
    END IF;
END //

DELIMITER ;
