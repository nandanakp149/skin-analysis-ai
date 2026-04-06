// Authentication middleware
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    // Check if it's an API request
    if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ success: false, message: 'Please login to continue' });
    }
    return res.redirect('/login');
}

function isGuest(req, res, next) {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    return next();
}

function isAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    if (req.originalUrl && req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    return res.redirect('/login');
}

module.exports = { isAuthenticated, isGuest, isAdmin };
