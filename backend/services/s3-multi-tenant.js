const AWS = require('aws-sdk');
const crypto = require('crypto');

class S3MultiTenantService {
    constructor() {
        // Configure AWS SDK
        AWS.config.update({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            region: process.env.AWS_REGION || 'us-east-1'
        });
        
        this.s3 = new AWS.S3({
            apiVersion: '2006-03-01',
            region: process.env.AWS_REGION || 'us-east-1'
        });
        
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.bucketPrefix = process.env.AWS_S3_BUCKET_PREFIX || 'dataroom-saas';
        
        console.log(`🔧 Multi-Tenant S3 Service initialized for region: ${this.region}`);
    }

    // Generate unique bucket name for tenant
    getTenantBucketName(tenantSlug) {
        // AWS bucket names must be globally unique and DNS-compliant
        const sanitizedSlug = tenantSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        return `${this.bucketPrefix}-${sanitizedSlug}-${crypto.randomBytes(4).toString('hex')}`;
    }

    // Create or verify tenant bucket exists
    async ensureTenantBucket(tenant) {
        let bucketName = tenant.aws_bucket_name;
        
        // If tenant doesn't have a bucket yet, create one
        if (!bucketName) {
            bucketName = this.getTenantBucketName(tenant.slug);
            
            // Update tenant record with bucket name
            const pool = require('../database');
            await pool.query(
                'UPDATE tenants SET aws_bucket_name = $1 WHERE id = $2',
                [bucketName, tenant.id]
            );
            
            tenant.aws_bucket_name = bucketName;
        }
        
        try {
            // Check if bucket exists
            await this.s3.headBucket({ Bucket: bucketName }).promise();
            console.log(`✅ Tenant bucket exists: ${bucketName}`);
        } catch (error) {
            if (error.statusCode === 404) {
                // Create bucket
                await this.createBucket(bucketName);
                await this.configureBucketSecurity(bucketName);
                await this.configureBucketLifecycle(bucketName);
                await this.configureBucketCORS(bucketName);
                console.log(`✅ Created tenant bucket: ${bucketName}`);
            } else {
                throw error;
            }
        }
        
        return bucketName;
    }

    // Create S3 bucket with proper configuration
    async createBucket(bucketName) {
        const params = {
            Bucket: bucketName
        };
        
        // Add location constraint for non us-east-1 regions
        if (this.region !== 'us-east-1') {
            params.CreateBucketConfiguration = {
                LocationConstraint: this.region
            };
        }
        
        await this.s3.createBucket(params).promise();
    }

    // Configure bucket security settings
    async configureBucketSecurity(bucketName) {
        // Block all public access
        await this.s3.putPublicAccessBlock({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                IgnorePublicAcls: true,
                BlockPublicPolicy: true,
                RestrictPublicBuckets: true
            }
        }).promise();

        // Enable server-side encryption by default
        await this.s3.putBucketEncryption({
            Bucket: bucketName,
            ServerSideEncryptionConfiguration: {
                Rules: [{
                    ApplyServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256'
                    }
                }]
            }
        }).promise();

        // Enable versioning for data protection
        await this.s3.putBucketVersioning({
            Bucket: bucketName,
            VersioningConfiguration: {
                Status: 'Enabled'
            }
        }).promise();
    }

    // Configure lifecycle rules for cost optimization
    async configureBucketLifecycle(bucketName) {
        await this.s3.putBucketLifecycleConfiguration({
            Bucket: bucketName,
            LifecycleConfiguration: {
                Rules: [
                    {
                        Id: 'DeleteOldVersions',
                        Status: 'Enabled',
                        NoncurrentVersionExpiration: {
                            NoncurrentDays: 30
                        }
                    },
                    {
                        Id: 'TransitionToIA',
                        Status: 'Enabled',
                        Transitions: [{
                            Days: 90,
                            StorageClass: 'STANDARD_IA'
                        }]
                    },
                    {
                        Id: 'DeleteTempFiles',
                        Status: 'Enabled',
                        Prefix: 'temp/',
                        Expiration: {
                            Days: 1
                        }
                    }
                ]
            }
        }).promise();
    }

    // Configure CORS for direct browser uploads
    async configureBucketCORS(bucketName) {
        await this.s3.putBucketCors({
            Bucket: bucketName,
            CORSConfiguration: {
                CORSRules: [{
                    AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                    AllowedOrigins: ['*'], // In production, restrict this
                    AllowedHeaders: ['*'],
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3000
                }]
            }
        }).promise();
    }

    // Upload document to tenant bucket
    async uploadDocument(tenant, documentId, fileBuffer, originalName, mimeType) {
        const bucketName = await this.ensureTenantBucket(tenant);
        
        // Sanitize filename
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `documents/${documentId}/${sanitizedName}`;
        
        const params = {
            Bucket: bucketName,
            Key: key,
            Body: fileBuffer,
            ContentType: mimeType,
            ServerSideEncryption: 'AES256',
            Metadata: {
                'tenant-id': tenant.id,
                'document-id': documentId,
                'original-name': originalName,
                'uploaded-at': new Date().toISOString()
            }
        };
        
        const result = await this.s3.upload(params).promise();
        
        return {
            bucket: bucketName,
            key: key,
            location: result.Location,
            etag: result.ETag
        };
    }

    // Generate pre-signed URL for download
    async generateDownloadUrl(bucketName, key, filename, expiresIn = 3600) {
        const params = {
            Bucket: bucketName,
            Key: key,
            Expires: expiresIn,
            ResponseContentDisposition: `attachment; filename="${filename}"`
        };
        
        return await this.s3.getSignedUrlPromise('getObject', params);
    }

    // Generate pre-signed URL for upload
    async generateUploadUrl(tenant, documentId, filename, mimeType, expiresIn = 3600) {
        const bucketName = await this.ensureTenantBucket(tenant);
        const key = `documents/${documentId}/${filename}`;
        
        const params = {
            Bucket: bucketName,
            Key: key,
            Expires: expiresIn,
            ContentType: mimeType,
            ServerSideEncryption: 'AES256'
        };
        
        return {
            uploadUrl: await this.s3.getSignedUrlPromise('putObject', params),
            bucket: bucketName,
            key: key
        };
    }

    // Delete file from tenant bucket
    async deleteFile(bucketName, key) {
        await this.s3.deleteObject({
            Bucket: bucketName,
            Key: key
        }).promise();
    }

    // Get tenant storage usage
    async getTenantStorageUsage(tenant) {
        const bucketName = tenant.aws_bucket_name;
        if (!bucketName) return { totalSize: 0, fileCount: 0 };
        
        let totalSize = 0;
        let fileCount = 0;
        let continuationToken = null;
        
        do {
            const params = {
                Bucket: bucketName,
                Prefix: 'documents/',
                ContinuationToken: continuationToken
            };
            
            const response = await this.s3.listObjectsV2(params).promise();
            
            response.Contents?.forEach(object => {
                totalSize += object.Size;
                fileCount++;
            });
            
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        
        return {
            totalSize,
            totalSizeGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2),
            fileCount
        };
    }

    // Copy documents between tenants (for cloning/templates)
    async copyDocumentBetweenTenants(sourceTenant, targetTenant, sourceKey) {
        const sourceBucket = sourceTenant.aws_bucket_name;
        const targetBucket = await this.ensureTenantBucket(targetTenant);
        
        const newDocumentId = crypto.randomUUID();
        const targetKey = sourceKey.replace(/documents\/[^\/]+\//, `documents/${newDocumentId}/`);
        
        await this.s3.copyObject({
            Bucket: targetBucket,
            CopySource: `${sourceBucket}/${sourceKey}`,
            Key: targetKey,
            ServerSideEncryption: 'AES256'
        }).promise();
        
        return {
            bucket: targetBucket,
            key: targetKey,
            documentId: newDocumentId
        };
    }

    // Delete entire tenant bucket (for cleanup)
    async deleteTenantBucket(tenant) {
        const bucketName = tenant.aws_bucket_name;
        if (!bucketName) return;
        
        try {
            // First, delete all objects in the bucket
            let continuationToken = null;
            
            do {
                const listParams = {
                    Bucket: bucketName,
                    ContinuationToken: continuationToken
                };
                
                const listedObjects = await this.s3.listObjectsV2(listParams).promise();
                
                if (listedObjects.Contents?.length > 0) {
                    const deleteParams = {
                        Bucket: bucketName,
                        Delete: {
                            Objects: listedObjects.Contents.map(obj => ({ Key: obj.Key }))
                        }
                    };
                    
                    await this.s3.deleteObjects(deleteParams).promise();
                }
                
                continuationToken = listedObjects.NextContinuationToken;
            } while (continuationToken);
            
            // Then delete the bucket itself
            await this.s3.deleteBucket({ Bucket: bucketName }).promise();
            
            console.log(`✅ Deleted tenant bucket: ${bucketName}`);
        } catch (error) {
            console.error(`❌ Error deleting tenant bucket ${bucketName}:`, error);
            throw error;
        }
    }

    // Monitor bucket costs
    async getBucketMetrics(tenant) {
        const bucketName = tenant.aws_bucket_name;
        if (!bucketName) return null;
        
        const cloudwatch = new AWS.CloudWatch({ region: this.region });
        
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
        
        const params = {
            MetricName: 'BucketSizeBytes',
            Namespace: 'AWS/S3',
            StartTime: startTime,
            EndTime: endTime,
            Period: 86400, // 1 day
            Statistics: ['Average'],
            Dimensions: [
                { Name: 'BucketName', Value: bucketName },
                { Name: 'StorageType', Value: 'StandardStorage' }
            ]
        };
        
        try {
            const data = await cloudwatch.getMetricStatistics(params).promise();
            return data.Datapoints[0]?.Average || 0;
        } catch (error) {
            console.error('Error getting bucket metrics:', error);
            return 0;
        }
    }
}

module.exports = S3MultiTenantService;