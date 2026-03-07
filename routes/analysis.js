const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'));
    }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// POST Analyze skin
router.post('/api/analyze', isAuthenticated, upload.single('skinImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload an image' });
        }

        const user = req.session.user;
        const imagePath = req.file.path;
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = req.file.mimetype;

        // Use Gemini 1.5 Flash for vision analysis
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `You are an expert dermatologist and skincare advisor. Analyze the skin in this image for a ${user.age}-year-old ${user.gender}.

Please provide a comprehensive analysis in the following structured format:

## 🔍 Skin Analysis

### Skin Type
Identify the skin type (oily, dry, combination, normal, sensitive).

### Skin Concerns Detected
List all visible skin concerns (e.g., acne, dark spots, wrinkles, uneven tone, dryness, redness, etc.)

### Detailed Assessment
Provide a detailed assessment of the skin condition considering the person's age (${user.age}) and gender (${user.gender}).

## 💡 Recommendations

### Daily Skincare Routine
Provide a morning and evening routine with specific steps:
- **Morning Routine:** (cleanser, toner, serum, moisturizer, sunscreen)
- **Evening Routine:** (cleanser, treatment, moisturizer)

### Lifestyle Tips
Suggest dietary and lifestyle changes that can improve skin health.

## 🛒 Recommended Products

For each product recommendation, provide:
1. **Product Name** - Brand and specific product name
2. **Why it helps** - Brief explanation
3. **Key Ingredients** - Active ingredients to look for
4. **Price Range** - Approximate price
5. **Where to Buy** - Suggest major online retailers (Amazon, Nykaa, Sephora etc.) with search links

Please recommend at least 5-6 products covering:
- Cleanser
- Moisturizer  
- Sunscreen
- Treatment/Serum (specific to detected concerns)
- Exfoliant
- Any additional targeted treatment

Format the product links as clickable URLs like:
- Amazon: https://www.amazon.com/s?k=PRODUCT+NAME
- Nykaa: https://www.nykaa.com/search/result/?q=PRODUCT+NAME

## ⚠️ Important Disclaimer
Remind that this is AI-based analysis and recommend consulting a dermatologist for persistent skin issues.

Make the response detailed, helpful, and personalized for a ${user.age}-year-old ${user.gender}.`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);

        const analysisText = result.response.text();

        // Save to database
        await pool.query(
            'INSERT INTO Analysis_History (user_id, image_path, analysis_result) VALUES (?, ?, ?)',
            [user.id, req.file.filename, analysisText]
        );

        res.json({
            success: true,
            analysis: analysisText,
            imageUrl: `/uploads/${req.file.filename}`
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to analyze the image. Please try again.',
            error: error.message
        });
    }
});

// GET Analysis history
router.get('/api/history', isAuthenticated, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, image_path, analysis_result, created_at FROM Analysis_History WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
            [req.session.user.id]
        );
        res.json({ success: true, history: rows });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ success: false, message: 'Failed to load history' });
    }
});

// DELETE Analysis entry
router.delete('/api/history/:id', isAuthenticated, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT image_path FROM Analysis_History WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.user.id]
        );

        if (rows.length > 0) {
            // Delete image file
            const imagePath = path.join(__dirname, '..', 'uploads', rows[0].image_path);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            // Delete DB record
            await pool.query('DELETE FROM Analysis_History WHERE id = ? AND user_id = ?',
                [req.params.id, req.session.user.id]);
        }

        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete' });
    }
});

module.exports = router;
