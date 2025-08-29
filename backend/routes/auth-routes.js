const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const AuthService = require('../services/auth-service');
const pool = require('../database');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireAdmin } = require('../middleware/auth-middleware');
const tenantMiddleware = require('../middleware/tenant-middleware');

// Rate limiting for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts, please try again later.' }
});

// Public login endpoint with tenant context
router.post('/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password, tenantSlug } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Authenticate user
        const result = await AuthService.authenticate(email, password, tenantSlug);

        res.json({
            success: true,
            token: result.token,
            user: result.user
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({
            success: false,
            error: error.message || 'Invalid credentials'
        });
    }
});

// Get current user profile with tenant info
router.get('/auth/profile', authenticateToken, async (req, res) => {
    try {
        const user = await AuthService.getUserWithTenant(req.user.id);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                global_role: user.global_role,
                tenant_role: user.tenant_role,
                tenant: user.tenant_id ? {
                    id: user.tenant_id,
                    name: user.tenant_name,
                    slug: user.tenant_slug,
                    subscription_tier: user.subscription_tier
                } : null,
                settings: {
                    company_name: user.company_name,
                    logo_url: user.logo_url,
                    primary_color: user.primary_color,
                    app_title: user.app_title
                }
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve profile'
        });
    }
});

// Register new user (tenant admin only)
router.post('/auth/register',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.checkTenantLimits('users'),
    async (req, res) => {
        try {
            const { email, password, name, role = 'user' } = req.body;

            if (!email || !password || !name) {
                return res.status(400).json({
                    success: false,
                    error: 'Email, password, and name are required'
                });
            }

            // Validate role
            const allowedRoles = ['user', 'admin'];
            if (!allowedRoles.includes(role)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid role'
                });
            }

            // Only superadmin can create other admins
            if (role === 'admin' && req.user.global_role !== 'superadmin') {
                return res.status(403).json({
                    success: false,
                    error: 'Only superadmin can create admin users'
                });
            }

            const newUser = await AuthService.createUser(
                {
                    email,
                    password,
                    name,
                    role,
                    tenantId: req.tenantId
                },
                req.user
            );

            res.status(201).json({
                success: true,
                user: newUser
            });
        } catch (error) {
            console.error('Register error:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Failed to create user'
            });
        }
    }
);

// Get all users in tenant (admin only)
router.get('/auth/users',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            let query;
            let params;

            if (req.user.global_role === 'superadmin' && req.query.allTenants === 'true') {
                // Superadmin can see all users across tenants
                query = `
                    SELECT 
                        u.*,
                        t.name as tenant_name,
                        t.slug as tenant_slug
                    FROM users u
                    LEFT JOIN tenants t ON u.tenant_id = t.id
                    ORDER BY u.created_at DESC
                `;
                params = [];
            } else {
                // Tenant admin sees only their tenant's users
                query = `
                    SELECT * FROM users 
                    WHERE tenant_id = $1
                    ORDER BY created_at DESC
                `;
                params = [req.tenantId];
            }

            const result = await pool.query(query, params);
            
            const sanitizedUsers = result.rows.map(user => ({
                id: user.id,
                email: user.email,
                name: user.name,
                global_role: user.global_role,
                tenant_role: user.tenant_role,
                tenant_name: user.tenant_name,
                tenant_slug: user.tenant_slug,
                is_active: user.is_active,
                created_at: user.created_at,
                last_login: user.last_login
            }));

            res.json({
                success: true,
                users: sanitizedUsers
            });
        } catch (error) {
            console.error('Get users error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve users'
            });
        }
    }
);

// Update user (admin only)
router.put('/auth/users/:id',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const userId = req.params.id;
            const { name, role, is_active } = req.body;

            // Get the user to update
            const userQuery = 'SELECT * FROM users WHERE id = $1';
            const userResult = await pool.query(userQuery, [userId]);
            const user = userResult.rows[0];

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            // Check tenant access
            if (req.user.global_role !== 'superadmin' && user.tenant_id !== req.tenantId) {
                return res.status(403).json({
                    success: false,
                    error: 'Cannot update users from other tenants'
                });
            }

            // Build update query
            const updates = [];
            const values = [];
            let paramCount = 1;

            if (name !== undefined) {
                updates.push(`name = $${paramCount}`);
                values.push(name);
                paramCount++;
            }

            if (role !== undefined) {
                // Only superadmin can change roles to admin
                if (role === 'admin' && req.user.global_role !== 'superadmin') {
                    return res.status(403).json({
                        success: false,
                        error: 'Only superadmin can assign admin role'
                    });
                }
                updates.push(`tenant_role = $${paramCount}`);
                values.push(role);
                paramCount++;
            }

            if (is_active !== undefined) {
                updates.push(`is_active = $${paramCount}`);
                values.push(is_active);
                paramCount++;
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid fields to update'
                });
            }

            values.push(userId);
            const updateQuery = `
                UPDATE users 
                SET ${updates.join(', ')}
                WHERE id = $${paramCount}
                RETURNING *
            `;

            const result = await pool.query(updateQuery, values);
            const updatedUser = result.rows[0];

            res.json({
                success: true,
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    tenant_role: updatedUser.tenant_role,
                    is_active: updatedUser.is_active
                }
            });
        } catch (error) {
            console.error('Update user error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update user'
            });
        }
    }
);

// Delete user (admin only)
router.delete('/auth/users/:id',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const userId = req.params.id;

            // Prevent self-deletion
            if (userId === req.user.id) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete your own account'
                });
            }

            // Check if user exists and belongs to tenant
            const checkQuery = 'SELECT * FROM users WHERE id = $1';
            const checkResult = await pool.query(checkQuery, [userId]);
            const user = checkResult.rows[0];

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            // Check tenant access
            if (req.user.global_role !== 'superadmin' && user.tenant_id !== req.tenantId) {
                return res.status(403).json({
                    success: false,
                    error: 'Cannot delete users from other tenants'
                });
            }

            // Prevent deletion of admins by non-superadmins
            if (user.tenant_role === 'admin' && req.user.global_role !== 'superadmin') {
                return res.status(403).json({
                    success: false,
                    error: 'Only superadmin can delete admin users'
                });
            }

            // Soft delete (set is_active = false)
            const deleteQuery = 'UPDATE users SET is_active = false WHERE id = $1';
            await pool.query(deleteQuery, [userId]);

            res.json({
                success: true,
                message: 'User deactivated successfully'
            });
        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete user'
            });
        }
    }
);

// Change password
router.put('/auth/change-password',
    authenticateToken,
    async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Current and new passwords are required'
                });
            }

            // Verify current password
            const userQuery = 'SELECT password FROM users WHERE id = $1';
            const userResult = await pool.query(userQuery, [req.user.id]);
            const user = userResult.rows[0];

            const isValidPassword = await bcrypt.compare(currentPassword, user.password);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'Current password is incorrect'
                });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password
            const updateQuery = 'UPDATE users SET password = $1 WHERE id = $2';
            await pool.query(updateQuery, [hashedPassword, req.user.id]);

            res.json({
                success: true,
                message: 'Password changed successfully'
            });
        } catch (error) {
            console.error('Change password error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to change password'
            });
        }
    }
);

// Create invitation (admin only)
router.post('/auth/invite',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.checkTenantLimits('users'),
    async (req, res) => {
        try {
            const { email, role = 'user' } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
            }

            // Check if user already exists
            const existingQuery = 'SELECT id FROM users WHERE email = $1 AND tenant_id = $2';
            const existing = await pool.query(existingQuery, [email, req.tenantId]);
            
            if (existing.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'User already exists in this organization'
                });
            }

            // Generate invitation token
            const crypto = require('crypto');
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

            // Create invitation
            const inviteQuery = `
                INSERT INTO tenant_invitations 
                (tenant_id, email, role, invited_by, token, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;

            const result = await pool.query(inviteQuery, [
                req.tenantId,
                email,
                role,
                req.user.id,
                token,
                expiresAt
            ]);

            // TODO: Send invitation email

            res.status(201).json({
                success: true,
                invitation: {
                    id: result.rows[0].id,
                    email: result.rows[0].email,
                    role: result.rows[0].role,
                    expires_at: result.rows[0].expires_at,
                    invitation_link: `/invite/${token}` // Frontend will handle this
                }
            });
        } catch (error) {
            console.error('Create invitation error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create invitation'
            });
        }
    }
);

// Accept invitation (public)
router.post('/auth/accept-invite', async (req, res) => {
    try {
        const { token, password, name } = req.body;

        if (!token || !password || !name) {
            return res.status(400).json({
                success: false,
                error: 'Token, password, and name are required'
            });
        }

        // Get invitation
        const inviteQuery = `
            SELECT i.*, t.name as tenant_name, t.slug as tenant_slug
            FROM tenant_invitations i
            JOIN tenants t ON i.tenant_id = t.id
            WHERE i.token = $1 
            AND i.expires_at > CURRENT_TIMESTAMP
            AND i.accepted_at IS NULL
        `;

        const inviteResult = await pool.query(inviteQuery, [token]);
        const invitation = inviteResult.rows[0];

        if (!invitation) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired invitation'
            });
        }

        // Create user
        const hashedPassword = await bcrypt.hash(password, 10);
        const userQuery = `
            INSERT INTO users (
                email, password, name, tenant_id, tenant_role, is_active
            )
            VALUES ($1, $2, $3, $4, $5, true)
            RETURNING *
        `;

        const userResult = await pool.query(userQuery, [
            invitation.email,
            hashedPassword,
            name,
            invitation.tenant_id,
            invitation.role
        ]);

        // Mark invitation as accepted
        await pool.query(
            'UPDATE tenant_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = $1',
            [invitation.id]
        );

        // Generate token
        const user = userResult.rows[0];
        const authToken = AuthService.generateToken(user, { slug: invitation.tenant_slug });

        res.status(201).json({
            success: true,
            token: authToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                tenant_role: user.tenant_role,
                tenant_name: invitation.tenant_name,
                tenant_slug: invitation.tenant_slug
            }
        });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to accept invitation'
        });
    }
});

module.exports = router;