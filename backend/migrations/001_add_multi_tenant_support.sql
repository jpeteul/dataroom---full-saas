-- Multi-Tenant SaaS Database Migration
-- This migration adds comprehensive multi-tenant support to the dataroom application

-- 1. Create tenants table (organizations/clients)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL, -- URL-friendly identifier
    subscription_tier VARCHAR(50) DEFAULT 'free', -- free, starter, professional, enterprise
    aws_bucket_name VARCHAR(255) UNIQUE, -- Tenant-specific S3 bucket
    settings JSONB DEFAULT '{}', -- Tenant-specific settings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    -- Subscription management
    subscription_status VARCHAR(50) DEFAULT 'active', -- active, suspended, cancelled
    subscription_expires_at TIMESTAMP,
    -- Usage limits
    max_users INTEGER DEFAULT 10,
    max_storage_gb INTEGER DEFAULT 100,
    max_documents INTEGER DEFAULT 1000,
    -- Contact information
    primary_contact_email VARCHAR(255),
    billing_email VARCHAR(255)
);

-- 2. Add tenant_id to users table and update roles
ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD COLUMN IF NOT EXISTS global_role VARCHAR(50) DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS tenant_role VARCHAR(50) DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
    ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP;

-- Update existing role column to tenant_role for backward compatibility
UPDATE users SET tenant_role = role WHERE tenant_role IS NULL;

-- Add foreign key constraint
ALTER TABLE users 
    ADD CONSTRAINT fk_users_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE;

-- 3. Add tenant_id to documents table
ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD CONSTRAINT fk_documents_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE;

-- 4. Add tenant_id to analytics tables
ALTER TABLE analytics_questions 
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD CONSTRAINT fk_analytics_questions_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE;

ALTER TABLE analytics_sessions 
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD CONSTRAINT fk_analytics_sessions_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE;

ALTER TABLE analytics_documents 
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD CONSTRAINT fk_analytics_documents_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE;

-- 5. Create tenant-specific settings table (replaces global app_settings)
CREATE TABLE IF NOT EXISTS tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    company_name VARCHAR(255),
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#4F46E5',
    secondary_color VARCHAR(7) DEFAULT '#10B981',
    app_title VARCHAR(255) DEFAULT 'Smart DataRoom',
    welcome_message TEXT,
    custom_domain VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_settings_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE,
    UNIQUE(tenant_id)
);

-- 6. Create tenant invitations table
CREATE TABLE IF NOT EXISTS tenant_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    invited_by UUID NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_invitations_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE,
    CONSTRAINT fk_tenant_invitations_user 
    FOREIGN KEY (invited_by) 
    REFERENCES users(id) 
    ON DELETE CASCADE
);

-- 7. Create audit log table for tenant activities
CREATE TABLE IF NOT EXISTS tenant_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_logs_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE,
    CONSTRAINT fk_audit_logs_user 
    FOREIGN KEY (user_id) 
    REFERENCES users(id) 
    ON DELETE SET NULL
);

-- 8. Create usage tracking table
CREATE TABLE IF NOT EXISTS tenant_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    month DATE NOT NULL,
    documents_count INTEGER DEFAULT 0,
    storage_used_mb INTEGER DEFAULT 0,
    api_calls_count INTEGER DEFAULT 0,
    active_users_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_usage_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE,
    UNIQUE(tenant_id, month)
);

-- 9. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_global_role ON users(global_role);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_questions_tenant_id ON analytics_questions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_tenant_id ON analytics_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_documents_tenant_id ON analytics_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_logs_tenant_id ON tenant_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_month ON tenant_usage(tenant_id, month);

-- 10. Create default tenant for existing data migration
INSERT INTO tenants (name, slug, subscription_tier, aws_bucket_name, primary_contact_email)
VALUES ('Default Organization', 'default-org', 'professional', 'dataroom-v2-demo-company-documents', 'admin@dataroom.com')
ON CONFLICT DO NOTHING;

-- 11. Migrate existing data to default tenant
UPDATE users 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default-org')
WHERE tenant_id IS NULL;

UPDATE documents 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default-org')
WHERE tenant_id IS NULL;

UPDATE analytics_questions 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default-org')
WHERE tenant_id IS NULL;

UPDATE analytics_sessions 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default-org')
WHERE tenant_id IS NULL;

UPDATE analytics_documents 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default-org')
WHERE tenant_id IS NULL;

-- 12. Migrate app_settings to tenant_settings
INSERT INTO tenant_settings (tenant_id, company_name, logo_url, primary_color, app_title)
SELECT 
    (SELECT id FROM tenants WHERE slug = 'default-org'),
    company_name,
    logo_url,
    primary_color,
    app_title
FROM app_settings
ON CONFLICT DO NOTHING;

-- 13. Create superadmin user if not exists
INSERT INTO users (email, password, name, global_role, tenant_role, is_active)
VALUES (
    'superadmin@saasplatform.com',
    '$2b$10$YourHashedPasswordHere', -- You'll need to update this with a real hashed password
    'Super Admin',
    'superadmin',
    'admin',
    true
)
ON CONFLICT DO NOTHING;

-- 14. Add constraints to ensure data integrity
ALTER TABLE documents 
    ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE analytics_questions 
    ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE analytics_sessions 
    ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE analytics_documents 
    ALTER COLUMN tenant_id SET NOT NULL;