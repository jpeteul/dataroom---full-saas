-- Base tables creation for fresh database
-- This creates all the original tables that the multi-tenant migration expects

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Create documents table
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

-- Create analytics_questions table
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

-- Create analytics_sessions table
CREATE TABLE IF NOT EXISTS analytics_sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    email VARCHAR(255) NOT NULL,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    last_activity TIMESTAMP
);

-- Create analytics_documents table
CREATE TABLE IF NOT EXISTS analytics_documents (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    document_id VARCHAR(255) REFERENCES documents(id),
    document_name VARCHAR(500) NOT NULL,
    action VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create app_settings table (will be migrated to tenant_settings later)
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    file_url TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default app settings
INSERT INTO app_settings (setting_key, setting_value) 
VALUES 
    ('company_name', 'Data Room Analyzer'),
    ('app_title', 'Data Room Analyzer'),
    ('primary_color', '#2563eb'),
    ('logo_url', NULL)
ON CONFLICT DO NOTHING;