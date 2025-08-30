require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./database-pool');
const bcrypt = require('bcryptjs');

async function runMigrations() {
    console.log('🚀 Starting multi-tenant migration...\n');

    try {
        // Read base tables migration first
        const baseMigrationPath = path.join(__dirname, 'migrations', '000_create_base_tables.sql');
        const baseMigrationSQL = fs.readFileSync(baseMigrationPath, 'utf8');
        
        // Read multi-tenant migration
        const migrationPath = path.join(__dirname, 'migrations', '001_add_multi_tenant_support.sql');
        let migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Generate superadmin password
        const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!';
        const hashedPassword = await bcrypt.hash(superadminPassword, 10);
        
        // Replace placeholder with actual hashed password
        migrationSQL = migrationSQL.replace(
            '$2b$10$YourHashedPasswordHere',
            hashedPassword
        );

        // Combine both migrations
        const allSQL = baseMigrationSQL + '\n\n' + migrationSQL;

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
