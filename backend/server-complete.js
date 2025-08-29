require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./database');

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

// CORS Configuration with multi-tenant support
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        // Allow all subdomains for multi-tenant support
        const allowedPatterns = [
            /\.railway\.app$/,
            /localhost/,
            /127\.0\.0\.1/,
            // Add your production domain
            new RegExp(`\\.${process.env.APP_DOMAIN || 'yourdomain.com'}$`)
        ];
        
        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        
        if (isAllowed) {
            return callback(null, true);
        }
        
        // Allow custom domains for tenants
        checkCustomDomain(origin, callback);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-tenant-slug'],
    credentials: true
};

// Helper function to check custom domains
async function checkCustomDomain(origin, callback) {
    try {
        // Check if origin matches any tenant's custom domain
        const result = await pool.query(
            'SELECT id FROM tenant_settings WHERE custom_domain = $1',
            [origin.replace(/^https?:\/\//, '')]
        );
        
        if (result.rows.length > 0) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    } catch (error) {
        callback(new Error('Not allowed by CORS'));
    }
}

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mode: 'multi-tenant-saas',
        version: '2.0.0'
    });
});

// API version endpoint
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
            'usage-tracking'
        ]
    });
});

// Mount public routes (no auth required)
app.post('/api/auth/login', authRoutes);
app.post('/api/auth/accept-invite', authRoutes);

// Mount authenticated routes
app.use('/api', authRoutes);
app.use('/api', tenantRoutes);
app.use('/api', documentRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', qaRoutes);

// Settings endpoints with tenant context
app.get('/api/settings',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const query = `
                SELECT 
                    company_name,
                    logo_url,
                    primary_color,
                    secondary_color,
                    app_title,
                    welcome_message,
                    custom_domain
                FROM tenant_settings 
                WHERE tenant_id = $1
            `;
            const result = await pool.query(query, [req.tenantId]);
            
            if (result.rows.length === 0) {
                return res.json({
                    company_name: req.tenant.name,
                    app_title: 'Smart DataRoom',
                    primary_color: '#4F46E5',
                    secondary_color: '#10B981',
                    logo_url: null
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
    console.error('Global error handler:', err);
    
    // Check for specific error types
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({
            error: 'Cross-origin request blocked',
            message: 'This domain is not authorized to access the API'
        });
    }
    
    if (err.message && err.message.includes('tenant')) {
        return res.status(400).json({
            error: 'Tenant error',
            message: err.message
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
        message: `Endpoint ${req.method} ${req.path} not found`
    });
});

// Initialize application
async function initializeApp() {
    try {
        // Test database connection
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        
        // Check if multi-tenant tables exist
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'tenants'
            )
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.error('❌ Multi-tenant tables not found!');
            console.log('Please run: node migrate.js');
            process.exit(1);
        }
        
        // Get system statistics
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM tenants WHERE is_active = true) as active_tenants,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
                (SELECT COUNT(*) FROM users WHERE global_role = 'superadmin') as superadmins,
                (SELECT COUNT(*) FROM documents) as total_documents
        `);
        
        console.log('\n📊 System Statistics:');
        console.log(`   Active Tenants: ${stats.rows[0].active_tenants}`);
        console.log(`   Total Users: ${stats.rows[0].total_users}`);
        console.log(`   Superadmins: ${stats.rows[0].superadmins}`);
        console.log(`   Total Documents: ${stats.rows[0].total_documents}`);
        
        // Start server
        app.listen(PORT, () => {
            console.log('\n🚀 Multi-Tenant SaaS Platform Running');
            console.log(`   Port: ${PORT}`);
            console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
            console.log(`   API: http://localhost:${PORT}/api`);
            console.log(`   Health: http://localhost:${PORT}/health`);
            console.log('\n✨ Ready to serve multiple tenants!\n');
        });
        
    } catch (error) {
        console.error('❌ Failed to initialize application:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n📴 SIGTERM received, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n📴 SIGINT received, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

// Start the application
initializeApp();