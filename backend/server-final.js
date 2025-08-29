require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./database-pool');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

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
        // Database connection test
        const result = await pool.query('SELECT NOW() as timestamp, version() as pg_version');
        console.log('✅ Database connected:', result.rows[0].timestamp);
        
        // Check multi-tenant setup
        const setupCheck = await pool.query(`
            SELECT 
                (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tenants')) as tenants_exist,
                (SELECT COUNT(*) FROM tenants WHERE is_active = true) as active_tenants,
                (SELECT COUNT(*) FROM users WHERE global_role = 'superadmin') as superadmins,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
                (SELECT COUNT(*) FROM documents) as total_documents
        `);
        
        const setup = setupCheck.rows[0];
        
        if (!setup.tenants_exist) {
            console.error('❌ Multi-tenant tables not found!');
            console.log('Run: node migrate.js');
            process.exit(1);
        }
        
        console.log('\n📊 Platform Statistics:');
        console.log(`   Active Tenants: ${setup.active_tenants}`);
        console.log(`   Total Users: ${setup.total_users}`);
        console.log(`   Superadmins: ${setup.superadmins}`);
        console.log(`   Total Documents: ${setup.total_documents}`);
        
        // Check for any system alerts
        if (setup.active_tenants === 0 && setup.total_users === 0) {
            console.log('\n⚠️  Warning: No active tenants found');
            console.log('   Consider creating a test tenant to verify setup');
        }
        
        // Start server
        app.listen(PORT, () => {
            console.log('\n🚀 Multi-Tenant SaaS Platform READY');
            console.log(`   🌐 Server: http://localhost:${PORT}`);
            console.log(`   📊 Health: http://localhost:${PORT}/health`);
            console.log(`   📋 API Docs: http://localhost:${PORT}/api/version`);
            console.log(`   🔐 Mode: ${process.env.NODE_ENV || 'development'}`);
            
            if (setup.superadmins > 0) {
                console.log(`   👤 Superadmin access available`);
            }
            
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