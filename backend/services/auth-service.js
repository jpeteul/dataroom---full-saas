const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../database');
const Tenant = require('../models/tenant');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

class AuthService {
    // Generate JWT with tenant context
    static generateToken(user, tenant = null) {
        const payload = {
            id: user.id,
            email: user.email,
            global_role: user.global_role,
            tenant_role: user.tenant_role,
            tenant_id: user.tenant_id,
            tenant_slug: tenant?.slug
        };

        return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    }

    // Authenticate user with tenant context
    static async authenticate(email, password, tenantSlug = null) {
        let query;
        let params;

        if (tenantSlug) {
            // Tenant-specific login
            query = `
                SELECT u.*, t.slug as tenant_slug, t.name as tenant_name
                FROM users u
                JOIN tenants t ON u.tenant_id = t.id
                WHERE u.email = $1 AND t.slug = $2 AND u.is_active = true
            `;
            params = [email, tenantSlug];
        } else {
            // Superadmin login (no tenant required)
            query = `
                SELECT u.* 
                FROM users u
                WHERE u.email = $1 AND u.global_role = 'superadmin' AND u.is_active = true
            `;
            params = [email];
        }

        const result = await pool.query(query, params);
        const user = result.rows[0];

        if (!user) {
            throw new Error('Invalid credentials');
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            throw new Error('Invalid credentials');
        }

        // Update last login
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        // Log session
        if (user.tenant_id) {
            await pool.query(
                `INSERT INTO analytics_sessions (user_id, tenant_id, login_time, ip_address, user_agent)
                 VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)`,
                [user.id, user.tenant_id, '0.0.0.0', 'web']
            );
        }

        const token = this.generateToken(user, { slug: user.tenant_slug });

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                global_role: user.global_role,
                tenant_role: user.tenant_role,
                tenant_id: user.tenant_id,
                tenant_name: user.tenant_name,
                tenant_slug: user.tenant_slug
            }
        };
    }

    // Create new user with tenant assignment
    static async createUser(userData, createdBy) {
        const {
            email,
            password,
            name,
            role = 'user',
            tenantId
        } = userData;

        // Check if email already exists in tenant
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
            [email, tenantId]
        );

        if (existingUser.rows.length > 0) {
            throw new Error('User already exists in this organization');
        }

        // Check tenant limits
        if (createdBy.global_role !== 'superadmin') {
            const limits = await Tenant.checkLimits(tenantId);
            if (limits.users.exceeded) {
                throw new Error(`User limit reached (${limits.users.limit} users maximum)`);
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const query = `
            INSERT INTO users (email, password, name, tenant_role, tenant_id, is_active)
            VALUES ($1, $2, $3, $4, $5, true)
            RETURNING id, email, name, tenant_role, tenant_id
        `;

        const result = await pool.query(query, [
            email,
            hashedPassword,
            name,
            role,
            tenantId
        ]);

        // Log audit
        await Tenant.logAudit(
            tenantId,
            createdBy.id,
            'USER_CREATED',
            'user',
            result.rows[0].id,
            { email, role }
        );

        return result.rows[0];
    }

    // Create tenant with admin user
    static async createTenant(tenantData, adminData) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Create tenant
            const tenant = await Tenant.create(tenantData);

            // Create admin user for the tenant
            const hashedPassword = await bcrypt.hash(adminData.password, 10);
            
            const userQuery = `
                INSERT INTO users (
                    email, password, name, 
                    tenant_id, tenant_role, global_role, is_active
                )
                VALUES ($1, $2, $3, $4, 'admin', 'user', true)
                RETURNING *
            `;

            const userResult = await client.query(userQuery, [
                adminData.email,
                hashedPassword,
                adminData.name,
                tenant.id
            ]);

            // Create tenant settings
            const settingsQuery = `
                INSERT INTO tenant_settings (
                    tenant_id, company_name, app_title
                )
                VALUES ($1, $2, $3)
            `;

            await client.query(settingsQuery, [
                tenant.id,
                tenantData.name,
                `${tenantData.name} DataRoom`
            ]);

            // Create S3 bucket for tenant
            const S3Service = require('./s3-service');
            const s3Service = new S3Service();
            await s3Service.createClientBucket(tenant.slug);

            await client.query('COMMIT');

            return {
                tenant,
                admin: userResult.rows[0]
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Verify JWT token
    static verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            throw new Error('Invalid token');
        }
    }

    // Get user with tenant context
    static async getUserWithTenant(userId) {
        const query = `
            SELECT 
                u.*,
                t.name as tenant_name,
                t.slug as tenant_slug,
                t.subscription_tier,
                ts.company_name,
                ts.logo_url,
                ts.primary_color,
                ts.app_title
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            LEFT JOIN tenant_settings ts ON t.id = ts.tenant_id
            WHERE u.id = $1 AND u.is_active = true
        `;

        const result = await pool.query(query, [userId]);
        return result.rows[0];
    }

    // Check if user has permission
    static hasPermission(user, requiredRole) {
        const roleHierarchy = {
            'superadmin': 3,
            'admin': 2,
            'user': 1,
            'investor': 1 // Legacy support
        };

        const userLevel = roleHierarchy[user.global_role] || roleHierarchy[user.tenant_role] || 0;
        const requiredLevel = roleHierarchy[requiredRole] || 0;

        return userLevel >= requiredLevel;
    }
}

module.exports = AuthService;