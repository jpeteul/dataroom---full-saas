const pool = require('../database-pool');
const S3MultiTenantService = require('./s3-multi-tenant');

class S3MigrationService {
    constructor() {
        this.s3Service = new S3MultiTenantService();
    }

    // Migrate all tenants to their own buckets
    async migrateAllTenants() {
        console.log('🚚 Starting S3 multi-tenant migration...\n');
        
        try {
            // Get all tenants that need migration
            const tenantsResult = await pool.query(`
                SELECT t.*, COUNT(d.id) as document_count
                FROM tenants t
                LEFT JOIN documents d ON t.id = d.tenant_id
                WHERE t.is_active = true
                GROUP BY t.id
                ORDER BY document_count DESC
            `);
            
            const tenants = tenantsResult.rows;
            console.log(`Found ${tenants.length} tenants to migrate\n`);
            
            let totalDocuments = 0;
            let totalErrors = 0;
            
            for (const tenant of tenants) {
                const result = await this.migrateTenant(tenant);
                totalDocuments += result.migrated;
                totalErrors += result.errors;
            }
            
            console.log('\n✅ Migration Summary:');
            console.log(`   Tenants processed: ${tenants.length}`);
            console.log(`   Documents migrated: ${totalDocuments}`);
            console.log(`   Errors: ${totalErrors}`);
            
            return {
                tenants: tenants.length,
                documents: totalDocuments,
                errors: totalErrors
            };
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    // Migrate a specific tenant
    async migrateTenant(tenant) {
        console.log(`📦 Migrating tenant: ${tenant.name} (${tenant.slug})`);
        
        const migrationId = await this.startMigrationTracking(tenant.id);
        
        try {
            // Ensure tenant has a bucket
            const newBucketName = await this.s3Service.ensureTenantBucket(tenant);
            console.log(`   New bucket: ${newBucketName}`);
            
            // Get documents that need migration
            const documentsResult = await pool.query(`
                SELECT * FROM documents 
                WHERE tenant_id = $1 
                AND (s3_bucket != $2 OR s3_bucket IS NULL)
                ORDER BY uploaded_at ASC
            `, [tenant.id, newBucketName]);
            
            const documents = documentsResult.rows;
            console.log(`   Documents to migrate: ${documents.length}`);
            
            if (documents.length === 0) {
                await this.completeMigrationTracking(migrationId, 0);
                console.log(`   ✅ No documents to migrate\n`);
                return { migrated: 0, errors: 0 };
            }
            
            let migrated = 0;
            let errors = 0;
            
            // Process documents in batches
            const batchSize = 10;
            for (let i = 0; i < documents.length; i += batchSize) {
                const batch = documents.slice(i, i + batchSize);
                
                const batchResults = await Promise.allSettled(
                    batch.map(doc => this.migrateDocument(doc, tenant, newBucketName))
                );
                
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        migrated++;
                        console.log(`   ✅ Migrated: ${batch[index].original_name}`);
                    } else {
                        errors++;
                        console.error(`   ❌ Failed: ${batch[index].original_name} - ${result.reason}`);
                    }
                });
                
                // Progress update
                const progress = Math.min(i + batchSize, documents.length);
                console.log(`   Progress: ${progress}/${documents.length}`);
            }
            
            await this.completeMigrationTracking(migrationId, migrated);
            console.log(`   ✅ Completed: ${migrated} migrated, ${errors} errors\n`);
            
            return { migrated, errors };
            
        } catch (error) {
            await this.failMigrationTracking(migrationId, error.message);
            throw error;
        }
    }

    // Migrate a single document
    async migrateDocument(document, tenant, newBucketName) {
        // If document doesn't have S3 info, skip it
        if (!document.s3_key || !document.s3_bucket) {
            console.log(`   ⏭️  Skipping ${document.original_name} - no S3 info`);
            return;
        }
        
        // If already in correct bucket, update database only
        if (document.s3_bucket === newBucketName) {
            return;
        }
        
        try {
            const oldBucket = document.s3_bucket;
            const oldKey = document.s3_key;
            
            // Generate new key with document ID structure
            const documentId = document.id;
            const sanitizedName = document.original_name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const newKey = `documents/${documentId}/${sanitizedName}`;
            
            // Copy object to new bucket
            await this.s3Service.s3.copyObject({
                Bucket: newBucketName,
                CopySource: `${oldBucket}/${oldKey}`,
                Key: newKey,
                ServerSideEncryption: 'AES256',
                MetadataDirective: 'REPLACE',
                Metadata: {
                    'tenant-id': tenant.id,
                    'document-id': documentId,
                    'original-name': document.original_name,
                    'migrated-at': new Date().toISOString()
                }
            }).promise();
            
            // Update database with new location
            await pool.query(
                'UPDATE documents SET s3_bucket = $1, s3_key = $2 WHERE id = $3',
                [newBucketName, newKey, documentId]
            );
            
            // Try to delete from old bucket (if different)
            if (oldBucket !== newBucketName) {
                try {
                    await this.s3Service.s3.deleteObject({
                        Bucket: oldBucket,
                        Key: oldKey
                    }).promise();
                } catch (deleteError) {
                    console.warn(`   ⚠️  Could not delete from old bucket: ${deleteError.message}`);
                }
            }
            
        } catch (error) {
            console.error(`   ❌ Error migrating ${document.original_name}:`, error);
            throw error;
        }
    }

    // Start migration tracking
    async startMigrationTracking(tenantId) {
        const result = await pool.query(`
            INSERT INTO s3_migrations (tenant_id, status, started_at)
            VALUES ($1, 'in_progress', CURRENT_TIMESTAMP)
            RETURNING id
        `, [tenantId]);
        
        return result.rows[0].id;
    }

    // Complete migration tracking
    async completeMigrationTracking(migrationId, documentsCount) {
        await pool.query(`
            UPDATE s3_migrations 
            SET status = 'completed', 
                documents_migrated = $1,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [documentsCount, migrationId]);
    }

    // Fail migration tracking
    async failMigrationTracking(migrationId, errorMessage) {
        await pool.query(`
            UPDATE s3_migrations 
            SET status = 'failed', 
                error_message = $1,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [errorMessage, migrationId]);
    }

    // Get migration status for a tenant
    async getMigrationStatus(tenantId) {
        const result = await pool.query(`
            SELECT * FROM s3_migrations 
            WHERE tenant_id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [tenantId]);
        
        return result.rows[0];
    }

    // Verify tenant migration integrity
    async verifyTenantMigration(tenant) {
        console.log(`🔍 Verifying migration for tenant: ${tenant.name}`);
        
        const issues = [];
        
        // Check if all documents have correct bucket
        const documentsResult = await pool.query(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN s3_bucket = $1 THEN 1 END) as correct_bucket,
                   COUNT(CASE WHEN s3_bucket IS NULL THEN 1 END) as no_bucket
            FROM documents 
            WHERE tenant_id = $2
        `, [tenant.aws_bucket_name, tenant.id]);
        
        const stats = documentsResult.rows[0];
        
        if (parseInt(stats.no_bucket) > 0) {
            issues.push(`${stats.no_bucket} documents have no S3 bucket`);
        }
        
        if (parseInt(stats.correct_bucket) !== parseInt(stats.total)) {
            issues.push(`${parseInt(stats.total) - parseInt(stats.correct_bucket)} documents in wrong bucket`);
        }
        
        // Check if bucket actually exists in S3
        try {
            const bucketName = tenant.aws_bucket_name;
            if (bucketName) {
                await this.s3Service.s3.headBucket({ Bucket: bucketName }).promise();
            } else {
                issues.push('No bucket assigned to tenant');
            }
        } catch (error) {
            issues.push(`Bucket does not exist in S3: ${error.message}`);
        }
        
        console.log(`   Documents: ${stats.total} total, ${stats.correct_bucket} in correct bucket`);
        
        if (issues.length === 0) {
            console.log(`   ✅ Migration verified - no issues found\n`);
        } else {
            console.log(`   ❌ Migration issues found:`);
            issues.forEach(issue => console.log(`      - ${issue}`));
            console.log('');
        }
        
        return {
            tenant: tenant.name,
            totalDocuments: parseInt(stats.total),
            correctBucket: parseInt(stats.correct_bucket),
            issues
        };
    }

    // Clean up old shared bucket (use with extreme caution!)
    async cleanupOldSharedBucket(oldBucketName, confirmationToken) {
        if (confirmationToken !== 'CONFIRM_DELETE_SHARED_BUCKET') {
            throw new Error('Invalid confirmation token for dangerous operation');
        }
        
        console.warn('⚠️  DANGEROUS: Cleaning up old shared bucket:', oldBucketName);
        
        // First, verify no documents are still referencing this bucket
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM documents WHERE s3_bucket = $1',
            [oldBucketName]
        );
        
        if (parseInt(result.rows[0].count) > 0) {
            throw new Error(`Cannot delete bucket - ${result.rows[0].count} documents still reference it`);
        }
        
        // List and delete all objects
        let continuationToken = null;
        let deletedCount = 0;
        
        do {
            const listParams = {
                Bucket: oldBucketName,
                ContinuationToken: continuationToken
            };
            
            const listedObjects = await this.s3Service.s3.listObjectsV2(listParams).promise();
            
            if (listedObjects.Contents?.length > 0) {
                const deleteParams = {
                    Bucket: oldBucketName,
                    Delete: {
                        Objects: listedObjects.Contents.map(obj => ({ Key: obj.Key }))
                    }
                };
                
                await this.s3Service.s3.deleteObjects(deleteParams).promise();
                deletedCount += listedObjects.Contents.length;
            }
            
            continuationToken = listedObjects.NextContinuationToken;
        } while (continuationToken);
        
        // Delete the bucket
        await this.s3Service.s3.deleteBucket({ Bucket: oldBucketName }).promise();
        
        console.log(`✅ Deleted shared bucket ${oldBucketName} and ${deletedCount} objects`);
        
        return { deletedObjects: deletedCount };
    }
}

module.exports = S3MigrationService;