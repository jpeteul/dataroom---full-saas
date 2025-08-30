require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./database-pool');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

// Database initialization and migration logic
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function checkAndInitializeDatabase() {
    console.log('🔍 Checking database state...');
    
    try {
        // Check if core tables exist
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'tenants'
            ) as tenants_exist,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            ) as users_exist,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'documents'
            ) as documents_exist
        `);
        
        const { tenants_exist, users_exist, documents_exist } = tableCheck.rows[0];
        
        if (tenants_exist && users_exist && documents_exist) {
            console.log('✅ Database tables already exist');
            
            // Quick validation - check if we have required columns
            try {
                await pool.query('SELECT tenant_id FROM users LIMIT 1');
                await pool.query('SELECT subscription_tier FROM tenants LIMIT 1');
                console.log('✅ Database schema appears complete');
                return true;
            } catch (error) {
                console.log('⚠️  Database exists but schema may be incomplete, running migration...');
                return await runDatabaseMigration();
            }
        } else {
            console.log('📋 Database tables missing, initializing...');
            return await runDatabaseMigration();
        }
        
    } catch (error) {
        console.error('❌ Database check failed:', error.message);
        console.log('🔧 Attempting to initialize database...');
        return await runDatabaseMigration();
    }
}

async function runDatabaseMigration() {
    console.log('🚀 Starting database initialization...');
    
    try {
        // Define the complete schema inline (to avoid file dependency issues)
        const createTablesSQL = `
-- Base tables
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    subscription_tier VARCHAR(50) DEFAULT 'starter',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tenant_id INTEGER REFERENCES tenants(id),
    role VARCHAR(50) DEFAULT 'user',
    global_role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    upload_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_questions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    question TEXT NOT NULL,
    answer TEXT,
    documents_referenced INTEGER[],
    response_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tenant settings table
CREATE TABLE IF NOT EXISTS tenant_settings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER UNIQUE REFERENCES tenants(id),
    company_name VARCHAR(255),
    logo_url VARCHAR(500),
    primary_color VARCHAR(7) DEFAULT '#4F46E5',
    secondary_color VARCHAR(7) DEFAULT '#10B981',
    app_title VARCHAR(100) DEFAULT 'Smart DataRoom',
    welcome_message TEXT,
    custom_domain VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usage tracking table
CREATE TABLE IF NOT EXISTS usage_tracking (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    quantity INTEGER DEFAULT 1,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Revenue tracking table
CREATE TABLE IF NOT EXISTS revenue_events (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    event_type VARCHAR(100) NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    metadata JSONB,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_tenant_id ON analytics_questions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_id ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_tenant_id ON usage_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_tenant_id ON revenue_events(tenant_id);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `;

        // Execute the schema creation
        console.log('📝 Creating database schema...');
        await pool.query(createTablesSQL);
        console.log('✅ Database schema created successfully');

        // Check if superadmin already exists
        const superadminCheck = await pool.query(
            "SELECT id FROM users WHERE global_role = 'superadmin' AND email = 'superadmin@saasplatform.com'"
        );

        if (superadminCheck.rows.length === 0) {
            // Create superadmin user
            console.log('👤 Creating superadmin user...');
            const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
            const hashedPassword = await bcrypt.hash(superadminPassword, 10);
            
            await pool.query(`
                INSERT INTO users (email, password_hash, name, global_role, is_active)
                VALUES ('superadmin@saasplatform.com', $1, 'Super Administrator', 'superadmin', true)
            `, [hashedPassword]);
            
            console.log('✅ Superadmin user created');
            console.log('📧 Superadmin credentials:');
            console.log('   Email: superadmin@saasplatform.com');
            console.log(`   Password: ${superadminPassword}`);
            console.log('⚠️  IMPORTANT: Change the superadmin password after first login!');
        } else {
            console.log('✅ Superadmin user already exists');
        }

        // Create a default demo tenant if none exist
        const tenantCheck = await pool.query('SELECT COUNT(*) as count FROM tenants');
        if (parseInt(tenantCheck.rows[0].count) === 0) {
            console.log('🏢 Creating demo tenant...');
            await pool.query(`
                INSERT INTO tenants (name, slug, subscription_tier, is_active)
                VALUES ('Demo Company', 'demo', 'pro', true)
            `);
            console.log('✅ Demo tenant created');
        }

        console.log('🎉 Database initialization completed successfully!');
        return true;

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

// Auto-initialize database before starting server
async function initializeDatabase() {
    try {
        const dbReady = await checkAndInitializeDatabase();
        if (!dbReady) {
            throw new Error('Database initialization failed');
        }
        
        // Additional startup checks
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM tenants WHERE is_active = true) as active_tenants,
                (SELECT COUNT(*) FROM users WHERE global_role = 'superadmin') as superadmins,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users
        `);
        
        console.log('\n📊 Database Ready:');
        console.log(`   Active Tenants: ${stats.rows[0].active_tenants}`);
        console.log(`   Superadmins: ${stats.rows[0].superadmins}`);
        console.log(`   Total Users: ${stats.rows[0].total_users}`);
        console.log('');
        
        return true;
    } catch (error) {
        console.error('💥 Fatal: Could not initialize database:', error.message);
        process.exit(1);
    }
}

// Import middleware
const { authenticateToken } = require('./middleware/auth-middleware');
const tenantMiddleware = require('./middleware/tenant-middleware');

// Import all route modules
const authRoutes = require('./routes/auth-routes');
const tenantRoutes = require('./routes/tenant-routes');
const documentRoutes = require('./routes/document-routes');
const analyticsRoutes = require('./routes/analytics-routes');
const qaRoutes = require('./routes/qa-routes');
const superAdminAnalyticsRoutes = require('./routes/superadmin-analytics-routes');

// Enhanced CORS with custom domain support
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedPatterns = [
            /\.railway\.app$/,
            /localhost/,
            /127\.0\.0\.1/,
            new RegExp(`\\.${process.env.APP_DOMAIN || 'yourdomain.com'}$`)
        ];
        
        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        
        if (isAllowed) {
            return callback(null, true);
        }
        
        // Check custom domains
        checkCustomDomain(origin, callback);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-tenant-slug'],
    credentials: true
};

async function checkCustomDomain(origin, callback) {
    try {
        const domain = origin.replace(/^https?:\/\//, '');
        const result = await pool.query(
            'SELECT id FROM tenant_settings WHERE custom_domain = $1',
            [domain]
        );
        
        callback(null, result.rows.length > 0);
    } catch (error) {
        callback(new Error('Not allowed by CORS'));
    }
}

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Health check
app.get('/health', async (req, res) => {
    try {
        // Test database connection
        const dbResult = await pool.query('SELECT NOW() as timestamp');
        
        // Get basic stats
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM tenants WHERE is_active = true) as active_tenants,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
                (SELECT COUNT(*) FROM analytics_questions WHERE created_at >= CURRENT_DATE) as questions_today
        `);
        
        res.json({ 
            status: 'healthy',
            timestamp: dbResult.rows[0].timestamp,
            mode: 'multi-tenant-saas',
            version: '2.0.0',
            stats: stats.rows[0]
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// API version info
app.get('/api/version', (req, res) => {
    res.json({
        version: '2.0.0',
        mode: 'multi-tenant',
        features: [
            'multi-tenancy',
            'three-tier-roles',
            'tenant-isolation',
            's3-per-tenant',
            'audit-logging',
            'usage-tracking',
            'cross-tenant-analytics',
            'revenue-tracking'
        ],
        endpoints: {
            auth: '/api/auth/*',
            tenants: '/api/tenants/*',
            documents: '/api/documents/*',
            analytics: '/api/analytics/*',
            qa: '/api/ask',
            superadmin: '/api/superadmin/*'
        }
    });
});

// Mount routes
app.use('/api', authRoutes);
app.use('/api', tenantRoutes);
app.use('/api', documentRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', qaRoutes);
app.use('/api', superAdminAnalyticsRoutes);

// Tenant settings with custom domain support
app.get('/api/settings',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const query = `
                SELECT 
                    ts.*,
                    t.name as tenant_name,
                    t.subscription_tier
                FROM tenant_settings ts
                JOIN tenants t ON ts.tenant_id = t.id
                WHERE ts.tenant_id = $1
            `;
            const result = await pool.query(query, [req.tenantId]);
            
            if (result.rows.length === 0) {
                // Return default settings
                return res.json({
                    company_name: req.tenant.name,
                    app_title: 'Smart DataRoom',
                    primary_color: '#4F46E5',
                    secondary_color: '#10B981',
                    logo_url: null,
                    subscription_tier: req.tenant.subscription_tier
                });
            }
            
            res.json(result.rows[0]);
        } catch (error) {
            console.error('Get settings error:', error);
            res.status(500).json({ error: 'Failed to retrieve settings' });
        }
    }
);

app.put('/api/settings',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.logActivity('SETTINGS_UPDATE', 'settings'),
    async (req, res) => {
        try {
            const {
                company_name,
                logo_url,
                primary_color,
                secondary_color,
                app_title,
                welcome_message,
                custom_domain
            } = req.body;
            
            const query = `
                INSERT INTO tenant_settings (
                    tenant_id, company_name, logo_url, 
                    primary_color, secondary_color, app_title,
                    welcome_message, custom_domain
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (tenant_id) 
                DO UPDATE SET
                    company_name = EXCLUDED.company_name,
                    logo_url = EXCLUDED.logo_url,
                    primary_color = EXCLUDED.primary_color,
                    secondary_color = EXCLUDED.secondary_color,
                    app_title = EXCLUDED.app_title,
                    welcome_message = EXCLUDED.welcome_message,
                    custom_domain = EXCLUDED.custom_domain,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `;
            
            const result = await pool.query(query, [
                req.tenantId,
                company_name,
                logo_url,
                primary_color,
                secondary_color,
                app_title,
                welcome_message,
                custom_domain
            ]);
            
            res.json(result.rows[0]);
        } catch (error) {
            console.error('Update settings error:', error);
            res.status(500).json({ error: 'Failed to update settings' });
        }
    }
);

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    
    if (err.message?.includes('tenant')) {
        return res.status(400).json({
            error: 'Tenant context error',
            message: err.message
        });
    }
    
    if (err.message?.includes('CORS')) {
        return res.status(403).json({
            error: 'Access denied',
            message: 'Domain not authorized'
        });
    }
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.method} ${req.path} not found`,
        availableEndpoints: [
            'GET /health',
            'GET /api/version',
            'POST /api/auth/login',
            'GET /api/tenants (superadmin)',
            'GET /api/documents',
            'GET /api/analytics/dashboard',
            'POST /api/ask'
        ]
    });
});

// Initialize application
async function initializeApp() {
    try {
        // First, test basic database connection
        const result = await pool.query('SELECT NOW() as timestamp, version() as pg_version');
        console.log('✅ Database connected:', result.rows[0].timestamp);
        
        // Initialize/check database schema
        await initializeDatabase();
        
        // Start server
        app.listen(PORT, () => {
            console.log('\n🚀 Multi-Tenant SaaS Platform READY');
            console.log(`   🌐 Server: http://localhost:${PORT}`);
            console.log(`   📊 Health: http://localhost:${PORT}/health`);
            console.log(`   📋 API Docs: http://localhost:${PORT}/api/version`);
            console.log(`   🔐 Mode: ${process.env.NODE_ENV || 'development'}`);
            console.log('\n✨ Multi-tenant architecture fully operational!\n');
        });
        
    } catch (error) {
        console.error('❌ Failed to initialize application:', error);
        process.exit(1);
    }
}
// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\n📴 ${signal} received, shutting down gracefully...`);
    
    try {
        await pool.end();
        console.log('✅ Database connections closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the application
initializeApp();
