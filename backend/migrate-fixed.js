require('dotenv').config();
const pool = require('./database-pool');
const bcrypt = require('bcryptjs');

async function runMigrations() {
    console.log('🚀 Starting multi-tenant migration...\n');

    try {
        // Generate superadmin password
        const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
        const hashedPassword = await bcrypt.hash(superadminPassword, 10);

        // Complete SQL with both base tables and multi-tenant structure
        const allSQL = `
-- BASE TABLES CREATION
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    original_name VARCHAR(500) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    s3_key VARCHAR(1000),
    s3_bucket VARCHAR(255),
    etag VARCHAR(255),
    client_id VARCHAR(255) DEFAULT 'demo-company',
    mimetype VARCHAR(255) NOT NULL,
    size BIGINT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by INTEGER REFERENCES users(id),
    status VARCHAR(100) DEFAULT 'processing',
    analysis TEXT,
    error TEXT,
    tags JSONB,
    analysis_file TEXT,
    cloudinary_url TEXT,
    cloudinary_public_id TEXT,
    file_size BIGINT
);

CREATE TABLE IF NOT EXISTS analytics_questions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    question TEXT NOT NULL,
    answer TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_time INTEGER,
    sources_used JSONB,
    question_length INTEGER,
    answer_length INTEGER,
    source_count INTEGER
);

CREATE TABLE IF NOT EXISTS analytics_sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    email VARCHAR(255) NOT NULL,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    last_activity TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_documents (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    document_id VARCHAR(255) REFERENCES documents(id),
    document_name VARCHAR(500) NOT NULL,
    action VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    file_url TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MULTI-TENANT STRUCTURE
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    subscription_tier VARCHAR(50) DEFAULT 'free',
    aws_bucket_name VARCHAR(255) UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    subscription_status VARCHAR(50) DEFAULT 'active',
    subscription_expires_at TIMESTAMP,
    max_users INTEGER DEFAULT 10,
    max_storage_gb INTEGER DEFAULT 100,
    max_documents INTEGER DEFAULT 1000,
    primary_contact_email VARCHAR(255),
    billing_email VARCHAR(255)
);

-- Add tenant_id columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE analytics_questions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE analytics_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE analytics_documents ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);

-- Create additional multi-tenant tables
CREATE TABLE IF NOT EXISTS tenant_settings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    company_name VARCHAR(255),
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#4F46E5',
    secondary_color VARCHAR(7) DEFAULT '#10B981',
    app_title VARCHAR(255) DEFAULT 'Smart DataRoom',
    welcome_message TEXT,
    custom_domain VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_invitations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    invited_by INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_audit_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_usage (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    month DATE NOT NULL,
    documents_count INTEGER DEFAULT 0,
    storage_used_mb INTEGER DEFAULT 0,
    api_calls_count INTEGER DEFAULT 0,
    active_users_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, month)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_global_role ON users(global_role);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_questions_tenant_id ON analytics_questions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_tenant_id ON analytics_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_documents_tenant_id ON analytics_documents(tenant_id);

-- Create default tenant
INSERT INTO tenants (name, slug, subscription_tier, aws_bucket_name, primary_contact_email)
VALUES ('Default Organization', 'default-org', 'professional', 'dataroom-v2-demo-company-documents', 'admin@dataroom.com')
ON CONFLICT (slug) DO NOTHING;

-- Create superadmin user
INSERT INTO users (email, password, name, global_role, tenant_role, is_active)
VALUES (
    'superadmin@saasplatform.com',
    '${hashedPassword}',
    'Super Admin',
    'superadmin',
    'admin',
    true
)
ON CONFLICT (email) DO UPDATE SET 
    password = EXCLUDED.password,
    global_role = EXCLUDED.global_role;

-- Default app settings
INSERT INTO app_settings (setting_key, setting_value) 
VALUES 
    ('company_name', 'Data Room Analyzer'),
    ('app_title', 'Data Room Analyzer'),
    ('primary_color', '#2563eb'),
    ('logo_url', NULL)
ON CONFLICT (setting_key) DO NOTHING;
`;

        // Split by semicolons but preserve those within strings
        const statements = allSQL
            .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            
            // Extract operation type for logging
            const operation = statement.match(/^(CREATE|ALTER|INSERT|UPDATE|DROP)/i)?.[1] || 'EXECUTE';
            
            try {
                await pool.query(statement + ';');
                console.log(`✅ ${operation} statement ${i + 1}/${statements.length} completed`);
            } catch (error) {
                // Some errors are expected (e.g., "column already exists")
                if (error.message.includes('already exists') || 
                    error.message.includes('duplicate key')) {
                    console.log(`⏭️  ${operation} statement ${i + 1}/${statements.length} skipped (already exists)`);
                } else {
                    console.error(`❌ ${operation} statement ${i + 1}/${statements.length} failed:`, error.message);
                    throw error;
                }
            }
        }

        console.log('\n🎉 Migration completed successfully!\n');
        console.log('📧 Superadmin account created:');
        console.log('   Email: superadmin@saasplatform.com');
        console.log(`   Password: ${superadminPassword}`);
        console.log('\n⚠️  IMPORTANT: Change the superadmin password after first login!\n');

        // Display migration summary
        const summary = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM tenants) as tenant_count,
                (SELECT COUNT(*) FROM users WHERE global_role = 'superadmin') as superadmin_count,
                (SELECT COUNT(*) FROM users WHERE tenant_id IS NOT NULL) as tenant_users_count
        `);

        console.log('📊 Database Summary:');
        console.log(`   Tenants: ${summary.rows[0].tenant_count}`);
        console.log(`   Superadmins: ${summary.rows[0].superadmin_count}`);
        console.log(`   Tenant Users: ${summary.rows[0].tenant_users_count}`);

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

// Run migrations
runMigrations();