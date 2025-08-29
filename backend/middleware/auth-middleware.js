const jwt = require('jsonwebtoken');
const AuthService = require('../services/auth-service');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

const authMiddleware = {
    // Basic authentication
    authenticateToken: async (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            // Get full user details with tenant
            const user = await AuthService.getUserWithTenant(decoded.id);
            
            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }

            req.user = user;
            next();
        } catch (error) {
            console.error('Auth error:', error);
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
    },

    // Require specific role
    requireRole: (roles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const userRoles = [req.user.global_role, req.user.tenant_role].filter(Boolean);
            const hasRole = roles.some(role => userRoles.includes(role));

            if (!hasRole) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            next();
        };
    },

    // Legacy middleware for backward compatibility
    requireAdmin: (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.global_role === 'superadmin' || 
            req.user.tenant_role === 'admin') {
            return next();
        }

        res.status(403).json({ error: 'Admin access required' });
    }
};

module.exports = authMiddleware;