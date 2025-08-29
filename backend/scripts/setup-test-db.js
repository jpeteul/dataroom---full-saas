#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupTestDatabase() {
  console.log('🔧 Setting up test database...\n');

  // Connect to PostgreSQL (without database name to create it)
  const adminPool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    database: 'postgres' // Connect to default database to create test db
  });

  try {
    // Drop and recreate test database
    console.log('🗑️  Dropping existing test database...');
    await adminPool.query('DROP DATABASE IF EXISTS dataroom_test');
    
    console.log('📋 Creating test database...');
    await adminPool.query('CREATE DATABASE dataroom_test');
    
    console.log('✅ Test database created successfully');
    
  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
    
    if (error.message.includes('does not exist')) {
      console.log('ℹ️  If you need to create the postgres user:');
      console.log('   createuser -s postgres');
    }
  } finally {
    await adminPool.end();
  }

  // Now connect to the test database and run migrations
  const testPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/dataroom_test'
  });

  try {
    console.log('\n📊 Running test database migrations...');
    
    // Read and execute migration file
    const migrationPath = path.join(__dirname, '..', 'migrations', '001_add_multi_tenant_support.sql');
    
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      await testPool.query(migrationSQL);
      console.log('✅ Migration completed successfully');
    } else {
      console.log('⚠️  Migration file not found, creating basic tables...');
      
      // Create minimal required tables for testing
      await testPool.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          subscription_tier VARCHAR(50) DEFAULT 'free',
          subscription_status VARCHAR(50) DEFAULT 'active',
          max_users INTEGER DEFAULT 10,
          max_documents INTEGER DEFAULT 100,
          max_storage_gb DECIMAL(10,2) DEFAULT 5.0,
          aws_bucket_name VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          tenant_id INTEGER REFERENCES tenants(id),
          tenant_role VARCHAR(50) DEFAULT 'user',
          global_role VARCHAR(50),
          is_active BOOLEAN DEFAULT true,
          last_login TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS documents (
          id VARCHAR(255) PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          original_name VARCHAR(500) NOT NULL,
          s3_key VARCHAR(1000) NOT NULL,
          s3_bucket VARCHAR(255) NOT NULL,
          file_size BIGINT,
          status VARCHAR(100) DEFAULT 'uploaded',
          uploaded_by INTEGER REFERENCES users(id),
          uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analytics_questions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          question TEXT NOT NULL,
          answer TEXT,
          processing_time INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analytics_sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analytics_documents (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          document_id VARCHAR(255) REFERENCES documents(id),
          action VARCHAR(100),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_settings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER UNIQUE NOT NULL REFERENCES tenants(id),
          company_name VARCHAR(255),
          logo_url TEXT,
          primary_color VARCHAR(7) DEFAULT '#4F46E5',
          secondary_color VARCHAR(7) DEFAULT '#10B981',
          app_title VARCHAR(100) DEFAULT 'Smart DataRoom',
          welcome_message TEXT,
          custom_domain VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_invitations (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          email VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'user',
          token VARCHAR(255) UNIQUE NOT NULL,
          invited_by INTEGER REFERENCES users(id),
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_audit_logs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          user_id INTEGER REFERENCES users(id),
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(100),
          resource_id VARCHAR(255),
          details JSONB,
          ip_address INET,
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_usage (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          month DATE NOT NULL,
          api_calls_count INTEGER DEFAULT 0,
          storage_used_mb DECIMAL(15,2) DEFAULT 0,
          active_users_count INTEGER DEFAULT 0,
          documents_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, month)
        );
      `);
    }

    // Create indexes for performance
    await testPool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_questions_tenant_id ON analytics_questions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_sessions_tenant_id ON analytics_sessions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_documents_tenant_id ON analytics_documents(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_audit_logs_tenant_id ON tenant_audit_logs(tenant_id);
    `);

    console.log('📊 Database indexes created');

    // Verify setup
    const tables = await testPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    console.log('\n📋 Created tables:');
    tables.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    console.log('\n🎉 Test database setup completed successfully!');
    console.log('\nTo run tests:');
    console.log('   npm test                 # Run all tests');
    console.log('   npm run test:isolation   # Test tenant isolation');
    console.log('   npm run test:integration # Test complete workflows');
    console.log('   npm run test:coverage    # Run with coverage report');

  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await testPool.end();
  }
}

// Run setup if called directly
if (require.main === module) {
  setupTestDatabase().catch(console.error);
}

module.exports = { setupTestDatabase };