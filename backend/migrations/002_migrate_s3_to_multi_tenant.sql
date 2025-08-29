-- Migration to update S3 structure for multi-tenancy
-- This migration updates existing documents to work with tenant-specific buckets

-- 1. Add file_size column if it doesn't exist
ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;

-- 2. Add uploaded_by column to track who uploaded the document
ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS uploaded_by UUID,
    ADD CONSTRAINT fk_documents_uploaded_by 
    FOREIGN KEY (uploaded_by) 
    REFERENCES users(id) 
    ON DELETE SET NULL;

-- 3. Add updated_at timestamp
ALTER TABLE documents 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 4. Create index for better performance
CREATE INDEX IF NOT EXISTS idx_documents_tenant_status 
    ON documents(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by 
    ON documents(uploaded_by);

-- 5. Update existing documents to have the default tenant bucket
UPDATE documents d
SET s3_bucket = t.aws_bucket_name
FROM tenants t
WHERE d.tenant_id = t.id
AND d.s3_bucket IS NOT NULL
AND t.aws_bucket_name IS NOT NULL;

-- 6. Create S3 migration tracking table
CREATE TABLE IF NOT EXISTS s3_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    old_bucket VARCHAR(255),
    new_bucket VARCHAR(255),
    documents_migrated INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, failed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_s3_migrations_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE
);

-- 7. Create function to track S3 storage per tenant
CREATE OR REPLACE FUNCTION update_tenant_storage_usage()
RETURNS TRIGGER AS $$
BEGIN
    -- Update tenant usage when document is added/updated/deleted
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_tenant_usage_tracking(NEW.tenant_id);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM update_tenant_usage_tracking(OLD.tenant_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger for automatic storage tracking
DROP TRIGGER IF EXISTS trigger_update_tenant_storage ON documents;
CREATE TRIGGER trigger_update_tenant_storage
    AFTER INSERT OR UPDATE OR DELETE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_tenant_storage_usage();

-- 9. Create helper function for tenant usage tracking
CREATE OR REPLACE FUNCTION update_tenant_usage_tracking(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_current_month DATE;
    v_doc_count INTEGER;
    v_storage_mb INTEGER;
    v_api_calls INTEGER;
    v_active_users INTEGER;
BEGIN
    v_current_month := date_trunc('month', CURRENT_DATE);
    
    -- Calculate current usage
    SELECT COUNT(*) INTO v_doc_count
    FROM documents 
    WHERE tenant_id = p_tenant_id;
    
    SELECT COALESCE(SUM(file_size) / (1024 * 1024), 0) INTO v_storage_mb
    FROM documents 
    WHERE tenant_id = p_tenant_id;
    
    SELECT COUNT(*) INTO v_api_calls
    FROM analytics_questions 
    WHERE tenant_id = p_tenant_id 
    AND created_at >= v_current_month;
    
    SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM analytics_sessions 
    WHERE tenant_id = p_tenant_id 
    AND login_time >= v_current_month;
    
    -- Update or insert usage record
    INSERT INTO tenant_usage (
        tenant_id, month, documents_count, storage_used_mb, 
        api_calls_count, active_users_count
    )
    VALUES (
        p_tenant_id, v_current_month, v_doc_count, 
        v_storage_mb, v_api_calls, v_active_users
    )
    ON CONFLICT (tenant_id, month) 
    DO UPDATE SET
        documents_count = v_doc_count,
        storage_used_mb = v_storage_mb,
        api_calls_count = v_api_calls,
        active_users_count = v_active_users,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- 10. Add S3 lifecycle configuration tracking
CREATE TABLE IF NOT EXISTS tenant_s3_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE,
    lifecycle_rules JSONB DEFAULT '{}',
    cors_rules JSONB DEFAULT '{}',
    encryption_enabled BOOLEAN DEFAULT true,
    versioning_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_s3_config_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE
);