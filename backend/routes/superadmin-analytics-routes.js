const express = require('express');
const router = express.Router();
const pool = require('../database-pool');
const tenantMiddleware = require('../middleware/tenant-middleware');
const { authenticateToken } = require('../middleware/auth-middleware');

// Platform-wide real-time metrics
router.get('/superadmin/metrics/realtime',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const [
                platformStats,
                activityStats,
                performanceStats,
                healthMetrics
            ] = await Promise.all([
                // Platform overview
                pool.query(`
                    SELECT 
                        COUNT(DISTINCT t.id) as total_tenants,
                        COUNT(DISTINCT CASE WHEN t.subscription_status = 'active' THEN t.id END) as active_tenants,
                        COUNT(DISTINCT u.id) as total_users,
                        COUNT(DISTINCT d.id) as total_documents,
                        COALESCE(SUM(d.file_size), 0) as total_storage,
                        COUNT(DISTINCT CASE WHEN u.last_login >= CURRENT_DATE - INTERVAL '1 day' THEN u.id END) as daily_active_users,
                        COUNT(DISTINCT CASE WHEN u.last_login >= CURRENT_DATE - INTERVAL '7 days' THEN u.id END) as weekly_active_users
                    FROM tenants t
                    LEFT JOIN users u ON t.id = u.tenant_id
                    LEFT JOIN documents d ON t.id = d.tenant_id
                `),
                
                // Recent activity (last 24 hours)
                pool.query(`
                    SELECT 
                        COUNT(DISTINCT aq.id) as questions_24h,
                        COUNT(DISTINCT as2.id) as logins_24h,
                        COUNT(DISTINCT ad.id) as document_interactions_24h,
                        COUNT(DISTINCT d.id) as documents_uploaded_24h
                    FROM tenants t
                    LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                        AND aq.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                    LEFT JOIN analytics_sessions as2 ON t.id = as2.tenant_id 
                        AND as2.login_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                    LEFT JOIN analytics_documents ad ON t.id = ad.tenant_id 
                        AND ad.timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                    LEFT JOIN documents d ON t.id = d.tenant_id 
                        AND d.uploaded_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                `),
                
                // Performance metrics
                pool.query(`
                    SELECT 
                        AVG(aq.processing_time) as avg_processing_time,
                        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY aq.processing_time) as p95_processing_time,
                        COUNT(CASE WHEN aq.processing_time > 10000 THEN 1 END) as slow_queries_24h
                    FROM analytics_questions aq
                    WHERE aq.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                `),
                
                // System health indicators
                pool.query(`
                    SELECT 
                        COUNT(DISTINCT t.id) as healthy_tenants,
                        COUNT(DISTINCT CASE WHEN tu.storage_used_mb > 1000 THEN t.id END) as high_storage_tenants,
                        COUNT(DISTINCT CASE WHEN tu.api_calls_count > 1000 THEN t.id END) as high_usage_tenants
                    FROM tenants t
                    LEFT JOIN tenant_usage tu ON t.id = tu.tenant_id 
                        AND tu.month = date_trunc('month', CURRENT_DATE)
                `)
            ]);

            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                platform: platformStats.rows[0],
                activity: activityStats.rows[0],
                performance: performanceStats.rows[0],
                health: healthMetrics.rows[0]
            });
        } catch (error) {
            console.error('Get realtime metrics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve realtime metrics'
            });
        }
    }
);

// Platform usage trends over time
router.get('/superadmin/metrics/trends',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const { period = '30d' } = req.query;
            
            let intervalSize;
            let intervalLabel;
            let lookbackDays;
            
            switch (period) {
                case '7d':
                    intervalSize = '1 day';
                    intervalLabel = 'day';
                    lookbackDays = 7;
                    break;
                case '30d':
                    intervalSize = '1 day';
                    intervalLabel = 'day';
                    lookbackDays = 30;
                    break;
                case '90d':
                    intervalSize = '7 days';
                    intervalLabel = 'week';
                    lookbackDays = 90;
                    break;
                case '1y':
                    intervalSize = '1 month';
                    intervalLabel = 'month';
                    lookbackDays = 365;
                    break;
                default:
                    intervalSize = '1 day';
                    intervalLabel = 'day';
                    lookbackDays = 30;
            }

            const trends = await pool.query(`
                SELECT 
                    date_trunc($1, date_series) as period,
                    COUNT(DISTINCT aq.tenant_id) as active_tenants,
                    COUNT(aq.id) as total_questions,
                    COUNT(DISTINCT as2.user_id) as active_users,
                    COUNT(DISTINCT ad.document_id) as documents_accessed,
                    AVG(aq.processing_time) as avg_processing_time
                FROM generate_series(
                    CURRENT_DATE - INTERVAL '${lookbackDays} days',
                    CURRENT_DATE,
                    INTERVAL $1
                ) as date_series
                LEFT JOIN analytics_questions aq ON date_trunc($1, aq.created_at) = date_trunc($1, date_series)
                LEFT JOIN analytics_sessions as2 ON date_trunc($1, as2.login_time) = date_trunc($1, date_series)
                LEFT JOIN analytics_documents ad ON date_trunc($1, ad.timestamp) = date_trunc($1, date_series)
                GROUP BY period
                ORDER BY period ASC
            `, [intervalLabel]);

            res.json({
                success: true,
                period,
                interval: intervalLabel,
                trends: trends.rows
            });
        } catch (error) {
            console.error('Get trends error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve trend data'
            });
        }
    }
);

// Tenant health scores and rankings
router.get('/superadmin/tenants/health',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const tenantHealth = await pool.query(`
                SELECT 
                    t.id,
                    t.name,
                    t.slug,
                    t.subscription_tier,
                    t.subscription_status,
                    t.created_at,
                    
                    -- User metrics
                    COUNT(DISTINCT u.id) as user_count,
                    COUNT(DISTINCT CASE WHEN u.last_login >= CURRENT_DATE - INTERVAL '7 days' THEN u.id END) as active_users_7d,
                    
                    -- Usage metrics
                    COUNT(DISTINCT d.id) as document_count,
                    COUNT(DISTINCT aq.id) as question_count_30d,
                    COUNT(DISTINCT ad.id) as document_interactions_30d,
                    
                    -- Storage metrics
                    COALESCE(SUM(d.file_size), 0) as storage_used,
                    
                    -- Engagement score calculation
                    CASE 
                        WHEN COUNT(DISTINCT u.id) = 0 THEN 0
                        ELSE (
                            (COUNT(DISTINCT CASE WHEN u.last_login >= CURRENT_DATE - INTERVAL '7 days' THEN u.id END) * 30) +
                            (LEAST(COUNT(DISTINCT aq.id), 100) * 20) +
                            (LEAST(COUNT(DISTINCT d.id), 50) * 25) +
                            (CASE WHEN COUNT(DISTINCT ad.id) > 0 THEN 25 ELSE 0 END)
                        ) / COUNT(DISTINCT u.id)
                    END as engagement_score
                    
                FROM tenants t
                LEFT JOIN users u ON t.id = u.tenant_id AND u.is_active = true
                LEFT JOIN documents d ON t.id = d.tenant_id
                LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                    AND aq.created_at >= CURRENT_DATE - INTERVAL '30 days'
                LEFT JOIN analytics_documents ad ON t.id = ad.tenant_id 
                    AND ad.timestamp >= CURRENT_DATE - INTERVAL '30 days'
                WHERE t.is_active = true
                GROUP BY t.id, t.name, t.slug, t.subscription_tier, t.subscription_status, t.created_at
                ORDER BY engagement_score DESC, question_count_30d DESC
            `);

            // Calculate health categories
            const healthCategories = {
                excellent: tenantHealth.rows.filter(t => t.engagement_score >= 80),
                good: tenantHealth.rows.filter(t => t.engagement_score >= 60 && t.engagement_score < 80),
                fair: tenantHealth.rows.filter(t => t.engagement_score >= 40 && t.engagement_score < 60),
                poor: tenantHealth.rows.filter(t => t.engagement_score < 40)
            };

            res.json({
                success: true,
                tenants: tenantHealth.rows,
                healthCategories,
                summary: {
                    totalTenants: tenantHealth.rows.length,
                    healthyTenants: healthCategories.excellent.length + healthCategories.good.length,
                    atRiskTenants: healthCategories.poor.length,
                    averageEngagement: tenantHealth.rows.reduce((sum, t) => sum + t.engagement_score, 0) / tenantHealth.rows.length
                }
            });
        } catch (error) {
            console.error('Get tenant health error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve tenant health data'
            });
        }
    }
);

// Revenue and subscription analytics
router.get('/superadmin/revenue/overview',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            // Subscription tier pricing
            const tierPricing = {
                'free': 0,
                'starter': 29,
                'professional': 99,
                'enterprise': 299
            };

            const revenueQuery = await pool.query(`
                SELECT 
                    t.subscription_tier,
                    COUNT(*) as tenant_count,
                    COUNT(CASE WHEN t.subscription_status = 'active' THEN 1 END) as active_count,
                    COUNT(CASE WHEN t.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_this_month
                FROM tenants t
                WHERE t.is_active = true
                GROUP BY t.subscription_tier
                ORDER BY 
                    CASE t.subscription_tier
                        WHEN 'enterprise' THEN 4
                        WHEN 'professional' THEN 3
                        WHEN 'starter' THEN 2
                        WHEN 'free' THEN 1
                        ELSE 0
                    END DESC
            `);

            // Calculate revenue metrics
            let monthlyRevenue = 0;
            let projectedAnnualRevenue = 0;
            
            const subscriptionBreakdown = revenueQuery.rows.map(row => {
                const tierRevenue = row.active_count * (tierPricing[row.subscription_tier] || 0);
                monthlyRevenue += tierRevenue;
                
                return {
                    tier: row.subscription_tier,
                    tenantCount: parseInt(row.tenant_count),
                    activeCount: parseInt(row.active_count),
                    newThisMonth: parseInt(row.new_this_month),
                    monthlyRevenue: tierRevenue,
                    pricePerSeat: tierPricing[row.subscription_tier] || 0
                };
            });

            projectedAnnualRevenue = monthlyRevenue * 12;

            // Get growth metrics (compare with last month)
            const lastMonthQuery = await pool.query(`
                SELECT COUNT(*) as tenants_last_month
                FROM tenants t
                WHERE t.subscription_status = 'active'
                AND t.created_at < date_trunc('month', CURRENT_DATE)
                AND t.created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
            `);

            const growthRate = lastMonthQuery.rows[0]?.tenants_last_month > 0 ? 
                ((subscriptionBreakdown.reduce((sum, s) => sum + s.activeCount, 0) - 
                  lastMonthQuery.rows[0].tenants_last_month) / 
                 lastMonthQuery.rows[0].tenants_last_month) * 100 : 0;

            res.json({
                success: true,
                revenue: {
                    monthlyRevenue,
                    projectedAnnualRevenue,
                    growthRate: Math.round(growthRate * 100) / 100,
                    averageRevenuePerTenant: subscriptionBreakdown.length > 0 ? 
                        monthlyRevenue / subscriptionBreakdown.reduce((sum, s) => sum + s.activeCount, 0) : 0
                },
                subscriptions: subscriptionBreakdown,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Get revenue overview error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve revenue data'
            });
        }
    }
);

// System performance monitoring
router.get('/superadmin/system/performance',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const [
                responseTimeStats,
                errorRates,
                resourceUsage,
                apiMetrics
            ] = await Promise.all([
                // Response time analysis
                pool.query(`
                    SELECT 
                        AVG(processing_time) as avg_response_time,
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY processing_time) as median_response_time,
                        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time) as p95_response_time,
                        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY processing_time) as p99_response_time,
                        COUNT(*) as total_requests
                    FROM analytics_questions
                    WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                `),
                
                // Error rate tracking (simulated - in production, track from logs)
                pool.query(`
                    SELECT 
                        COUNT(*) as total_operations,
                        0 as error_count,
                        0.0 as error_rate
                `),
                
                // Resource usage per tenant
                pool.query(`
                    SELECT 
                        t.id,
                        t.name,
                        t.subscription_tier,
                        COALESCE(tu.storage_used_mb, 0) as storage_mb,
                        COALESCE(tu.api_calls_count, 0) as api_calls,
                        COALESCE(tu.active_users_count, 0) as active_users,
                        COALESCE(tu.documents_count, 0) as documents
                    FROM tenants t
                    LEFT JOIN tenant_usage tu ON t.id = tu.tenant_id 
                        AND tu.month = date_trunc('month', CURRENT_DATE)
                    WHERE t.is_active = true
                    ORDER BY tu.api_calls_count DESC NULLS LAST
                    LIMIT 20
                `),
                
                // API usage patterns
                pool.query(`
                    SELECT 
                        DATE(aq.created_at) as date,
                        COUNT(*) as api_calls,
                        COUNT(DISTINCT aq.tenant_id) as unique_tenants,
                        AVG(aq.processing_time) as avg_processing_time
                    FROM analytics_questions aq
                    WHERE aq.created_at >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY DATE(aq.created_at)
                    ORDER BY date DESC
                    LIMIT 30
                `)
            ]);

            res.json({
                success: true,
                performance: {
                    responseTime: responseTimeStats.rows[0],
                    errors: errorRates.rows[0],
                    resourceUsage: resourceUsage.rows,
                    apiTrends: apiMetrics.rows
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Get performance metrics error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve performance data'
            });
        }
    }
);

// Platform alerts and notifications
router.get('/superadmin/alerts',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const alerts = [];

            // Check for tenants approaching limits
            const limitChecks = await pool.query(`
                SELECT 
                    t.id,
                    t.name,
                    t.max_users,
                    t.max_storage_gb,
                    t.max_documents,
                    COUNT(DISTINCT u.id) as current_users,
                    COALESCE(SUM(d.file_size), 0) / (1024*1024*1024) as current_storage_gb,
                    COUNT(DISTINCT d.id) as current_documents
                FROM tenants t
                LEFT JOIN users u ON t.id = u.tenant_id AND u.is_active = true
                LEFT JOIN documents d ON t.id = d.tenant_id
                WHERE t.is_active = true
                GROUP BY t.id, t.name, t.max_users, t.max_storage_gb, t.max_documents
                HAVING 
                    COUNT(DISTINCT u.id) >= t.max_users * 0.8 OR
                    COALESCE(SUM(d.file_size), 0) / (1024*1024*1024) >= t.max_storage_gb * 0.8 OR
                    COUNT(DISTINCT d.id) >= t.max_documents * 0.8
            `);

            limitChecks.rows.forEach(tenant => {
                const userUsage = (tenant.current_users / tenant.max_users) * 100;
                const storageUsage = (tenant.current_storage_gb / tenant.max_storage_gb) * 100;
                const documentUsage = (tenant.current_documents / tenant.max_documents) * 100;

                if (userUsage >= 80) {
                    alerts.push({
                        id: `users-${tenant.id}`,
                        type: userUsage >= 95 ? 'error' : 'warning',
                        title: 'User limit approaching',
                        message: `${tenant.name} is using ${userUsage.toFixed(1)}% of user limit`,
                        tenant: tenant.name,
                        metric: 'users',
                        usage: userUsage,
                        timestamp: new Date()
                    });
                }

                if (storageUsage >= 80) {
                    alerts.push({
                        id: `storage-${tenant.id}`,
                        type: storageUsage >= 95 ? 'error' : 'warning',
                        title: 'Storage limit approaching',
                        message: `${tenant.name} is using ${storageUsage.toFixed(1)}% of storage limit`,
                        tenant: tenant.name,
                        metric: 'storage',
                        usage: storageUsage,
                        timestamp: new Date()
                    });
                }
            });

            // Check for inactive tenants
            const inactiveTenants = await pool.query(`
                SELECT 
                    t.id,
                    t.name,
                    t.subscription_tier,
                    t.created_at,
                    COUNT(DISTINCT aq.id) as questions_30d,
                    COUNT(DISTINCT as2.id) as logins_30d
                FROM tenants t
                LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                    AND aq.created_at >= CURRENT_DATE - INTERVAL '30 days'
                LEFT JOIN analytics_sessions as2 ON t.id = as2.tenant_id 
                    AND as2.login_time >= CURRENT_DATE - INTERVAL '30 days'
                WHERE t.is_active = true 
                AND t.subscription_status = 'active'
                AND t.subscription_tier != 'free'
                GROUP BY t.id, t.name, t.subscription_tier, t.created_at
                HAVING COUNT(DISTINCT aq.id) = 0 AND COUNT(DISTINCT as2.id) < 3
                ORDER BY t.created_at DESC
            `);

            inactiveTenants.rows.forEach(tenant => {
                alerts.push({
                    id: `inactive-${tenant.id}`,
                    type: 'warning',
                    title: 'Low engagement detected',
                    message: `${tenant.name} (${tenant.subscription_tier}) has minimal activity`,
                    tenant: tenant.name,
                    metric: 'engagement',
                    timestamp: new Date()
                });
            });

            // System-level alerts
            const systemStats = await pool.query(`
                SELECT 
                    COUNT(DISTINCT t.id) as total_tenants,
                    COUNT(DISTINCT aq.id) as questions_today
                FROM tenants t
                LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                    AND aq.created_at >= CURRENT_DATE
            `);

            const stats = systemStats.rows[0];
            
            if (stats.questions_today > 1000) {
                alerts.push({
                    id: 'high-load',
                    type: 'info',
                    title: 'High platform usage',
                    message: `${stats.questions_today} questions processed today`,
                    metric: 'system',
                    timestamp: new Date()
                });
            }

            res.json({
                success: true,
                alerts: alerts.sort((a, b) => b.timestamp - a.timestamp),
                summary: {
                    total: alerts.length,
                    critical: alerts.filter(a => a.type === 'error').length,
                    warnings: alerts.filter(a => a.type === 'warning').length,
                    info: alerts.filter(a => a.type === 'info').length
                }
            });
        } catch (error) {
            console.error('Get alerts error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve alerts'
            });
        }
    }
);

// Export platform data for reporting
router.get('/superadmin/export/platform-report',
    authenticateToken,
    tenantMiddleware.requireSuperAdmin,
    async (req, res) => {
        try {
            const { startDate, endDate, format = 'json' } = req.query;
            
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const end = endDate || new Date().toISOString();

            // Comprehensive platform report
            const [
                tenantSummary,
                usageMetrics,
                revenueMetrics,
                performanceMetrics
            ] = await Promise.all([
                pool.query(`
                    SELECT 
                        t.*,
                        COUNT(DISTINCT u.id) as user_count,
                        COUNT(DISTINCT d.id) as document_count,
                        COALESCE(SUM(d.file_size), 0) as storage_used,
                        COUNT(DISTINCT aq.id) as questions_count
                    FROM tenants t
                    LEFT JOIN users u ON t.id = u.tenant_id AND u.is_active = true
                    LEFT JOIN documents d ON t.id = d.tenant_id
                    LEFT JOIN analytics_questions aq ON t.id = aq.tenant_id 
                        AND aq.created_at BETWEEN $1 AND $2
                    GROUP BY t.id
                    ORDER BY t.created_at DESC
                `, [start, end]),
                
                pool.query(`
                    SELECT 
                        COUNT(DISTINCT aq.tenant_id) as active_tenants,
                        COUNT(aq.id) as total_questions,
                        COUNT(DISTINCT as2.user_id) as active_users,
                        COUNT(DISTINCT ad.document_id) as documents_accessed
                    FROM analytics_questions aq
                    LEFT JOIN analytics_sessions as2 ON aq.created_at::date = as2.login_time::date
                    LEFT JOIN analytics_documents ad ON aq.created_at::date = ad.timestamp::date
                    WHERE aq.created_at BETWEEN $1 AND $2
                `, [start, end]),
                
                pool.query(`
                    SELECT 
                        subscription_tier,
                        COUNT(*) as count,
                        SUM(CASE 
                            WHEN subscription_tier = 'starter' THEN 29
                            WHEN subscription_tier = 'professional' THEN 99
                            WHEN subscription_tier = 'enterprise' THEN 299
                            ELSE 0
                        END) as monthly_revenue
                    FROM tenants
                    WHERE subscription_status = 'active'
                    GROUP BY subscription_tier
                `),
                
                pool.query(`
                    SELECT 
                        AVG(processing_time) as avg_processing_time,
                        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time) as p95_processing_time,
                        COUNT(*) as total_requests
                    FROM analytics_questions
                    WHERE created_at BETWEEN $1 AND $2
                `, [start, end])
            ]);

            const report = {
                metadata: {
                    generatedAt: new Date().toISOString(),
                    period: { start, end },
                    generatedBy: 'superadmin'
                },
                tenants: tenantSummary.rows,
                usage: usageMetrics.rows[0],
                revenue: revenueMetrics.rows,
                performance: performanceMetrics.rows[0]
            };

            if (format === 'csv') {
                const csv = convertReportToCSV(report);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="platform-report-${Date.now()}.csv"`);
                res.send(csv);
            } else {
                res.json({
                    success: true,
                    report
                });
            }
        } catch (error) {
            console.error('Generate platform report error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate platform report'
            });
        }
    }
);

// Helper function to convert report to CSV
function convertReportToCSV(report) {
    let csv = 'Tenant Name,Slug,Subscription Tier,Status,Users,Documents,Storage (MB),Questions\n';
    
    report.tenants.forEach(tenant => {
        const storageInMB = Math.round((tenant.storage_used || 0) / (1024 * 1024));
        csv += `"${tenant.name}","${tenant.slug}","${tenant.subscription_tier}","${tenant.subscription_status}",${tenant.user_count},${tenant.document_count},${storageInMB},${tenant.questions_count}\n`;
    });
    
    return csv;
}

module.exports = router;