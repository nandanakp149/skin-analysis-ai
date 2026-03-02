const express = require('express');
const path = require('path');
const session = require('express-session');
const { initializeDatabase } = require('./config/database');
const { isAuthenticated, isGuest } = require('./middleware/auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'skin-analyser-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true
    }
}));

// Routes
const authRoutes = require('./routes/auth');
const analysisRoutes = require('./routes/analysis');

app.use('/', authRoutes);
app.use('/', analysisRoutes);

// Page routes
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile('dashboard.html', { root: './public' });
});

app.get('/analyze', isAuthenticated, (req, res) => {
    res.sendFile('analyze.html', { root: './public' });
});

app.get('/history', isAuthenticated, (req, res) => {
    res.sendFile('history.html', { root: './public' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile('404.html', { root: './public' });
});

// Initialize DB and start server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🧴 Skin Analyser is running at http://localhost:${PORT}`);
        console.log(`   Register: http://localhost:${PORT}/register`);
        console.log(`   Login:    http://localhost:${PORT}/login\n`);
    });
});
