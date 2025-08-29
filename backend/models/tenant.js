const pool = require('../database-pool');
const crypto = require('crypto');

class Tenant {
    static async create(tenantData) {
        const {
            name,
            slug,
            subscriptionTier = 'free',
            primaryContactEmail,
            billingEmail
        } = tenantData;

        const awsBucketName = `dataroom-${slug}-${crypto.randomBytes(4).toString('hex')}`;

        const query = `
            INSERT INTO tenants (
                name, slug, subscription_tier, aws_bucket_name,
                primary_contact_email, billing_email
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

        const values = [name, slug, subscriptionTier, awsBucketName, primaryContactEmail, billingEmail];
        const result = await pool.query(query, values);
        return result.rows[0];
    }

    static async findById(id) {
        const query = 'SELECT * FROM tenants WHERE id = $1 AND is_active = true';
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    static async findBySlug(slug) {
        const query = 'SELECT * FROM tenants WHERE slug = $1 AND is_active = true';
        const result = await pool.query(query, [slug]);
        return result.rows[0];
    }

    static async update(id, updates) {
        const allowedFields = [
            'name', 'subscription_tier', 'settings',
            'subscription_status', 'subscription_expires_at',
            'max_users', 'max_storage_gb', 'max_documents',
            'primary_contact_email', 'billing_email'
        ];

        const updateFields = [];
        const values = [];
        let paramCounter = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = $${paramCounter}`);
                values.push(value);
                paramCounter++;
            }
        }

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const query = `
            UPDATE tenants 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCounter}
            RETURNING *
        `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    static async getUsageStats(tenantId) {
        const queries = {
            userCount: `
                SELECT COUNT(*) as count 
                FROM users 
                WHERE tenant_id = $1 AND is_active = true
            `,
            documentCount: `
                SELECT COUNT(*) as count 
                FROM documents 
                WHERE tenant_id = $1
            `,
            storageUsed: `
                SELECT COALESCE(SUM(file_size), 0) as total 
                FROM documents 
                WHERE tenant_id = $1
            `,
            monthlyApiCalls: `
                SELECT COUNT(*) as count 
                FROM analytics_questions 
                WHERE tenant_id = $1 
                AND created_at >= date_trunc('month', CURRENT_DATE)
            `
        };

        const stats = {};
        for (const [key, query] of Object.entries(queries)) {
            const result = await pool.query(query, [tenantId]);
            stats[key] = result.rows[0].count || result.rows[0].total || 0;
        }

        return stats;
    }

    static async checkLimits(tenantId) {
        const tenant = await this.findById(tenantId);
        const usage = await this.getUsageStats(tenantId);

        return {
            users: {
                current: usage.userCount,
                limit: tenant.max_users,
                exceeded: usage.userCount >= tenant.max_users
            },
            documents: {
                current: usage.documentCount,
                limit: tenant.max_documents,
                exceeded: usage.documentCount >= tenant.max_documents
            },
            storage: {
                current: Math.round(usage.storageUsed / (1024 * 1024 * 1024)), // Convert to GB
                limit: tenant.max_storage_gb,
                exceeded: usage.storageUsed >= (tenant.max_storage_gb * 1024 * 1024 * 1024)
            }
        };
    }

    static async getAllForSuperAdmin() {
        const query = `
            SELECT 
                t.*,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(DISTINCT d.id) as document_count,
                COALESCE(SUM(d.file_size), 0) as storage_used
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.is_active = true
            LEFT JOIN documents d ON d.tenant_id = t.id
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `;

        const result = await pool.query(query);
        return result.rows;
    }

    static async getAnalyticsForSuperAdmin(startDate, endDate) {
        const query = `
            SELECT 
                t.id,
                t.name,
                t.slug,
                COUNT(DISTINCT aq.id) as total_questions,
                COUNT(DISTINCT as2.id) as total_sessions,
                COUNT(DISTINCT ad.id) as document_interactions,
                AVG(aq.processing_time) as avg_processing_time
            FROM tenants t
            LEFT JOIN analytics_questions aq ON aq.tenant_id = t.id 
                AND aq.created_at BETWEEN $1 AND $2
            LEFT JOIN analytics_sessions as2 ON as2.tenant_id = t.id 
                AND as2.login_time BETWEEN $1 AND $2
            LEFT JOIN analytics_documents ad ON ad.tenant_id = t.id 
                AND ad.timestamp BETWEEN $1 AND $2
            GROUP BY t.id, t.name, t.slug
            ORDER BY total_questions DESC
        `;

        const result = await pool.query(query, [startDate, endDate]);
        return result.rows;
    }

    static async logAudit(tenantId, userId, action, entityType, entityId, details) {
        const query = `
            INSERT INTO tenant_audit_logs (
                tenant_id, user_id, action, entity_type, entity_id, details
            )
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        await pool.query(query, [tenantId, userId, action, entityType, entityId, details]);
    }

    static async updateUsageTracking(tenantId) {
        const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
        
        const usage = await this.getUsageStats(tenantId);
        
        const query = `
            INSERT INTO tenant_usage (
                tenant_id, month, documents_count, storage_used_mb, 
                api_calls_count, active_users_count
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, month) 
            DO UPDATE SET
                documents_count = $3,
                storage_used_mb = $4,
                api_calls_count = $5,
                active_users_count = $6,
                updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [
            tenantId,
            currentMonth,
            usage.documentCount,
            Math.round(usage.storageUsed / (1024 * 1024)), // Convert to MB
            usage.monthlyApiCalls,
            usage.userCount
        ]);
    }
}

module.exports = Tenant;