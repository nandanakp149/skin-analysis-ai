const express = require('express');
const path = require('path');
const session = require('express-session');
const { initializeDatabase } = require('./config/database');
const { isAuthenticated, isGuest, isAdmin } = require('./middleware/auth');
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
const productRoutes = require('./routes/products');
const adminRoutes = require('./routes/admin');

app.use('/', authRoutes);
app.use('/', analysisRoutes);
app.use('/', productRoutes);
app.use('/', adminRoutes);

// Page routes - Public
app.get('/', (req, res) => {
    res.sendFile('homepage.html', { root: './public' });
});

// Page routes - Guest
app.get('/login', isGuest, (req, res) => {
    res.sendFile('login.html', { root: './public' });
});

app.get('/register', isGuest, (req, res) => {
    res.sendFile('register.html', { root: './public' });
});

// Page routes - Authenticated
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile('dashboard.html', { root: './public' });
});

app.get('/analyze', isAuthenticated, (req, res) => {
    res.sendFile('analyze.html', { root: './public' });
});

app.get('/history', isAuthenticated, (req, res) => {
    res.sendFile('history.html', { root: './public' });
});

app.get('/products', (req, res) => {
    res.sendFile('products.html', { root: './public' });
});

app.get('/products/:id', (req, res) => {
    res.sendFile('product-detail.html', { root: './public' });
});

app.get('/skin-quiz', isAuthenticated, (req, res) => {
    res.sendFile('skin-quiz.html', { root: './public' });
});

app.get('/my-recommendations', isAuthenticated, (req, res) => {
    res.sendFile('recommendations.html', { root: './public' });
});

// Admin pages
app.get('/admin', isAdmin, (req, res) => {
    res.sendFile('admin.html', { root: './public' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile('404.html', { root: './public' });
});

// Initialize DB and start server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🧴 Skin Analyser is running at http://localhost:${PORT}`);
        console.log(`   Homepage:  http://localhost:${PORT}/`);
        console.log(`   Products:  http://localhost:${PORT}/products`);
        console.log(`   Register:  http://localhost:${PORT}/register`);
        console.log(`   Login:     http://localhost:${PORT}/login`);
        console.log(`   Admin:     http://localhost:${PORT}/admin`);
        console.log(`   (Admin login: admin@skincare.com / admin123)\n`);
    });
});
