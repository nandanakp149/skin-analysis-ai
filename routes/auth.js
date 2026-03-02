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
        const { name, email, password, age, gender } = req.body;

        // Validation
        if (!name || !email || !password || !age || !gender) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        // Check if user exists
        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert user
        const [result] = await pool.query(
            'INSERT INTO users (name, email, password, age, gender) VALUES (?, ?, ?, ?, ?)',
            [name, email, hashedPassword, parseInt(age), gender]
        );

        // Auto-login after register
        req.session.user = {
            id: result.insertId,
            name,
            email,
            age: parseInt(age),
            gender
        };

        res.json({ success: true, message: 'Registration successful!' });
    } catch (error) {
        console.error('Register error:', error);
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

        // Find user
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
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
            id: user.id,
            name: user.name,
            email: user.email,
            age: user.age,
            gender: user.gender
        };

        res.json({ success: true, message: 'Login successful!' });
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
router.get('/api/user', isAuthenticated, (req, res) => {
    res.json({ success: true, user: req.session.user });
});

module.exports = router;
