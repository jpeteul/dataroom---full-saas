require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('./database'); // Using pool directly instead of Database class
const S3ServiceV2 = require('./services/s3-service');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

const { ClaudeRateLimiter, createClaudeApiWithRateLimit } = require('./services/claude-rate-limiter');

// Import new multi-tenant modules
const AuthService = require('./services/auth-service');
const Tenant = require('./models/tenant');
const tenantMiddleware = require('./middleware/tenant-middleware');
const { authenticateToken, requireAdmin } = require('./middleware/auth-middleware');

// Import routes
const authRoutes = require('./routes/auth-routes');
const tenantRoutes = require('./routes/tenant-routes');

// Initialize services
const s3Service = new S3ServiceV2();

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    // Allow all subdomains for multi-tenant support
    const allowedPatterns = [
      /\.railway\.app$/,
      /localhost/,
      /127\.0\.0\.1/,
      // Add your production domain here
      // /\.yourdomain\.com$/
    ];
    
    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
    
    if (isAllowed) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-tenant-slug'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mode: 'multi-tenant'
  });
});

// Mount authentication routes (public)
app.use('/api', authRoutes);

// Mount tenant management routes (requires auth)
app.use('/api', tenantRoutes);

// Settings routes with tenant context
app.get('/api/settings', 
  authenticateToken, 
  tenantMiddleware.extractTenant,
  async (req, res) => {
    try {
      const query = `
        SELECT * FROM tenant_settings 
        WHERE tenant_id = $1
      `;
      const result = await pool.query(query, [req.tenantId]);
      
      if (result.rows.length === 0) {
        return res.json({
          company_name: req.tenant.name,
          app_title: 'Smart DataRoom',
          primary_color: '#4F46E5',
          logo_url: null
        });
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Failed to retrieve settings' });
    }
  }
);

app.put('/api/settings',
  authenticateToken,
  tenantMiddleware.extractTenant,
  tenantMiddleware.requireTenantAdmin,
  async (req, res) => {
    try {
      const { company_name, logo_url, primary_color, app_title } = req.body;
      
      const query = `
        INSERT INTO tenant_settings (
          tenant_id, company_name, logo_url, primary_color, app_title
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id) 
        DO UPDATE SET
          company_name = EXCLUDED.company_name,
          logo_url = EXCLUDED.logo_url,
          primary_color = EXCLUDED.primary_color,
          app_title = EXCLUDED.app_title,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;
      
      const result = await pool.query(query, [
        req.tenantId,
        company_name,
        logo_url,
        primary_color,
        app_title
      ]);
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

// Document routes with tenant isolation
app.get('/api/documents',
  authenticateToken,
  tenantMiddleware.extractTenant,
  async (req, res) => {
    try {
      const query = `
        SELECT * FROM documents 
        WHERE tenant_id = $1
        ORDER BY uploaded_at DESC
      `;
      const result = await pool.query(query, [req.tenantId]);
      res.json(result.rows);
    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({ error: 'Failed to retrieve documents' });
    }
  }
);

// Upload documents with tenant context
app.post('/api/documents/upload',
  authenticateToken,
  tenantMiddleware.extractTenant,
  tenantMiddleware.requireTenantAdmin,
  tenantMiddleware.checkTenantLimits('documents'),
  async (req, res) => {
    try {
      // Use tenant slug for S3 bucket
      const clientId = req.tenant.slug;
      
      // Ensure S3 bucket exists for tenant
      await s3Service.createClientBucket(clientId);
      
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { 
          fileSize: 100 * 1024 * 1024,
          files: 10
        }
      }).array('files', 10);

      upload(req, res, async (err) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }

        const uploadedDocs = [];
        
        for (const file of req.files) {
          try {
            // Generate unique document ID
            const documentId = require('crypto').randomUUID();
            
            // Upload to S3 with tenant context
            const s3Result = await s3Service.uploadDocument(
              clientId,
              documentId,
              file.buffer,
              file.originalname,
              file.mimetype
            );

            // Save to database with tenant_id
            const dbQuery = `
              INSERT INTO documents (
                id, original_name, s3_key, s3_bucket, 
                mime_type, file_size, status, tenant_id, uploaded_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING *
            `;

            const dbResult = await pool.query(dbQuery, [
              documentId,
              file.originalname,
              s3Result.key,
              s3Result.bucket,
              file.mimetype,
              file.size,
              'uploaded',
              req.tenantId,
              req.user.id
            ]);

            uploadedDocs.push(dbResult.rows[0]);

            // Log activity
            await Tenant.logAudit(
              req.tenantId,
              req.user.id,
              'DOCUMENT_UPLOADED',
              'document',
              documentId,
              { filename: file.originalname, size: file.size }
            );
          } catch (uploadError) {
            console.error('Upload error for file:', file.originalname, uploadError);
          }
        }

        // Update usage tracking
        await Tenant.updateUsageTracking(req.tenantId);

        res.json({
          success: true,
          documents: uploadedDocs
        });
      });
    } catch (error) {
      console.error('Upload documents error:', error);
      res.status(500).json({ error: 'Failed to upload documents' });
    }
  }
);

// Download document with tenant validation
app.get('/api/documents/:id/download',
  authenticateToken,
  tenantMiddleware.extractTenant,
  async (req, res) => {
    try {
      const documentId = req.params.id;
      
      // Verify document belongs to tenant
      const query = `
        SELECT * FROM documents 
        WHERE id = $1 AND tenant_id = $2
      `;
      const result = await pool.query(query, [documentId, req.tenantId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      const document = result.rows[0];
      
      // Generate pre-signed URL for download
      const downloadUrl = await s3Service.getDownloadUrl(
        req.tenant.slug,
        document.s3_key
      );
      
      // Log activity
      await Tenant.logAudit(
        req.tenantId,
        req.user.id,
        'DOCUMENT_DOWNLOADED',
        'document',
        documentId,
        { filename: document.original_name }
      );
      
      res.json({
        url: downloadUrl,
        filename: document.original_name
      });
    } catch (error) {
      console.error('Download document error:', error);
      res.status(500).json({ error: 'Failed to generate download link' });
    }
  }
);

// Analytics routes with tenant isolation
app.get('/api/analytics/dashboard',
  authenticateToken,
  tenantMiddleware.extractTenant,
  tenantMiddleware.requireTenantAdmin,
  async (req, res) => {
    try {
      const queries = {
        totalQuestions: `
          SELECT COUNT(*) as count 
          FROM analytics_questions 
          WHERE tenant_id = $1
        `,
        totalSessions: `
          SELECT COUNT(*) as count 
          FROM analytics_sessions 
          WHERE tenant_id = $1
        `,
        activeUsers: `
          SELECT COUNT(DISTINCT user_id) as count 
          FROM analytics_sessions 
          WHERE tenant_id = $1 
          AND login_time >= CURRENT_DATE - INTERVAL '30 days'
        `,
        documentInteractions: `
          SELECT COUNT(*) as count 
          FROM analytics_documents 
          WHERE tenant_id = $1
        `,
        recentQuestions: `
          SELECT 
            aq.*,
            u.name as user_name,
            u.email as user_email
          FROM analytics_questions aq
          JOIN users u ON aq.user_id = u.id
          WHERE aq.tenant_id = $1
          ORDER BY aq.created_at DESC
          LIMIT 10
        `,
        topDocuments: `
          SELECT 
            d.original_name,
            COUNT(ad.id) as interaction_count
          FROM analytics_documents ad
          JOIN documents d ON ad.document_id = d.id
          WHERE ad.tenant_id = $1
          GROUP BY d.id, d.original_name
          ORDER BY interaction_count DESC
          LIMIT 10
        `
      };

      const analytics = {};
      
      for (const [key, query] of Object.entries(queries)) {
        const result = await pool.query(query, [req.tenantId]);
        
        if (key.includes('recent') || key.includes('top')) {
          analytics[key] = result.rows;
        } else {
          analytics[key] = result.rows[0].count;
        }
      }

      res.json(analytics);
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({ error: 'Failed to retrieve analytics' });
    }
  }
);

// Q&A endpoint with tenant context
app.post('/api/ask',
  authenticateToken,
  tenantMiddleware.extractTenant,
  async (req, res) => {
    try {
      const { question } = req.body;
      
      if (!question) {
        return res.status(400).json({ error: 'Question is required' });
      }

      // Get tenant documents for context
      const docsQuery = `
        SELECT * FROM documents 
        WHERE tenant_id = $1 
        AND status = 'analyzed'
        ORDER BY uploaded_at DESC
      `;
      const docsResult = await pool.query(docsQuery, [req.tenantId]);
      
      // Process question with Claude (existing logic)
      const startTime = Date.now();
      
      // TODO: Integrate with existing Claude processing logic
      // For now, return a placeholder response
      const answer = `This is a placeholder answer for: "${question}". 
        The actual Claude integration needs to be connected here.`;
      
      const processingTime = Date.now() - startTime;
      
      // Log the question
      const logQuery = `
        INSERT INTO analytics_questions (
          user_id, tenant_id, question, answer, 
          processing_time, sources_used
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      
      await pool.query(logQuery, [
        req.user.id,
        req.tenantId,
        question,
        answer,
        processingTime,
        JSON.stringify([])
      ]);

      // Update usage tracking
      await Tenant.updateUsageTracking(req.tenantId);
      
      res.json({
        answer,
        sources: [],
        processingTime
      });
    } catch (error) {
      console.error('Q&A error:', error);
      res.status(500).json({ error: 'Failed to process question' });
    }
  }
);

// Initialize database and start server
async function initializeApp() {
  try {
    // Test database connection
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
    
    // Check if migration has been run
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tenants'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('⚠️  Multi-tenant tables not found. Please run: node migrate.js');
    } else {
      console.log('✅ Multi-tenant tables detected');
      
      // Get tenant count
      const tenantCount = await pool.query('SELECT COUNT(*) FROM tenants');
      console.log(`📊 Active tenants: ${tenantCount.rows[0].count}`);
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Multi-tenant server running on port ${PORT}`);
      console.log(`🔐 Mode: Multi-tenant SaaS`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await pool.end();
  process.exit(0);
});

initializeApp();