const express = require('express');
const router = express.Router();
const Tenant = require('../models/tenant');
const AuthService = require('../services/auth-service');
const tenantMiddleware = require('../middleware/tenant-middleware');
const { authenticateToken } = require('../middleware/auth-middleware');

// Superadmin: Get all tenants with stats
router.get('/tenants', 
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const tenants = await Tenant.getAllForSuperAdmin();
            res.json({
                success: true,
                tenants
            });
        } catch (error) {
            console.error('Get tenants error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve tenants'
            });
        }
    }
);

// Superadmin: Get tenant analytics
router.get('/tenants/analytics',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const end = endDate || new Date();

            const analytics = await Tenant.getAnalyticsForSuperAdmin(start, end);
            
            res.json({
                success: true,
                analytics,
                period: { startDate: start, endDate: end }
            });
        } catch (error) {
            console.error('Get tenant analytics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve analytics'
            });
        }
    }
);

// Superadmin: Create new tenant
router.post('/tenants',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const { tenant, admin } = req.body;

            if (!tenant.name || !tenant.slug) {
                return res.status(400).json({
                    success: false,
                    error: 'Tenant name and slug are required'
                });
            }

            if (!admin.email || !admin.password || !admin.name) {
                return res.status(400).json({
                    success: false,
                    error: 'Admin email, password, and name are required'
                });
            }

            const result = await AuthService.createTenant(tenant, admin);

            res.status(201).json({
                success: true,
                tenant: result.tenant,
                admin: {
                    id: result.admin.id,
                    email: result.admin.email,
                    name: result.admin.name
                }
            });
        } catch (error) {
            console.error('Create tenant error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create tenant'
            });
        }
    }
);

// Superadmin: Update tenant
router.put('/tenants/:id',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const tenantId = req.params.id;
            const updates = req.body;

            const updatedTenant = await Tenant.update(tenantId, updates);

            res.json({
                success: true,
                tenant: updatedTenant
            });
        } catch (error) {
            console.error('Update tenant error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to update tenant'
            });
        }
    }
);

// Get current tenant info
router.get('/tenant/current',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            if (!req.tenant) {
                return res.status(404).json({
                    success: false,
                    error: 'No tenant context'
                });
            }

            const usage = await Tenant.getUsageStats(req.tenantId);
            const limits = await Tenant.checkLimits(req.tenantId);

            res.json({
                success: true,
                tenant: {
                    id: req.tenant.id,
                    name: req.tenant.name,
                    slug: req.tenant.slug,
                    subscription_tier: req.tenant.subscription_tier,
                    usage,
                    limits
                }
            });
        } catch (error) {
            console.error('Get current tenant error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve tenant information'
            });
        }
    }
);

// Tenant admin: Get tenant usage
router.get('/tenant/usage',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const usage = await Tenant.getUsageStats(req.tenantId);
            const limits = await Tenant.checkLimits(req.tenantId);

            res.json({
                success: true,
                usage,
                limits
            });
        } catch (error) {
            console.error('Get tenant usage error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve usage information'
            });
        }
    }
);

// Tenant admin: Get audit logs
router.get('/tenant/audit-logs',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const { startDate, endDate, action, entityType } = req.query;
            
            let query = `
                SELECT 
                    al.*,
                    u.email as user_email,
                    u.name as user_name
                FROM tenant_audit_logs al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.tenant_id = $1
            `;
            
            const params = [req.tenantId];
            let paramCount = 2;

            if (startDate) {
                query += ` AND al.created_at >= $${paramCount}`;
                params.push(startDate);
                paramCount++;
            }

            if (endDate) {
                query += ` AND al.created_at <= $${paramCount}`;
                params.push(endDate);
                paramCount++;
            }

            if (action) {
                query += ` AND al.action = $${paramCount}`;
                params.push(action);
                paramCount++;
            }

            if (entityType) {
                query += ` AND al.entity_type = $${paramCount}`;
                params.push(entityType);
                paramCount++;
            }

            query += ' ORDER BY al.created_at DESC LIMIT 100';

            const pool = require('../database');
            const result = await pool.query(query, params);

            res.json({
                success: true,
                logs: result.rows
            });
        } catch (error) {
            console.error('Get audit logs error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve audit logs'
            });
        }
    }
);

module.exports = router;