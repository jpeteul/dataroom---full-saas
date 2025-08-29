const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../database');
const S3ServiceV2 = require('../services/s3-service');
const Tenant = require('../models/tenant');
const { authenticateToken, requireAdmin } = require('../middleware/auth-middleware');
const tenantMiddleware = require('../middleware/tenant-middleware');

const s3Service = new S3ServiceV2();

// Get all documents for tenant
router.get('/documents',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const { status, tags, search } = req.query;
            
            let query = `
                SELECT d.*, u.name as uploaded_by_name
                FROM documents d
                LEFT JOIN users u ON d.uploaded_by = u.id
                WHERE d.tenant_id = $1
            `;
            
            const params = [req.tenantId];
            let paramCount = 2;

            // Add filters
            if (status) {
                query += ` AND d.status = $${paramCount}`;
                params.push(status);
                paramCount++;
            }

            if (tags && tags.length > 0) {
                query += ` AND d.tags && $${paramCount}`;
                params.push(tags);
                paramCount++;
            }

            if (search) {
                query += ` AND d.original_name ILIKE $${paramCount}`;
                params.push(`%${search}%`);
                paramCount++;
            }

            query += ' ORDER BY d.uploaded_at DESC';

            const result = await pool.query(query, params);
            
            res.json({
                success: true,
                documents: result.rows,
                count: result.rows.length
            });
        } catch (error) {
            console.error('Get documents error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve documents'
            });
        }
    }
);

// Get single document
router.get('/documents/:id',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const query = `
                SELECT d.*, u.name as uploaded_by_name
                FROM documents d
                LEFT JOIN users u ON d.uploaded_by = u.id
                WHERE d.id = $1 AND d.tenant_id = $2
            `;
            
            const result = await pool.query(query, [req.params.id, req.tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            res.json({
                success: true,
                document: result.rows[0]
            });
        } catch (error) {
            console.error('Get document error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve document'
            });
        }
    }
);

// Upload documents with tenant isolation
router.post('/documents/upload',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.checkTenantLimits('documents'),
    tenantMiddleware.logActivity('DOCUMENT_UPLOAD', 'document'),
    async (req, res) => {
        try {
            // Use tenant's AWS bucket
            const bucketName = req.tenant.aws_bucket_name || `dataroom-${req.tenant.slug}`;
            
            // Ensure bucket exists
            await s3Service.createClientBucket(req.tenant.slug);

            const upload = multer({
                storage: multer.memoryStorage(),
                limits: {
                    fileSize: 100 * 1024 * 1024, // 100MB
                    files: 10
                },
                fileFilter: (req, file, cb) => {
                    const allowed = /\.(pdf|jpe?g|png|txt|docx?|xlsx?|pptx?)$/i;
                    if (allowed.test(file.originalname)) {
                        cb(null, true);
                    } else {
                        cb(new Error('Invalid file type'));
                    }
                }
            }).array('files', 10);

            upload(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        error: err.message
                    });
                }

                const uploadedDocs = [];
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    for (const file of req.files) {
                        const documentId = require('crypto').randomUUID();
                        
                        // Upload to S3
                        const s3Result = await s3Service.uploadDocument(
                            req.tenant.slug,
                            documentId,
                            file.buffer,
                            file.originalname,
                            file.mimetype
                        );

                        // Save to database
                        const insertQuery = `
                            INSERT INTO documents (
                                id, tenant_id, original_name, s3_key, s3_bucket,
                                mime_type, file_size, status, uploaded_by, tags
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                            RETURNING *
                        `;

                        const result = await client.query(insertQuery, [
                            documentId,
                            req.tenantId,
                            file.originalname,
                            s3Result.key,
                            bucketName,
                            file.mimetype,
                            file.size,
                            'uploaded',
                            req.user.id,
                            []
                        ]);

                        uploadedDocs.push(result.rows[0]);
                    }

                    await client.query('COMMIT');

                    // Update usage tracking
                    await Tenant.updateUsageTracking(req.tenantId);

                    res.json({
                        success: true,
                        documents: uploadedDocs,
                        message: `${uploadedDocs.length} document(s) uploaded successfully`
                    });

                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            });
        } catch (error) {
            console.error('Upload documents error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to upload documents'
            });
        }
    }
);

// Download document with tenant validation
router.get('/documents/:id/download',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.logActivity('DOCUMENT_DOWNLOAD', 'document'),
    async (req, res) => {
        try {
            // Verify document belongs to tenant
            const query = `
                SELECT * FROM documents 
                WHERE id = $1 AND tenant_id = $2
            `;
            const result = await pool.query(query, [req.params.id, req.tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }
            
            const document = result.rows[0];

            // Track analytics
            const analyticsQuery = `
                INSERT INTO analytics_documents (
                    user_id, tenant_id, document_id, action, timestamp
                )
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            `;
            await pool.query(analyticsQuery, [
                req.user.id,
                req.tenantId,
                document.id,
                'download'
            ]);

            // Generate pre-signed URL
            const downloadUrl = await s3Service.generateDownloadUrl(
                document.s3_key,
                document.s3_bucket,
                document.original_name,
                3600 // 1 hour expiry
            );

            res.json({
                success: true,
                downloadUrl,
                fileName: document.original_name,
                fileSize: document.file_size,
                contentType: document.mime_type,
                expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            });
        } catch (error) {
            console.error('Download document error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate download link'
            });
        }
    }
);

// Delete document with tenant validation
router.delete('/documents/:id',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.logActivity('DOCUMENT_DELETE', 'document'),
    async (req, res) => {
        try {
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Verify document belongs to tenant
                const checkQuery = `
                    SELECT * FROM documents 
                    WHERE id = $1 AND tenant_id = $2
                `;
                const checkResult = await client.query(checkQuery, [req.params.id, req.tenantId]);
                
                if (checkResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Document not found'
                    });
                }
                
                const document = checkResult.rows[0];

                // Delete from S3
                if (document.s3_key && document.s3_bucket) {
                    await s3Service.deleteFile(document.s3_key, document.s3_bucket);
                }

                // Delete analytics records
                await client.query(
                    'DELETE FROM analytics_documents WHERE document_id = $1 AND tenant_id = $2',
                    [document.id, req.tenantId]
                );

                // Delete document
                await client.query(
                    'DELETE FROM documents WHERE id = $1 AND tenant_id = $2',
                    [document.id, req.tenantId]
                );

                await client.query('COMMIT');

                // Update usage tracking
                await Tenant.updateUsageTracking(req.tenantId);

                res.json({
                    success: true,
                    message: 'Document deleted successfully',
                    deletedDocument: {
                        id: document.id,
                        originalName: document.original_name
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Delete document error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete document'
            });
        }
    }
);

// Update document tags
router.put('/documents/:id/tags',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    tenantMiddleware.logActivity('DOCUMENT_UPDATE', 'document'),
    async (req, res) => {
        try {
            const { tags } = req.body;
            
            if (!Array.isArray(tags)) {
                return res.status(400).json({
                    success: false,
                    error: 'Tags must be an array'
                });
            }

            // Update with tenant validation
            const query = `
                UPDATE documents 
                SET tags = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND tenant_id = $3
                RETURNING *
            `;
            
            const result = await pool.query(query, [tags, req.params.id, req.tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            res.json({
                success: true,
                document: result.rows[0]
            });
        } catch (error) {
            console.error('Update tags error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update tags'
            });
        }
    }
);

// Get document analysis
router.get('/documents/:id/analysis',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const query = `
                SELECT id, original_name, status, analysis, error
                FROM documents 
                WHERE id = $1 AND tenant_id = $2
            `;
            
            const result = await pool.query(query, [req.params.id, req.tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            const document = result.rows[0];

            if (document.status !== 'analyzed') {
                return res.json({
                    success: true,
                    status: document.status,
                    error: document.error
                });
            }

            res.json({
                success: true,
                analysis: document.analysis,
                status: document.status
            });
        } catch (error) {
            console.error('Get analysis error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve analysis'
            });
        }
    }
);

// Trigger document analysis
router.post('/documents/:id/analyze',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            // Verify document belongs to tenant
            const checkQuery = `
                SELECT * FROM documents 
                WHERE id = $1 AND tenant_id = $2
            `;
            const checkResult = await pool.query(checkQuery, [req.params.id, req.tenantId]);
            
            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            const document = checkResult.rows[0];

            // Update status to processing
            await pool.query(
                'UPDATE documents SET status = $1 WHERE id = $2 AND tenant_id = $3',
                ['processing', document.id, req.tenantId]
            );

            // TODO: Trigger Claude analysis here
            // This would integrate with your existing Claude service
            
            res.json({
                success: true,
                message: 'Analysis started',
                documentId: document.id
            });
        } catch (error) {
            console.error('Start analysis error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to start analysis'
            });
        }
    }
);

module.exports = router;