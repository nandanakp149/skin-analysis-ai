const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { isAuthenticated, isGuest } = require('../middleware/auth');
const router = express.Router();

// GET Register page
router.get('/register', isGuest, (req, res) => {
    res.sendFile('register.html', { root: './public' });
});

// POST Register
router.post('/register', isGuest, async (req, res) => {
    try {
        const { name, email, password, age, gender, skin_type_id } = req.body;

        // Validation
        if (!name || !email || !password || !age || !gender) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (parseInt(age) < 18) {
            return res.status(400).json({ success: false, message: 'You must be at least 18 years old' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        // Check if user exists
        const [existing] = await pool.query('SELECT user_id FROM Users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert user
        const skinTypeId = skin_type_id ? parseInt(skin_type_id) : null;
        const [result] = await pool.query(
            'INSERT INTO Users (name, email, password, age, gender, skin_type_id) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, hashedPassword, parseInt(age), gender, skinTypeId]
        );

        // Auto-login after register
        req.session.user = {
            id: result.insertId,
            name,
            email,
            age: parseInt(age),
            gender,
            skin_type_id: skinTypeId,
            role: 'user'
        };

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ success: false, message: 'Session error. Please try again.' });
            }
            res.json({ success: true, message: 'Registration successful!' });
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// GET Login page
router.get('/login', isGuest, (req, res) => {
    res.sendFile('login.html', { root: './public' });
});

// POST Login
router.post('/login', isGuest, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        // Find user with skin type info
        const [users] = await pool.query(
            `SELECT u.*, st.skin_type_name 
             FROM Users u 
             LEFT JOIN Skin_Type st ON u.skin_type_id = st.skin_type_id 
             WHERE u.email = ?`,
            [email]
        );
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const user = users[0];

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // Set session
        req.session.user = {
            id: user.user_id,
            name: user.name,
            email: user.email,
            age: user.age,
            gender: user.gender,
            skin_type_id: user.skin_type_id,
            skin_type_name: user.skin_type_name,
            role: user.role
        };

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ success: false, message: 'Session error. Please try again.' });
            }
            res.json({ success: true, message: 'Login successful!', role: user.role });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// GET Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/login');
    });
});

// GET User info (API)
router.get('/api/user', isAuthenticated, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.age, u.gender, u.skin_type_id, u.role, u.registration_date,
                    st.skin_type_name
             FROM Users u 
             LEFT JOIN Skin_Type st ON u.skin_type_id = st.skin_type_id 
             WHERE u.user_id = ?`,
            [req.session.user.id]
        );
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, user: users[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT Update user profile
router.put('/api/user/profile', isAuthenticated, async (req, res) => {
    try {
        const { name, age, gender, skin_type_id } = req.body;
        await pool.query(
            'UPDATE Users SET name = ?, age = ?, gender = ?, skin_type_id = ? WHERE user_id = ?',
            [name, parseInt(age), gender, skin_type_id ? parseInt(skin_type_id) : null, req.session.user.id]
        );
        // Update session
        req.session.user.name = name;
        req.session.user.age = parseInt(age);
        req.session.user.gender = gender;
        req.session.user.skin_type_id = skin_type_id ? parseInt(skin_type_id) : null;
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

// GET Skin types
router.get('/api/skin-types', async (req, res) => {
    try {
        const [types] = await pool.query('SELECT * FROM Skin_Type ORDER BY skin_type_id');
        res.json({ success: true, skinTypes: types });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load skin types' });
    }
});

module.exports = router;
