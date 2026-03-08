const express = require('express');
const { pool } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const router = express.Router();

// GET all products with filters, search, pagination (using ProductSummary view)
router.get('/api/products', async (req, res) => {
    try {
        const { category, brand, min_price, max_price, search, page = 1, limit = 12, sort } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;

        let where = [];
        let params = [];

        if (category) {
            where.push('ps.category = ?');
            params.push(category);
        }
        if (brand) {
            where.push('ps.brand LIKE ?');
            params.push(`%${brand}%`);
        }
        if (min_price) {
            where.push('ps.price >= ?');
            params.push(parseFloat(min_price));
        }
        if (max_price) {
            where.push('ps.price <= ?');
            params.push(parseFloat(max_price));
        }
        if (search) {
            where.push('(ps.product_name LIKE ? OR ps.brand LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        let orderBy = 'ps.product_id DESC';
        if (sort === 'price_asc') orderBy = 'ps.price ASC';
        else if (sort === 'price_desc') orderBy = 'ps.price DESC';
        else if (sort === 'rating') orderBy = 'ps.avg_rating DESC';
        else if (sort === 'reviews') orderBy = 'ps.review_count DESC';
        else if (sort === 'name' || sort === 'name_asc') orderBy = 'ps.product_name ASC';
        else if (sort === 'name_desc') orderBy = 'ps.product_name DESC';

        // Get total count
        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM ProductSummary ps ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        // Get products
        const [products] = await pool.query(
            `SELECT * FROM ProductSummary ps ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        // Get all brands for filter
        const [brands] = await pool.query('SELECT DISTINCT brand FROM Products ORDER BY brand');

        res.json({
            success: true,
            products,
            brands: brands.map(b => b.brand),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Products error:', error);
        res.status(500).json({ success: false, message: 'Failed to load products' });
    }
});

// GET single product detail with ingredients and reviews
router.get('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;

        // Product info from view
        const [products] = await pool.query(
            `SELECT p.*, ps.avg_rating, ps.review_count, ps.ingredient_count
             FROM Products p
             JOIN ProductSummary ps ON p.product_id = ps.product_id
             WHERE p.product_id = ?`,
            [productId]
        );

        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Get ingredients with safety levels (JOIN query)
        const [ingredients] = await pool.query(
            `SELECT i.ingredient_id, i.ingredient_name, i.safety_level, i.description
             FROM Ingredients i
             JOIN Product_Ingredients pi ON i.ingredient_id = pi.ingredient_id
             WHERE pi.product_id = ?
             ORDER BY i.safety_level DESC, i.ingredient_name`,
            [productId]
        );

        // Get reviews with user names (JOIN query)
        const [reviews] = await pool.query(
            `SELECT r.review_id, r.rating, r.comment, r.review_date,
                    u.name AS user_name, u.user_id
             FROM Reviews r
             JOIN Users u ON r.user_id = u.user_id
             WHERE r.product_id = ?
             ORDER BY r.review_date DESC`,
            [productId]
        );

        // Check risky ingredients (using view)
        const [riskyIngredients] = await pool.query(
            `SELECT * FROM RiskyIngredients WHERE product_id = ?`,
            [productId]
        );

        res.json({
            success: true,
            product: products[0],
            ingredients,
            reviews,
            riskyIngredients
        });
    } catch (error) {
        console.error('Product detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to load product details' });
    }
});

// POST add review (protected, triggers check expiry and duplicate)
router.post('/api/products/:id/reviews', isAuthenticated, async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const productId = req.params.id;
        const userId = req.session.user.id;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
        }

        await pool.query(
            'INSERT INTO Reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)',
            [userId, productId, parseInt(rating), comment || null]
        );

        res.json({ success: true, message: 'Review added successfully!' });
    } catch (error) {
        console.error('Review error:', error);
        // Handle trigger errors
        if (error.message.includes('expired product')) {
            return res.status(400).json({ success: false, message: 'Cannot review an expired product' });
        }
        if (error.message.includes('already reviewed')) {
            return res.status(400).json({ success: false, message: 'You have already reviewed this product' });
        }
        res.status(500).json({ success: false, message: 'Failed to add review' });
    }
});

// GET products containing a specific ingredient (JOIN query)
router.get('/api/ingredients/:id/products', async (req, res) => {
    try {
        const [products] = await pool.query(
            `SELECT p.product_id, p.product_name, p.brand, p.category, p.price,
                    ps.avg_rating, ps.review_count
             FROM Products p
             JOIN Product_Ingredients pi ON p.product_id = pi.product_id
             JOIN ProductSummary ps ON p.product_id = ps.product_id
             WHERE pi.ingredient_id = ?
             ORDER BY ps.avg_rating DESC`,
            [req.params.id]
        );

        const [ingredient] = await pool.query(
            'SELECT * FROM Ingredients WHERE ingredient_id = ?',
            [req.params.id]
        );

        res.json({ success: true, ingredient: ingredient[0], products });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load products' });
    }
});

// GET all ingredients
router.get('/api/ingredients', async (req, res) => {
    try {
        const { safety_level, search } = req.query;
        let where = [];
        let params = [];

        if (safety_level) {
            where.push('safety_level = ?');
            params.push(safety_level);
        }
        if (search) {
            where.push('ingredient_name LIKE ?');
            params.push(`%${search}%`);
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        const [ingredients] = await pool.query(
            `SELECT * FROM Ingredients ${whereClause} ORDER BY ingredient_name`,
            params
        );
        res.json({ success: true, ingredients });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load ingredients' });
    }
});

// GET recommendations for logged-in user (using view)
router.get('/api/recommendations', isAuthenticated, async (req, res) => {
    try {
        const [recommendations] = await pool.query(
            `SELECT * FROM UserRecommendations WHERE user_id = ? ORDER BY recommendation_date DESC`,
            [req.session.user.id]
        );
        res.json({ success: true, recommendations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load recommendations' });
    }
});

// POST generate recommendations based on skin quiz
router.post('/api/recommendations/generate', isAuthenticated, async (req, res) => {
    try {
        const { skin_issues } = req.body; // array of skin issues
        const userId = req.session.user.id;

        if (!skin_issues || !Array.isArray(skin_issues) || skin_issues.length === 0) {
            return res.status(400).json({ success: false, message: 'Please select at least one skin concern' });
        }

        // Get user's skin type
        const [userInfo] = await pool.query(
            `SELECT u.skin_type_id, st.skin_type_name 
             FROM Users u 
             LEFT JOIN Skin_Type st ON u.skin_type_id = st.skin_type_id 
             WHERE u.user_id = ?`,
            [userId]
        );

        // Rule-based recommendation: find products with safe ingredients & good ratings
        // that match the skin concerns
        const categoryMap = {
            'Acne': ['Cleanser', 'Serum', 'Toner'],
            'Dark Spots': ['Serum', 'Toner'],
            'Dryness': ['Moisturizer', 'Serum', 'Toner'],
            'Oiliness': ['Cleanser', 'Toner', 'Serum'],
            'Wrinkles': ['Serum', 'Moisturizer'],
            'Redness': ['Moisturizer', 'Serum', 'Toner'],
            'Uneven Tone': ['Serum', 'Toner'],
            'Large Pores': ['Cleanser', 'Toner', 'Serum'],
            'Sun Damage': ['Sunscreen', 'Serum'],
            'Sensitivity': ['Moisturizer', 'Cleanser', 'Toner']
        };

        const allCategories = new Set();
        skin_issues.forEach(issue => {
            const cats = categoryMap[issue] || ['Moisturizer'];
            cats.forEach(c => allCategories.add(c));
        });

        const catArray = [...allCategories];
        const placeholders = catArray.map(() => '?').join(',');

        // Get top-rated products in relevant categories
        const [products] = await pool.query(
            `SELECT ps.* FROM ProductSummary ps
             WHERE ps.category IN (${placeholders})
             AND ps.expiry_date > CURDATE()
             ORDER BY ps.avg_rating DESC, ps.review_count DESC
             LIMIT 10`,
            catArray
        );

        // Delete old recommendations for this user
        await pool.query('DELETE FROM Recommendations WHERE user_id = ?', [userId]);

        // Insert new recommendations
        const recommendations = [];
        for (const product of products) {
            const issue = skin_issues[Math.floor(Math.random() * skin_issues.length)];
            await pool.query(
                'INSERT INTO Recommendations (user_id, product_id, skin_issue) VALUES (?, ?, ?)',
                [userId, product.product_id, issue]
            );
            recommendations.push({ ...product, skin_issue: issue });
        }

        res.json({
            success: true,
            message: `Generated ${recommendations.length} recommendations based on your skin concerns`,
            recommendations
        });
    } catch (error) {
        console.error('Recommendation error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate recommendations' });
    }
});

// GET user reviews
router.get('/api/user/reviews', isAuthenticated, async (req, res) => {
    try {
        const [reviews] = await pool.query(
            `SELECT r.*, p.product_name, p.brand, p.category
             FROM Reviews r
             JOIN Products p ON r.product_id = p.product_id
             WHERE r.user_id = ?
             ORDER BY r.review_date DESC`,
            [req.session.user.id]
        );
        res.json({ success: true, reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load reviews' });
    }
});

// DELETE user review
router.delete('/api/reviews/:id', isAuthenticated, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM Reviews WHERE review_id = ? AND user_id = ?',
            [req.params.id, req.session.user.id]
        );
        res.json({ success: true, message: 'Review deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
});

// GET featured products for homepage
router.get('/api/featured', async (req, res) => {
    try {
        const [topRated] = await pool.query(
            `SELECT * FROM ProductSummary WHERE review_count > 0 ORDER BY avg_rating DESC LIMIT 6`
        );
        const [recentReviews] = await pool.query(`SELECT * FROM RecentReviews LIMIT 5`);
        const [categories] = await pool.query(
            `SELECT category, COUNT(*) as count FROM Products GROUP BY category`
        );
        res.json({ success: true, topRated, recentReviews, categories });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load featured data' });
    }
});

module.exports = router;
