const express = require('express');
const router = express.Router();
const pool = require('../database-pool');
const { authenticateToken, requireAdmin } = require('../middleware/auth-middleware');
const tenantMiddleware = require('../middleware/tenant-middleware');

// Get analytics dashboard data
router.get('/analytics/dashboard',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            
            // Default to last 30 days
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const end = endDate || new Date().toISOString();

            // Execute multiple analytics queries in parallel
            const [
                totalQuestions,
                totalSessions,
                activeUsers,
                documentInteractions,
                questionsByDay,
                topDocuments,
                userActivity,
                avgProcessingTime
            ] = await Promise.all([
                // Total questions
                pool.query(
                    'SELECT COUNT(*) as count FROM analytics_questions WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3',
                    [req.tenantId, start, end]
                ),
                
                // Total sessions
                pool.query(
                    'SELECT COUNT(*) as count FROM analytics_sessions WHERE tenant_id = $1 AND login_time BETWEEN $2 AND $3',
                    [req.tenantId, start, end]
                ),
                
                // Active users
                pool.query(
                    'SELECT COUNT(DISTINCT user_id) as count FROM analytics_sessions WHERE tenant_id = $1 AND login_time BETWEEN $2 AND $3',
                    [req.tenantId, start, end]
                ),
                
                // Document interactions
                pool.query(
                    'SELECT COUNT(*) as count FROM analytics_documents WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3',
                    [req.tenantId, start, end]
                ),
                
                // Questions by day
                pool.query(`
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as count
                    FROM analytics_questions
                    WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                    LIMIT 30
                `, [req.tenantId, start, end]),
                
                // Top documents
                pool.query(`
                    SELECT 
                        d.id,
                        d.original_name,
                        COUNT(ad.id) as interaction_count,
                        COUNT(DISTINCT ad.user_id) as unique_users
                    FROM documents d
                    LEFT JOIN analytics_documents ad ON d.id = ad.document_id
                    WHERE d.tenant_id = $1 
                    AND ad.timestamp BETWEEN $2 AND $3
                    GROUP BY d.id, d.original_name
                    ORDER BY interaction_count DESC
                    LIMIT 10
                `, [req.tenantId, start, end]),
                
                // User activity
                pool.query(`
                    SELECT 
                        u.id,
                        u.name,
                        u.email,
                        COUNT(DISTINCT aq.id) as questions_asked,
                        COUNT(DISTINCT ad.id) as documents_accessed,
                        MAX(as2.login_time) as last_active
                    FROM users u
                    LEFT JOIN analytics_questions aq ON u.id = aq.user_id 
                        AND aq.created_at BETWEEN $2 AND $3
                    LEFT JOIN analytics_documents ad ON u.id = ad.user_id 
                        AND ad.timestamp BETWEEN $2 AND $3
                    LEFT JOIN analytics_sessions as2 ON u.id = as2.user_id 
                        AND as2.login_time BETWEEN $2 AND $3
                    WHERE u.tenant_id = $1 AND u.is_active = true
                    GROUP BY u.id, u.name, u.email
                    ORDER BY questions_asked DESC
                    LIMIT 20
                `, [req.tenantId, start, end]),
                
                // Average processing time
                pool.query(
                    'SELECT AVG(processing_time) as avg_time FROM analytics_questions WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3',
                    [req.tenantId, start, end]
                )
            ]);

            res.json({
                success: true,
                period: { startDate: start, endDate: end },
                metrics: {
                    totalQuestions: totalQuestions.rows[0].count,
                    totalSessions: totalSessions.rows[0].count,
                    activeUsers: activeUsers.rows[0].count,
                    documentInteractions: documentInteractions.rows[0].count,
                    avgProcessingTime: avgProcessingTime.rows[0].avg_time || 0
                },
                charts: {
                    questionsByDay: questionsByDay.rows,
                    topDocuments: topDocuments.rows,
                    userActivity: userActivity.rows
                }
            });
        } catch (error) {
            console.error('Get analytics dashboard error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve analytics'
            });
        }
    }
);

// Get question history
router.get('/analytics/questions',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const { limit = 100, offset = 0, userId, startDate, endDate } = req.query;
            
            let query = `
                SELECT 
                    aq.*,
                    u.name as user_name,
                    u.email as user_email
                FROM analytics_questions aq
                JOIN users u ON aq.user_id = u.id
                WHERE aq.tenant_id = $1
            `;
            
            const params = [req.tenantId];
            let paramCount = 2;

            if (userId) {
                query += ` AND aq.user_id = $${paramCount}`;
                params.push(userId);
                paramCount++;
            }

            if (startDate) {
                query += ` AND aq.created_at >= $${paramCount}`;
                params.push(startDate);
                paramCount++;
            }

            if (endDate) {
                query += ` AND aq.created_at <= $${paramCount}`;
                params.push(endDate);
                paramCount++;
            }

            query += ` ORDER BY aq.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            
            // Get total count for pagination
            let countQuery = 'SELECT COUNT(*) FROM analytics_questions WHERE tenant_id = $1';
            const countParams = [req.tenantId];
            
            if (userId) {
                countQuery += ' AND user_id = $2';
                countParams.push(userId);
            }
            
            const countResult = await pool.query(countQuery, countParams);

            res.json({
                success: true,
                questions: result.rows,
                total: countResult.rows[0].count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Get questions history error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve question history'
            });
        }
    }
);

// Get session history
router.get('/analytics/sessions',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const { limit = 100, offset = 0, userId, startDate, endDate } = req.query;
            
            let query = `
                SELECT 
                    as2.*,
                    u.name as user_name,
                    u.email as user_email,
                    u.tenant_role
                FROM analytics_sessions as2
                JOIN users u ON as2.user_id = u.id
                WHERE as2.tenant_id = $1
            `;
            
            const params = [req.tenantId];
            let paramCount = 2;

            if (userId) {
                query += ` AND as2.user_id = $${paramCount}`;
                params.push(userId);
                paramCount++;
            }

            if (startDate) {
                query += ` AND as2.login_time >= $${paramCount}`;
                params.push(startDate);
                paramCount++;
            }

            if (endDate) {
                query += ` AND as2.login_time <= $${paramCount}`;
                params.push(endDate);
                paramCount++;
            }

            query += ` ORDER BY as2.login_time DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            
            res.json({
                success: true,
                sessions: result.rows,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Get sessions history error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve session history'
            });
        }
    }
);

// Export analytics data
router.get('/analytics/export',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const { type, startDate, endDate, format = 'json' } = req.query;
            
            if (!type || !['questions', 'sessions', 'documents', 'all'].includes(type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid export type. Must be: questions, sessions, documents, or all'
                });
            }

            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const end = endDate || new Date().toISOString();

            const exportData = {};

            if (type === 'questions' || type === 'all') {
                const questionsResult = await pool.query(`
                    SELECT 
                        aq.*,
                        u.name as user_name,
                        u.email as user_email
                    FROM analytics_questions aq
                    JOIN users u ON aq.user_id = u.id
                    WHERE aq.tenant_id = $1 
                    AND aq.created_at BETWEEN $2 AND $3
                    ORDER BY aq.created_at DESC
                `, [req.tenantId, start, end]);
                
                exportData.questions = questionsResult.rows;
            }

            if (type === 'sessions' || type === 'all') {
                const sessionsResult = await pool.query(`
                    SELECT 
                        as2.*,
                        u.name as user_name,
                        u.email as user_email
                    FROM analytics_sessions as2
                    JOIN users u ON as2.user_id = u.id
                    WHERE as2.tenant_id = $1 
                    AND as2.login_time BETWEEN $2 AND $3
                    ORDER BY as2.login_time DESC
                `, [req.tenantId, start, end]);
                
                exportData.sessions = sessionsResult.rows;
            }

            if (type === 'documents' || type === 'all') {
                const documentsResult = await pool.query(`
                    SELECT 
                        ad.*,
                        u.name as user_name,
                        u.email as user_email,
                        d.original_name as document_name
                    FROM analytics_documents ad
                    JOIN users u ON ad.user_id = u.id
                    JOIN documents d ON ad.document_id = d.id
                    WHERE ad.tenant_id = $1 
                    AND ad.timestamp BETWEEN $2 AND $3
                    ORDER BY ad.timestamp DESC
                `, [req.tenantId, start, end]);
                
                exportData.documents = documentsResult.rows;
            }

            // Add metadata
            exportData.metadata = {
                tenant_id: req.tenantId,
                tenant_name: req.tenant.name,
                export_date: new Date().toISOString(),
                period: { start, end },
                exported_by: req.user.email
            };

            if (format === 'csv') {
                // Convert to CSV format
                // This is a simplified version - you might want to use a CSV library
                const csvData = convertToCSV(exportData);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${Date.now()}.csv"`);
                res.send(csvData);
            } else {
                res.json({
                    success: true,
                    data: exportData
                });
            }
        } catch (error) {
            console.error('Export analytics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to export analytics'
            });
        }
    }
);

// Helper function to convert data to CSV
function convertToCSV(data) {
    let csv = '';
    
    // For simplicity, just handle questions export
    if (data.questions) {
        csv += 'Date,User,Email,Question,Answer,Processing Time (ms),Sources Used\n';
        data.questions.forEach(q => {
            csv += `"${q.created_at}","${q.user_name}","${q.user_email}","${q.question.replace(/"/g, '""')}","${(q.answer || '').replace(/"/g, '""')}","${q.processing_time}","${q.sources_used || ''}"\n`;
        });
    }
    
    return csv;
}

// Superadmin: Cross-tenant analytics
router.get('/analytics/global',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const end = endDate || new Date().toISOString();

            const [
                tenantStats,
                platformUsage,
                topTenants
            ] = await Promise.all([
                // Tenant statistics
                pool.query(`
                    SELECT 
                        COUNT(DISTINCT t.id) as total_tenants,
                        COUNT(DISTINCT CASE WHEN t.subscription_status = 'active' THEN t.id END) as active_tenants,
                        COUNT(DISTINCT u.id) as total_users,
                        COUNT(DISTINCT d.id) as total_documents,
                        SUM(d.file_size) as total_storage
                    FROM tenants t
                    LEFT JOIN users u ON t.id = u.tenant_id
                    LEFT JOIN documents d ON t.id = d.tenant_id
                `),
                
                // Platform usage over time
                pool.query(`
                    SELECT 
                        DATE(aq.created_at) as date,
                        COUNT(DISTINCT aq.tenant_id) as active_tenants,
                        COUNT(aq.id) as total_questions,
                        AVG(aq.processing_time) as avg_processing_time
                    FROM analytics_questions aq
                    WHERE aq.created_at BETWEEN $1 AND $2
                    GROUP BY DATE(aq.created_at)
                    ORDER BY date DESC
                    LIMIT 30
                `, [start, end]),
                
                // Top tenants by usage
                pool.query(`
                    SELECT 
                        t.id,
                        t.name,
                        t.slug,
                        t.subscription_tier,
                        COUNT(DISTINCT u.id) as user_count,
                        COUNT(DISTINCT d.id) as document_count,
                        COUNT(DISTINCT aq.id) as question_count,
                        COALESCE(SUM(d.file_size), 0) as storage_used
                    FROM tenants t
                    LEFT JOIN users u ON t.id = u.tenant_id
                    LEFT JOIN documents d ON t.id = d.tenant_id
                    LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                        AND aq.created_at BETWEEN $1 AND $2
                    GROUP BY t.id, t.name, t.slug, t.subscription_tier
                    ORDER BY question_count DESC
                    LIMIT 20
                `, [start, end])
            ]);

            res.json({
                success: true,
                period: { startDate: start, endDate: end },
                platformStats: tenantStats.rows[0],
                usageTrend: platformUsage.rows,
                topTenants: topTenants.rows
            });
        } catch (error) {
            console.error('Get global analytics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve global analytics'
            });
        }
    }
);

module.exports = router;