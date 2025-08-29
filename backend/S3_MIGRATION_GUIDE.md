# S3 Multi-Tenant Migration Guide

## Overview

This guide covers migrating from a single shared S3 bucket to individual tenant-specific buckets for complete data isolation.

## What This Migration Does

### Before Migration
- Single shared S3 bucket: `dataroom-v2-demo-company-documents`
- All tenant documents mixed together
- No isolation between tenants

### After Migration
- Each tenant gets their own S3 bucket: `dataroom-saas-{tenant-slug}-{random}`
- Complete data isolation between tenants
- Enhanced security and compliance
- Individual cost tracking per tenant

## Pre-Migration Checklist

1. **Backup Database**
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
   ```

2. **Verify AWS Credentials**
   ```bash
   aws s3 ls  # Should work without errors
   ```

3. **Check Current System**
   ```bash
   node migrate-s3.js verify-all
   ```

## Migration Process

### Step 1: Run Database Migration
```bash
cd backend
node migrate-s3.js migrate-all
```

This will:
- Create new database tables for S3 tracking
- Add new columns to documents table
- Set up usage tracking triggers

### Step 2: Migrate Specific Tenant (Optional)
```bash
# For testing, migrate one tenant first
node migrate-s3.js migrate default-org
```

### Step 3: Verify Migration
```bash
# Check specific tenant
node migrate-s3.js verify default-org

# Check all tenants
node migrate-s3.js verify-all
```

### Step 4: Check Migration Status
```bash
node migrate-s3.js status default-org
```

## New S3 Bucket Structure

### Bucket Naming Convention
- Format: `dataroom-saas-{tenant-slug}-{4-char-hash}`
- Example: `dataroom-saas-acme-corp-a1b2c3d4`
- Globally unique across AWS

### Bucket Configuration
Each tenant bucket includes:
- **Security**: Private access only, no public access
- **Encryption**: AES256 server-side encryption
- **Versioning**: Enabled for data protection
- **Lifecycle**: Automatic cleanup of old versions (30 days)
- **CORS**: Configured for direct browser uploads

### File Structure
```
bucket-name/
├── documents/
│   ├── {document-id}/
│   │   └── sanitized-filename.pdf
│   └── {document-id}/
│       └── another-file.docx
└── temp/
    └── (temporary upload files)
```

## Migration Features

### Automatic Bucket Management
- Buckets created automatically when needed
- Security policies applied automatically
- Lifecycle rules for cost optimization

### Migration Tracking
- Database tracks migration progress
- Rollback capability if issues occur
- Detailed logging and error handling

### Usage Monitoring
- Real-time storage tracking per tenant
- CloudWatch integration for metrics
- Cost allocation per tenant

## Troubleshooting

### Common Issues

#### 1. AWS Permissions Error
```bash
Error: Access Denied
```
**Solution**: Ensure your AWS credentials have these permissions:
- s3:CreateBucket
- s3:DeleteBucket
- s3:ListBucket
- s3:GetObject
- s3:PutObject
- s3:DeleteObject
- s3:PutBucketPolicy
- s3:PutBucketEncryption

#### 2. Bucket Already Exists
```bash
Error: BucketAlreadyExists
```
**Solution**: Bucket names are globally unique. The migration service adds random suffixes to avoid conflicts.

#### 3. Migration Incomplete
```bash
Documents migrated: 15, Errors: 3
```
**Solution**: 
1. Check logs for specific errors
2. Run migration again (it's idempotent)
3. Use `verify` command to identify issues

### Manual Recovery

If migration fails partway through:

```bash
# Check what's been migrated
node migrate-s3.js status tenant-slug

# Verify current state
node migrate-s3.js verify tenant-slug

# Re-run migration (safe to repeat)
node migrate-s3.js migrate tenant-slug
```

## Post-Migration Tasks

### 1. Update Application Configuration

Update your server to use the new S3 service:

```javascript
// Replace old S3Service with new one
const S3Service = require('./services/s3-multi-tenant');
const s3Service = new S3Service();
```

### 2. Monitor Storage Usage

```bash
# Check tenant storage usage
SELECT 
    t.name,
    tu.storage_used_mb,
    tu.documents_count
FROM tenants t
JOIN tenant_usage tu ON t.id = tu.tenant_id
WHERE tu.month = date_trunc('month', CURRENT_DATE);
```

### 3. Set Up Monitoring

Monitor these metrics:
- Storage usage per tenant
- API request counts
- Error rates
- Cost allocation

## Cost Optimization

### Lifecycle Policies
Automatically applied to all tenant buckets:
- Delete old versions after 30 days
- Move to Standard-IA after 90 days
- Delete temporary files after 1 day

### Cost Tracking
Each bucket can be individually tracked:
```bash
aws s3api get-bucket-metrics-configuration --bucket bucket-name
```

## Security Enhancements

### Bucket Policies
Each bucket has strict policies:
- No public access allowed
- Server-side encryption required
- Access logging enabled

### Access Control
- Pre-signed URLs for limited-time access
- No direct public access to files
- Tenant isolation at bucket level

## Backup Strategy

### Automated Backups
- Cross-region replication available
- Versioning protects against accidental deletion
- Point-in-time recovery possible

### Manual Backup
```bash
# Backup specific tenant's documents
aws s3 sync s3://tenant-bucket s3://backup-bucket/tenant-name/
```

## Rollback Plan

If migration needs to be rolled back:

1. **Stop Application**
2. **Restore Database Backup**
   ```bash
   psql $DATABASE_URL < backup_$(date +%Y%m%d).sql
   ```
3. **Update Application Configuration**
4. **Clean Up New Buckets** (if necessary)

## Support Commands

### Quick Status Check
```bash
# Get overview of all migrations
psql $DATABASE_URL -c "
SELECT 
    t.name,
    sm.status,
    sm.documents_migrated,
    sm.completed_at
FROM tenants t
LEFT JOIN s3_migrations sm ON t.id = sm.tenant_id
ORDER BY t.name;
"
```

### Storage Usage Report
```bash
node -e "
const S3Service = require('./services/s3-multi-tenant');
const s3 = new S3Service();
// Generate usage report
"
```

## Best Practices

1. **Test First**: Always test with a single tenant before full migration
2. **Monitor Progress**: Use status commands to track progress
3. **Verify Results**: Always run verification after migration
4. **Plan Downtime**: Schedule migration during low-usage periods
5. **Keep Backups**: Maintain database backups during migration

## Getting Help

If you encounter issues:
1. Check the migration logs
2. Run verification commands
3. Review AWS CloudTrail logs
4. Check database migration status

The migration is designed to be safe and repeatable. You can always run it again if issues occur.