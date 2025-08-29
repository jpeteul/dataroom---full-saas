require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Database = require('./database'); 
const S3ServiceV2 = require('./services/s3-service');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

const { ClaudeRateLimiter, createClaudeApiWithRateLimit } = require('./services/claude-rate-limiter');

// Initialize services
const db = new Database();
const s3Service = new S3ServiceV2();

// Settings key mapping (single char to full names)
const settingsKeyMap = {
  'n': 'company_name',
  'l': 'logo_url', 
  'c': 'primary_color',
  't': 'app_title'
};

const reverseSettingsMap = {
  'company_name': 'n',
  'logo_url': 'l',
  'primary_color': 'c', 
  'app_title': 't'
};

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Increased from 5 to 10 for testing
  message: { error: 'Too many login attempts, please try again later.' },
  skip: (req) => {
    // Skip rate limiting in development or if we can't determine IP
    return !req.ip && !req.connection.remoteAddress;
  }
});

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (origin.includes('railway.app') || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Briefing configuration
let briefingConfig = {
  companyName: '',
  industry: '',
  stage: 'Series Seed',
  instructions: `You are an expert analyst helping investors understand an exciting company through their data room. 

LANGUAGE REQUIREMENT:
- ALWAYS respond in the same language as the question
- If the question is in Spanish, respond in Spanish
- If the question is in French, respond in French
- If the question is in English, respond in English
- Match the language exactly, maintaining professional tone in that language

RESPONSE STYLE:
- Start with a direct, confident answer to the specific question
- Use conversational, natural language - not bullet points
- Present information in the most positive yet factual light
- Keep responses under 150 words unless complex data requires more
- End with the most compelling forward-looking statement when relevant

SPECIAL EMPHASIS:
- For founder/team questions: ALWAYS include specific educational backgrounds, previous companies, and roles
- For financial questions: ALWAYS include specific numbers, metrics, and growth rates
- For traction questions: ALWAYS include client names, AUM figures, and performance metrics
- Never say information is "not provided" if it exists in the documents

TONE & APPROACH:
- Sound like an experienced investor relations professional
- Focus on strengths, achievements, and opportunities
- Present challenges as strategic considerations, not red flags
- Use specific metrics and names to build credibility
- Include ALL relevant credentials and background details for credibility

ANSWER STRUCTURE:
1. Direct answer with specific details (1-2 sentences)
2. Key supporting details with names, numbers, credentials (2-3 sentences)
3. Most compelling insight or forward-looking statement (1 sentence)
4. Source citation

Present the company as a strong investment opportunity while remaining factual and well-sourced.`
};

// Create default admin user on startup
const createDefaultAdmin = async () => {
  try {
    const existingAdmin = await db.getUserByEmail('admin@dataroom.com');
    if (existingAdmin) {
      console.log('✅ Default admin user already exists');
      return;
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminUser = {
      email: 'admin@dataroom.com',
      password: hashedPassword,
      role: 'admin',
      name: 'Admin User',
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await db.addUser(adminUser);
    console.log('✅ Default admin user created with email: admin@dataroom.com and password: admin123');
  } catch (error) {
    console.error('❌ Failed to create default admin user:', error);
  }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

// Claude API integration
// Initialize Claude rate limiter
const claudeRateLimiter = new ClaudeRateLimiter(20000); // 20,000 tokens per minute
const claudeApi = createClaudeApiWithRateLimit(claudeRateLimiter, process.env.CLAUDE_API_KEY);

// Use rate-limited Claude functions
const callClaudeWithDocument = claudeApi.callClaudeWithDocument;
const callClaude = claudeApi.callClaude;

// Process document from S3 (V2)
const processDocumentFromS3 = async (documentId) => {
  console.log(`🔍 Starting S3 document processing for ${documentId}`);
  
  try {
    // Wait a moment and retry if document not found
    let document = await db.getDocumentById(documentId);
    let retries = 0;
    
    while (!document && retries < 3) {
      console.log(`⏳ Document ${documentId} not found, retrying in 1s... (${retries + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      document = await db.getDocumentById(documentId);
      retries++;
    }
    
    if (!document) {
      console.log(`❌ Document ${documentId} not found in database after retries`);
      return;
    }

    if (!document.s3Key || !document.s3Bucket) {
      console.log(`❌ Document ${documentId} missing S3 info:`, {
        s3Key: document.s3Key,
        s3Bucket: document.s3Bucket
      });
      throw new Error('Document missing S3 information');
    }

    console.log(`📄 Processing S3 document: ${document.originalName}`);

    // Download file from S3 for Claude analysis
    console.log(`📥 Downloading from S3: ${document.s3Bucket}/${document.s3Key}`);
    const fileBuffer = await s3Service.getFile(document.s3Key, document.s3Bucket);

    console.log(`✅ File downloaded from S3, size: ${Math.round(fileBuffer.length / 1024)}KB`);

    // Convert to base64 for Claude
    const base64Content = fileBuffer.toString('base64');

    // Analyze with Claude
    const analysisPrompt = `Extract ALL information from this ${document.mimetype?.includes('pdf') ? 'PDF' : 'document'} for investor due diligence.

Document: ${document.originalName}

FIRST: Classify this document with appropriate tags from this list:
- LEGAL: contracts, bylaws, terms, compliance, IP rights
- FINANCIAL: revenue, costs, projections, funding, cap table
- BUSINESS: strategy, market analysis, competitive landscape  
- PRODUCT: specifications, roadmap, features, technology
- TEAM: bios, org chart, advisors, key personnel
- OPERATIONS: processes, vendors, partnerships, locations
- MARKET: customer data, sales pipeline, go-to-market strategy

Extract:
- Company details, mission, products/services
- All team members: names, titles, backgrounds
- All financial data: revenue, costs, projections, funding
- Market info: size, customers, competition
- Technology: IP, product specs, roadmap
- Legal: structure, agreements, risks
- Operations: metrics, processes, partnerships

Be comprehensive but concise. Include ALL names, numbers, dates exactly as shown.

FORMAT YOUR RESPONSE AS:
TAGS: [comma-separated list of applicable tags]

ANALYSIS: [detailed extracted information]

SOURCE: ${document.originalName}`;

    console.log(`🤖 Sending document to Claude for analysis...`);
    const fullResponse = await callClaudeWithDocument(analysisPrompt, base64Content, document.mimetype);
    
    console.log(`✅ Claude analysis completed, response length: ${fullResponse.length} characters`);

    // Parse tags and analysis
    const tagMatch = fullResponse.match(/TAGS:\s*(.+?)(?:\n|$)/i);
    const tags = tagMatch ? 
      tagMatch[1].split(',').map(tag => tag.trim().toUpperCase()) : 
      ['UNTAGGED'];

    const analysisMatch = fullResponse.match(/ANALYSIS:\s*([\s\S]+?)(?:\nSOURCE:|$)/i);
    const analysis = analysisMatch ? analysisMatch[1].trim() : fullResponse;

    console.log(`🏷️ Extracted tags:`, tags);

    // Update database with results
    const updateData = {
      status: 'completed',
      analysis: analysis,
      tags: tags,
      processedAt: new Date().toISOString()
    };

    await db.updateDocument(documentId, updateData);
    console.log(`✅ Document ${documentId} processing completed successfully`);

  } catch (error) {
    console.error(`❌ Error processing S3 document ${documentId}:`, error);
    
    await db.updateDocument(documentId, {
      status: 'error',
      error: error.message
    });
  }
};

// Question classification function
const classifyQuestion = async (question, availableTags) => {
  const classificationPrompt = `Classify this investor question into the most relevant categories from the available tags.

Available categories: ${availableTags.join(', ')}

Question: "${question}"

Rules:
- Choose 1-3 most relevant categories
- Use ONLY the categories from the available list above
- If no perfect match, choose the closest ones
- Respond with ONLY the category names, comma-separated
- No explanations or additional text

Examples:
- "What's your revenue growth?" → FINANCIAL
- "Who are the founders?" → TEAM  
- "What's your competitive advantage?" → BUSINESS, PRODUCT
- "Do you have any patents?" → LEGAL, PRODUCT
- "What's your go-to-market strategy?" → MARKET, BUSINESS

Classification:`;

  try {
    const classification = await callClaude(classificationPrompt);
    return classification.trim().split(',').map(tag => tag.trim().toUpperCase());
  } catch (error) {
    console.error('Question classification error:', error);
    return ['BUSINESS'];
  }
};

// ===== ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/claude/status', authenticateToken, requireAdmin, (req, res) => {
  const status = claudeRateLimiter.getStatus();
  res.json({
    success: true,
    rateLimiter: status,
    timestamp: new Date().toISOString()
  });
});

// Authentication Routes
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Track login session
    const sessionData = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      userId: user.id,
      email: user.email,
      loginTime: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
      lastActivity: new Date().toISOString()
    };
    
    await db.addAnalyticsSession(sessionData);

    console.log('✅ Login successful for:', email);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Register new user (admin only)
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role = 'investor' } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and name are required'
      });
    }

    const existingUser = await db.getUserByEmail(email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      email: email.toLowerCase(),
      password: hashedPassword,
      role: role,
      name: name,
      createdAt: new Date().toISOString(),
      isActive: true
    };

    const createdUser = await db.addUser(newUser);

    console.log('✅ New user created:', email);

    res.json({
      success: true,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        role: createdUser.role,
        name: createdUser.name,
        createdAt: createdUser.createdAt
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get all users (admin only)
app.get('/api/auth/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const sanitizedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      createdAt: user.createdAt,
      isActive: user.isActive
    }));

    res.json({
      success: true,
      users: sanitizedUsers
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Toggle user active status (admin only)
app.put('/api/auth/users/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await db.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate admin users'
      });
    }

    await db.updateUser(userId, { isActive: !user.isActive });
    const updatedUser = await db.getUserById(userId);

    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        name: updatedUser.name,
        isActive: updatedUser.isActive
      }
    });
  } catch (error) {
    console.error('Toggle user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Briefing configuration routes
app.get('/api/briefing', authenticateToken, (req, res) => {
  res.json(briefingConfig);
});

app.put('/api/briefing', authenticateToken, requireAdmin, (req, res) => {
  briefingConfig = { ...briefingConfig, ...req.body };
  res.json(briefingConfig);
});

// Document routes
app.get('/api/documents', authenticateToken, async (req, res) => {
  try {
    const documents = await db.getAllDocuments();
    res.json(documents);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Upload documents (V2 with S3) - Fixed Version
app.post('/api/documents/upload', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const clientId = 'demo-company';
    
    // Ensure S3 bucket exists
    await s3Service.createClientBucket(clientId);
    
    // Use basic multer for memory storage
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
          cb(new Error('File type not allowed'), false);
        }
      }
    });
    
    upload.array('documents', 10)(req, res, async (uploadErr) => {
      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        return res.status(400).json({
          success: false,
          error: uploadErr.message
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded'
        });
      }

      const results = [];

      for (const file of req.files) {
        try {
          // Manual S3 upload WITHOUT metadata
          const s3Result = await s3Service.uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            clientId
            // NO metadata object - this was causing the error
          );
          
          const document = {
            id: s3Result.documentId,
            originalName: file.originalname,
            filename: file.originalname,
            s3Key: s3Result.s3Key,
            s3Bucket: s3Result.s3Bucket,
            etag: s3Result.etag,
            mimetype: file.mimetype,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.userId,
            clientId: clientId,
            status: 'processing',
            analysis: null,
            tags: [],
            error: null
          };

          await db.addDocument(document);
          results.push(document);

          // Track upload analytics
          const uploadInteraction = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            userId: req.user.userId,
            documentId: document.id,
            documentName: document.originalName,
            action: 'upload',
            timestamp: new Date().toISOString()
          };
          await db.addAnalyticsDocument(uploadInteraction);

          // Process document asynchronously
          processDocumentFromS3(document.id).catch(error => {
            console.error(`❌ Error processing document ${document.id}:`, error);
            db.updateDocument(document.id, {
              status: 'error',
              error: error.message
            });
          });

        } catch (fileError) {
          console.error(`❌ Failed to upload ${file.originalname}:`, fileError);
        }
      }

      console.log(`✅ ${results.length} documents uploaded to S3 successfully`);

      res.json({
        success: true,
        documents: results,
        message: `${results.length} documents uploaded successfully to S3`
      });
    });
    
  } catch (error) {
    console.error('Upload setup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Download document (V2 with S3 pre-signed URLs)
app.get('/api/documents/:id/download', authenticateToken, async (req, res) => {
  try {
    const document = await db.getDocumentById(req.params.id);
    
    console.log(`🔍 S3 Download requested for document:`, {
      id: req.params.id,
      found: !!document,
      name: document?.originalName,
      s3Key: document?.s3Key,
      s3Bucket: document?.s3Bucket,
      status: document?.status
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Check if document has S3 info
    if (!document.s3Key || !document.s3Bucket) {
      return res.status(404).json({
        success: false,
        error: 'Document file not available for download (no S3 info)'
      });
    }

    // Track download analytics
    const downloadInteraction = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      userId: req.user.userId,
      documentId: document.id,
      documentName: document.originalName,
      action: 'download',
      timestamp: new Date().toISOString()
    };
    await db.addAnalyticsDocument(downloadInteraction);

    // Generate S3 pre-signed URL
    const downloadUrl = await s3Service.generateDownloadUrl(
      document.s3Key,
      document.s3Bucket,
      document.originalName,
      3600 // 1 hour expiry
    );

    console.log(`✅ Generated S3 pre-signed download URL for: ${document.originalName}`);

    // Return the download URL to the client
    res.json({
      success: true,
      downloadUrl: downloadUrl,
      fileName: document.originalName,
      fileSize: document.size,
      contentType: document.mimetype,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      method: 's3-presigned',
      message: 'Download URL generated successfully'
    });

  } catch (error) {
    console.error('S3 Download URL generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete document (V2 with S3)
app.delete('/api/documents/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const documentId = req.params.id;
    console.log(`🗑️ Delete request for document ${documentId}`);
    
    const document = await db.getDocumentById(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Delete from S3 if it exists
    if (document.s3Key && document.s3Bucket) {
      try {
        await s3Service.deleteFile(document.s3Key, document.s3Bucket);
        console.log(`✅ File deleted from S3: ${document.s3Key}`);
      } catch (s3Error) {
        console.log(`❌ S3 deletion failed:`, s3Error);
      }
    }

    // Delete analytics records
    try {
      await db.deleteDocumentAnalytics(documentId);
    } catch (analyticsError) {
      console.log(`❌ Analytics deletion failed:`, analyticsError);
    }

    // Delete the database record
    await db.deleteDocument(documentId);
    
    res.json({
      success: true,
      message: 'Document deleted successfully',
      deletedDocument: {
        id: document.id,
        originalName: document.originalName
      }
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update document tags (admin only)
app.put('/api/documents/:id/tags', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const documentId = req.params.id;
    const { tags } = req.body;
    
    if (!Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: 'Tags must be an array'
      });
    }
    
    const document = await db.getDocumentById(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    await db.updateDocument(documentId, { tags });
    const updatedDocument = await db.getDocumentById(documentId);
    
    console.log(`✅ Document ${documentId} tags updated by admin ${req.user.userId}`);
    
    res.json({
      success: true,
      document: updatedDocument
    });

  } catch (error) {
    console.error('Update tags error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get document analysis
app.get('/api/documents/:id/analysis', authenticateToken, async (req, res) => {
  try {
    const document = await db.getDocumentById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    if (document.status !== 'completed') {
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
    console.error('Analysis retrieval error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ask question about documents
app.post('/api/ask', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Question is required'
      });
    }

    const startTime = Date.now();

    // Get all completed documents from database
    const allDocuments = await db.getAllDocuments();
    const completedDocs = allDocuments.filter(d => d.status === 'completed');
        
    if (completedDocs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No analyzed documents available. Please upload and process documents first.'
      });
    }

    // Get all available tags
    const allTags = [...new Set(completedDocs.flatMap(doc => doc.tags || []))];
    
    // Classify the question
    console.log(`🔍 Classifying question: "${question}"`);
    const questionTags = await classifyQuestion(question, allTags);
    console.log(`🏷️ Question classified as: ${questionTags.join(', ')}`);
    
    // Find relevant documents based on tags
    const relevantDocs = completedDocs.filter(doc => 
      doc.tags && doc.tags.some(tag => questionTags.includes(tag))
    );
    
    // Fallback: if no tagged matches, use most recent 3 documents
    const contextDocs = relevantDocs.length > 0 ? relevantDocs : completedDocs.slice(-3);
    
    console.log(`📄 Using ${contextDocs.length} relevant documents: ${contextDocs.map(d => d.originalName).join(', ')}`);

    // Prepare context from only relevant documents
    const contextData = contextDocs
      .map(doc => `DOCUMENT [${doc.tags?.join(', ') || 'UNTAGGED'}]: ${doc.originalName}\n${doc.analysis}`)
      .join('\n\n' + '='.repeat(50) + '\n\n');

    // Create comprehensive prompt
    const prompt = `${briefingConfig.instructions}

COMPANY CONTEXT:
Name: ${briefingConfig.companyName || 'Not specified'}
Industry: ${briefingConfig.industry || 'Not specified'}
Funding Stage: ${briefingConfig.stage}

RELEVANT DATA ROOM DOCUMENTS (Selected based on question topic: ${questionTags.join(', ')}):
${contextData}

INVESTOR QUESTION: ${question}

Please provide a comprehensive answer based solely on the information available in the analyzed data room documents. Always cite specific documents as sources and highlight any areas where additional information might be needed.`;

    // Get answer from Claude
    const answer = await callClaude(prompt);
    
    const processingTime = Date.now() - startTime;
    const sourcesUsed = contextDocs.map(d => d.originalName);

    // Track the question analytics in database
    const questionAnalytics = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      userId: req.user.userId,
      question,
      answer: answer.substring(0, 500) + (answer.length > 500 ? '...' : ''),
      timestamp: new Date().toISOString(),
      processingTime,
      sourcesUsed,
      questionLength: question.length,
      answerLength: answer.length,
      sourceCount: sourcesUsed.length
    };

    await db.addAnalyticsQuestion(questionAnalytics);

    console.log(`✅ Question answered in ${Math.round(processingTime/1000)}s using ${contextDocs.length} documents`);

    res.json({
      success: true,
      question,
      answer,
      timestamp: new Date().toISOString(),
      questionTags,
      sourcesUsed,
      documentsConsidered: contextDocs.length,
      totalDocuments: completedDocs.length,
      processingTime
    });

  } catch (error) {
    console.error('Question processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all available tags
app.get('/api/tags', authenticateToken, async (req, res) => {
  try {
    const documents = await db.getAllDocuments();
    const completedDocs = documents.filter(d => d.status === 'completed' && d.tags);
    
    const allTags = [...new Set(completedDocs.flatMap(doc => doc.tags))];
    
    const tagCounts = allTags.map(tag => ({
      tag,
      count: completedDocs.filter(doc => doc.tags.includes(tag)).length,
      documents: completedDocs
        .filter(doc => doc.tags.includes(tag))
        .map(doc => ({ id: doc.id, name: doc.originalName }))
    }));

    res.json({
      success: true,
      tags: tagCounts,
      totalTags: allTags.length,
      totalDocuments: completedDocs.length
    });

  } catch (error) {
    console.error('Tags retrieval error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Settings routes
app.get('/api/settings/public', async (req, res) => {
  try {
    const result = await db.getAllSettings();
    const publicSettings = {};
    
    result.forEach(row => {
      const fullKey = settingsKeyMap[row.setting_key] || row.setting_key;
      if (['company_name', 'logo_url', 'app_title'].includes(fullKey)) {
        publicSettings[fullKey] = row.file_url || row.setting_value;
      }
    });
    
    res.json({ settings: publicSettings });
  } catch (error) {
    console.error('Public settings fetch error:', error);
    res.json({ 
      settings: {
        company_name: 'Data Room Analyzer',
        logo_url: null,
        app_title: 'Data Room Analyzer'
      }
    });
  }
});

app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const rows = await db.getAllSettings();
    const settings = {};
    
    rows.forEach(row => {
      const fullKey = settingsKeyMap[row.setting_key] || row.setting_key;
      settings[fullKey] = row.file_url || row.setting_value;
    });
    
    res.json({ settings });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/settings', authenticateToken, requireAdmin, async (req, res) => {
  const { settings } = req.body;
  
  try {
    for (const [fullKey, value] of Object.entries(settings)) {
      const dbKey = reverseSettingsMap[fullKey] || fullKey;
      await db.updateSetting(dbKey, value, req.user.id);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Analytics Routes
app.get('/api/analytics/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const summary = await db.getAnalyticsSummary();
    const questionsByDay = await db.getQuestionsByDay(7);
    const mostActiveUsers = await db.getMostActiveUsers(10);
    const popularDocuments = await db.getPopularDocuments(10);
    const allDocuments = await db.getAllDocuments();

    res.json({
      success: true,
      analytics: {
        summary: {
          totalQuestions: summary.totalQuestions,
          totalUsers: summary.totalUsers,
          totalSessions: summary.totalSessions,
          recentQuestions: summary.recentQuestions,
          recentSessions: summary.recentSessions,
          topQuestions: summary.topQuestions,
          activeUsers: summary.activeUsers
        },
        recentActivity: {
          questionsLast7Days: summary.recentQuestions,
          sessionsLast7Days: summary.recentSessions,
          questionsByDay: questionsByDay
        },
        userEngagement: {
          mostActiveUsers: mostActiveUsers,
          totalActiveUsers: summary.activeUsers.length
        },
        documentInsights: {
          popularDocuments: popularDocuments,
          totalDocuments: allDocuments.length,
          analyzedDocuments: allDocuments.filter(d => d.status === 'completed').length
        }
      }
    });
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/analytics/questions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, userId, dateFrom, dateTo } = req.query;
    
    const result = await db.getQuestionsWithPagination(
      parseInt(page), 
      parseInt(limit), 
      userId ? parseInt(userId) : null, 
      dateFrom, 
      dateTo
    );

    res.json({
      success: true,
      questions: result.questions,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Analytics questions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/analytics/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const result = await db.getSessionsWithPagination(parseInt(page), parseInt(limit));

    res.json({
      success: true,
      sessions: result.sessions,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Analytics sessions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/analytics/documents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { documentId, action } = req.query;
    
    const interactions = await db.getDocumentInteractions(documentId, action);

    res.json({
      success: true,
      interactions: interactions
    });
  } catch (error) {
    console.error('Analytics documents error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/analytics/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { type = 'questions' } = req.query;
    
    let csvData = '';
    let filename = '';
    
    if (type === 'questions') {
      const result = await db.getQuestionsWithPagination(1, 10000);
      csvData = 'Timestamp,User Name,User Email,Question,Answer Length,Sources Used,Processing Time\n';
      result.questions.forEach(q => {
        const sourcesUsed = Array.isArray(q.sourcesUsed) ? q.sourcesUsed.join('; ') : '';
        csvData += `"${q.timestamp}","${q.userName}","${q.userEmail}","${q.question.replace(/"/g, '""')}",${q.answerLength || 0},"${sourcesUsed}",${q.processingTime || 'N/A'}\n`;
      });
      filename = 'questions-analytics.csv';
    } else if (type === 'sessions') {
      const result = await db.getSessionsWithPagination(1, 10000);
      csvData = 'Login Time,User Name,User Email,User Agent,IP Address\n';
      result.sessions.forEach(s => {
        csvData += `"${s.loginTime}","${s.userName}","${s.email}","${s.userAgent || ''}","${s.ipAddress || ''}"\n`;
      });
      filename = 'sessions-analytics.csv';
    } else if (type === 'documents') {
      const interactions = await db.getDocumentInteractions();
      csvData = 'Timestamp,User Name,User Email,Document Name,Action\n';
      interactions.forEach(d => {
        csvData += `"${d.timestamp}","${d.userName}","${d.userEmail}","${d.documentName}","${d.action}"\n`;
      });
      filename = 'documents-analytics.csv';
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvData);
  } catch (error) {
    console.error('Analytics export error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// S3 Service health check
app.get('/api/s3/health', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await s3Service.s3.listBuckets().promise();
    res.json({
      success: true,
      s3Status: { status: 'healthy', timestamp: new Date().toISOString() }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  
  if (error.message && error.message.includes('MulterError')) {
    return res.status(400).json({
      success: false,
      error: 'File upload error: ' + error.message
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Startup sequence
const startServer = async () => {
  try {
    // Initialize database
    await db.init();
    
    // Create admin user
    await createDefaultAdmin();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Data Room V2 API Server running on port ${PORT}`);
      console.log(`🔐 Authentication enabled`);
      console.log(`💾 Database ready and initialized`);
      console.log(`☁️ S3 service ready for uploads`);
      console.log(`👤 Default admin: admin@dataroom.com / admin123`);
      console.log(`📁 Upload endpoint: /api/documents/upload (S3)`);
      console.log(`⬇️ Download endpoint: /api/documents/:id/download (Pre-signed URLs)`);
      console.log(`❓ Ask endpoint: /api/ask`);
      console.log(`🏥 Health check: /api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  db.close();
  process.exit(0);
});

// Quick S3 test endpoint
app.get('/api/test/s3', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🧪 Testing S3 connection...');
    
    // Test 1: List buckets (verify credentials)
    const buckets = await s3Service.s3.listBuckets().promise();
    console.log('✅ S3 credentials valid');
    
    // Test 2: Ensure demo bucket exists
    const bucketName = s3Service.getBucketName('demo-company');
    await s3Service.createClientBucket('demo-company');
    console.log('✅ Demo bucket ready');
    
    res.json({
      success: true,
      message: 'S3 connection successful',
      aws: {
        region: process.env.AWS_REGION,
        bucketsAccessible: buckets.Buckets.length,
        demoBucket: bucketName
      }
    });
    
  } catch (error) {
    console.error('❌ S3 test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Check AWS credentials in Railway environment variables'
    });
  }
});

startServer();

module.exports = app;
