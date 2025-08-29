#!/usr/bin/env node

require('dotenv').config();
const pool = require('./database-pool');
const S3MigrationService = require('./services/s3-migration-service');

const migrationService = new S3MigrationService();

const commands = {
    help: () => {
        console.log(`
🚚 S3 Multi-Tenant Migration Tool

Commands:
  node migrate-s3.js migrate-all      - Migrate all tenants to separate buckets
  node migrate-s3.js migrate [slug]   - Migrate specific tenant by slug
  node migrate-s3.js status [slug]    - Check migration status for tenant
  node migrate-s3.js verify [slug]    - Verify migration integrity for tenant
  node migrate-s3.js verify-all       - Verify all tenant migrations
  node migrate-s3.js cleanup [bucket] - Clean up old shared bucket (DANGEROUS)
  node migrate-s3.js help            - Show this help

Examples:
  node migrate-s3.js migrate-all
  node migrate-s3.js migrate acme-corp
  node migrate-s3.js verify default-org
        `);
    },

    'migrate-all': async () => {
        console.log('🚚 Starting migration for all tenants...\n');
        
        try {
            // Run database migration first
            await runDatabaseMigration();
            
            // Then migrate S3
            const result = await migrationService.migrateAllTenants();
            
            console.log('\n✅ All tenants migrated successfully!');
            console.log(`Total: ${result.tenants} tenants, ${result.documents} documents`);
            
            if (result.errors > 0) {
                console.warn(`⚠️  ${result.errors} errors occurred during migration`);
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }
    },

    migrate: async (tenantSlug) => {
        if (!tenantSlug) {
            console.error('❌ Please provide tenant slug');
            process.exit(1);
        }

        try {
            console.log(`🚚 Migrating tenant: ${tenantSlug}\n`);
            
            // Get tenant
            const tenantResult = await pool.query(
                'SELECT * FROM tenants WHERE slug = $1',
                [tenantSlug]
            );
            
            if (tenantResult.rows.length === 0) {
                console.error('❌ Tenant not found');
                process.exit(1);
            }
            
            const tenant = tenantResult.rows[0];
            const result = await migrationService.migrateTenant(tenant);
            
            console.log(`✅ Migration completed for ${tenant.name}`);
            console.log(`Documents migrated: ${result.migrated}, Errors: ${result.errors}`);
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }
    },

    status: async (tenantSlug) => {
        if (!tenantSlug) {
            console.error('❌ Please provide tenant slug');
            process.exit(1);
        }

        try {
            const tenantResult = await pool.query(
                'SELECT * FROM tenants WHERE slug = $1',
                [tenantSlug]
            );
            
            if (tenantResult.rows.length === 0) {
                console.error('❌ Tenant not found');
                process.exit(1);
            }
            
            const tenant = tenantResult.rows[0];
            const status = await migrationService.getMigrationStatus(tenant.id);
            
            console.log(`📊 Migration Status for ${tenant.name}:`);
            
            if (!status) {
                console.log('   No migration recorded');
            } else {
                console.log(`   Status: ${status.status}`);
                console.log(`   Documents Migrated: ${status.documents_migrated}`);
                console.log(`   Started: ${status.started_at}`);
                console.log(`   Completed: ${status.completed_at || 'N/A'}`);
                
                if (status.error_message) {
                    console.log(`   Error: ${status.error_message}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to get status:', error);
            process.exit(1);
        }
    },

    verify: async (tenantSlug) => {
        if (!tenantSlug) {
            console.error('❌ Please provide tenant slug');
            process.exit(1);
        }

        try {
            const tenantResult = await pool.query(
                'SELECT * FROM tenants WHERE slug = $1',
                [tenantSlug]
            );
            
            if (tenantResult.rows.length === 0) {
                console.error('❌ Tenant not found');
                process.exit(1);
            }
            
            const tenant = tenantResult.rows[0];
            const result = await migrationService.verifyTenantMigration(tenant);
            
            if (result.issues.length === 0) {
                console.log('✅ Verification passed - no issues found');
            } else {
                console.error('❌ Verification failed - issues found');
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Verification failed:', error);
            process.exit(1);
        }
    },

    'verify-all': async () => {
        try {
            console.log('🔍 Verifying all tenant migrations...\n');
            
            const tenantsResult = await pool.query(
                'SELECT * FROM tenants WHERE is_active = true ORDER BY name'
            );
            
            const results = [];
            let totalIssues = 0;
            
            for (const tenant of tenantsResult.rows) {
                const result = await migrationService.verifyTenantMigration(tenant);
                results.push(result);
                totalIssues += result.issues.length;
            }
            
            console.log('📊 Verification Summary:');
            console.log(`   Tenants checked: ${results.length}`);
            console.log(`   Total issues: ${totalIssues}`);
            
            if (totalIssues === 0) {
                console.log('✅ All verifications passed!');
            } else {
                console.log('❌ Some verifications failed');
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Verification failed:', error);
            process.exit(1);
        }
    },

    cleanup: async (bucketName) => {
        if (!bucketName) {
            console.error('❌ Please provide bucket name to cleanup');
            process.exit(1);
        }

        console.log('⚠️  WARNING: This will permanently delete the specified bucket and all its contents!');
        console.log(`Bucket to delete: ${bucketName}`);
        console.log('\nTo confirm this dangerous operation, you must:');
        console.log('1. Ensure all tenants have been migrated');
        console.log('2. Run: node migrate-s3.js verify-all');
        console.log('3. Add confirmation token: CONFIRM_DELETE_SHARED_BUCKET');
        console.log('\nExample: node migrate-s3.js cleanup bucket-name CONFIRM_DELETE_SHARED_BUCKET');
        
        process.exit(1);
    }
};

async function runDatabaseMigration() {
    console.log('📊 Running database migration for S3 multi-tenancy...');
    
    try {
        const fs = require('fs');
        const path = require('path');
        
        const migrationPath = path.join(__dirname, 'migrations', '002_migrate_s3_to_multi_tenant.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        // Split and execute statements
        const statements = migrationSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));
        
        for (const statement of statements) {
            try {
                await pool.query(statement + ';');
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
            }
        }
        
        console.log('✅ Database migration completed\n');
    } catch (error) {
        console.error('❌ Database migration failed:', error);
        throw error;
    }
}

// Main execution
async function main() {
    const [,, command, ...args] = process.argv;
    
    if (!command || !commands[command]) {
        commands.help();
        process.exit(1);
    }
    
    try {
        await commands[command](...args);
    } catch (error) {
        console.error('❌ Command failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

// Handle special case for cleanup with confirmation
if (process.argv.length === 5 && process.argv[2] === 'cleanup' && process.argv[4] === 'CONFIRM_DELETE_SHARED_BUCKET') {
    commands.cleanup = async (bucketName, confirmationToken) => {
        try {
            console.log('🗑️  Cleaning up old shared bucket...\n');
            
            const result = await migrationService.cleanupOldSharedBucket(bucketName, confirmationToken);
            
            console.log(`✅ Cleanup completed - deleted ${result.deletedObjects} objects`);
            
        } catch (error) {
            console.error('❌ Cleanup failed:', error);
            process.exit(1);
        }
    };
}

main();