require('dotenv').config();
const pool = require('./database-pool');
const bcrypt = require('bcryptjs');

async function runMigrations() {
    console.log('🚀 Starting minimal migration...\n');

    try {
        const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
        const hashedPassword = await bcrypt.hash(superadminPassword, 10);

        // Execute one statement at a time to find the issue
        const statements = [
            'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(50) DEFAULT \'user\', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT true)',
            
            'CREATE TABLE IF NOT EXISTS documents (id VARCHAR(255) PRIMARY KEY, original_name VARCHAR(500) NOT NULL, filename VARCHAR(500) NOT NULL, s3_key VARCHAR(1000), s3_bucket VARCHAR(255), mimetype VARCHAR(255) NOT NULL, size BIGINT NOT NULL, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, uploaded_by INTEGER, status VARCHAR(100) DEFAULT \'processing\')',
            
            'CREATE TABLE IF NOT EXISTS analytics_questions (id VARCHAR(255) PRIMARY KEY, user_id INTEGER, question TEXT NOT NULL, answer TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processing_time INTEGER)',
            
            'CREATE TABLE IF NOT EXISTS analytics_sessions (id VARCHAR(255) PRIMARY KEY, user_id INTEGER, email VARCHAR(255) NOT NULL, login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
            
            'CREATE TABLE IF NOT EXISTS analytics_documents (id VARCHAR(255) PRIMARY KEY, user_id INTEGER, document_id VARCHAR(255), document_name VARCHAR(500) NOT NULL, action VARCHAR(100) NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
            
            'CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, slug VARCHAR(255) UNIQUE NOT NULL, subscription_tier VARCHAR(50) DEFAULT \'free\', aws_bucket_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT true, max_users INTEGER DEFAULT 10, max_documents INTEGER DEFAULT 100, max_storage_gb DECIMAL(10,2) DEFAULT 5.0, primary_contact_email VARCHAR(255))',
            
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role VARCHAR(50)',
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_role VARCHAR(50) DEFAULT \'user\'',
            
            'ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id INTEGER',
            'ALTER TABLE analytics_questions ADD COLUMN IF NOT EXISTS tenant_id INTEGER',
            'ALTER TABLE analytics_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER',
            'ALTER TABLE analytics_documents ADD COLUMN IF NOT EXISTS tenant_id INTEGER',
            
            \`INSERT INTO users (email, password, name, global_role, is_active) VALUES ('superadmin@saasplatform.com', '\${hashedPassword}', 'Super Admin', 'superadmin', true) ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password\`
        ];

        console.log(\`📝 Found \${statements.length} SQL statements to execute\\n\`);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            console.log(\`🔄 Executing statement \${i + 1}/\${statements.length}: \${statement.substring(0, 50)}...\`);
            
            try {
                await pool.query(statement);
                console.log(\`✅ Statement \${i + 1}/\${statements.length} completed\`);
            } catch (error) {
                if (error.message.includes('already exists') || error.message.includes('duplicate key')) {
                    console.log(\`⏭️  Statement \${i + 1}/\${statements.length} skipped (already exists)\`);
                } else {
                    console.error(\`❌ Statement \${i + 1}/\${statements.length} failed:\`);
                    console.error(\`   SQL: \${statement}\`);
                    console.error(\`   Error: \${error.message}\`);
                    throw error;
                }
            }
        }

        console.log('\\n🎉 Migration completed successfully!\\n');
        console.log('📧 Superadmin account created:');
        console.log('   Email: superadmin@saasplatform.com');
        console.log(\`   Password: \${superadminPassword}\`);

    } catch (error) {
        console.error('\\n❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

runMigrations();