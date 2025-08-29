const jwt = require('jsonwebtoken');
const pool = require('../database-pool');

const tenantMiddleware = {
    // Extract and validate tenant context from JWT
    extractTenant: async (req, res, next) => {
        try {
            // Get tenant from authenticated user
            if (req.user && req.user.tenant_id) {
                const tenantQuery = 'SELECT * FROM tenants WHERE id = $1 AND is_active = true';
                const tenantResult = await pool.query(tenantQuery, [req.user.tenant_id]);
                
                if (tenantResult.rows.length === 0) {
                    return res.status(403).json({ error: 'Invalid or inactive tenant' });
                }
                
                req.tenant = tenantResult.rows[0];
                req.tenantId = req.tenant.id;
            }
            
            next();
        } catch (error) {
            console.error('Tenant extraction error:', error);
            res.status(500).json({ error: 'Failed to validate tenant context' });
        }
    },

    // Ensure user has access to the requested tenant
    validateTenantAccess: (req, res, next) => {
        // Superadmins can access any tenant
        if (req.user.global_role === 'superadmin') {
            return next();
        }

        // Regular users can only access their own tenant
        if (req.params.tenantId && req.params.tenantId !== req.user.tenant_id) {
            return res.status(403).json({ error: 'Access denied to this tenant' });
        }

        next();
    },

    // Role-based access control with tenant context
    requireRole: (allowedRoles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            // Check global role first (for superadmin)
            if (req.user.global_role && allowedRoles.includes(req.user.global_role)) {
                return next();
            }

            // Check tenant role
            if (req.user.tenant_role && allowedRoles.includes(req.user.tenant_role)) {
                return next();
            }

            res.status(403).json({ error: 'Insufficient permissions' });
        };
    },

    // Apply tenant filter to queries
    applyTenantFilter: (req, res, next) => {
        // Superadmins can see all data if they choose
        if (req.user.global_role === 'superadmin' && req.query.allTenants === 'true') {
            req.tenantFilter = {}; // No filter
        } else if (req.tenantId) {
            req.tenantFilter = { tenant_id: req.tenantId };
        } else {
            return res.status(400).json({ error: 'Tenant context required' });
        }
        
        next();
    },

    // Check tenant resource limits
    checkTenantLimits: (resourceType) => {
        return async (req, res, next) => {
            if (req.user.global_role === 'superadmin') {
                return next(); // Superadmins bypass limits
            }

            try {
                const Tenant = require('../models/tenant');
                const limits = await Tenant.checkLimits(req.tenantId);

                if (limits[resourceType] && limits[resourceType].exceeded) {
                    return res.status(403).json({
                        error: `Tenant limit exceeded for ${resourceType}`,
                        limit: limits[resourceType].limit,
                        current: limits[resourceType].current
                    });
                }

                next();
            } catch (error) {
                console.error('Limit check error:', error);
                res.status(500).json({ error: 'Failed to check tenant limits' });
            }
        };
    },

    // Log tenant activity
    logActivity: (action, entityType) => {
        return async (req, res, next) => {
            // Store original send function
            const originalSend = res.send;
            
            // Override send function to log after successful response
            res.send = function(data) {
                // Call original send
                originalSend.call(this, data);
                
                // Log activity if response was successful
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    const Tenant = require('../models/tenant');
                    const details = {
                        method: req.method,
                        path: req.path,
                        query: req.query,
                        ip: req.ip,
                        userAgent: req.get('user-agent')
                    };
                    
                    // Extract entity ID from params or body
                    const entityId = req.params.id || req.body.id || null;
                    
                    // Log asynchronously without blocking response
                    Tenant.logAudit(
                        req.tenantId,
                        req.user.id,
                        action,
                        entityType,
                        entityId,
                        details
                    ).catch(err => console.error('Audit log error:', err));
                }
            };
            
            next();
        };
    },

    // Middleware for superadmin only endpoints
    requireSuperAdmin: (req, res, next) => {
        if (!req.user || req.user.global_role !== 'superadmin') {
            return res.status(403).json({ error: 'Superadmin access required' });
        }
        next();
    },

    // Middleware for tenant admin only endpoints
    requireTenantAdmin: (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Superadmins always have access
        if (req.user.global_role === 'superadmin') {
            return next();
        }

        // Check if user is admin of their tenant
        if (req.user.tenant_role !== 'admin') {
            return res.status(403).json({ error: 'Tenant admin access required' });
        }

        next();
    },

    // Set tenant context for new resources
    setTenantContext: (req, res, next) => {
        if (req.tenantId) {
            // Automatically add tenant_id to request body for creates
            if (req.method === 'POST' && req.body) {
                req.body.tenant_id = req.tenantId;
            }
        }
        next();
    }
};

module.exports = tenantMiddleware;