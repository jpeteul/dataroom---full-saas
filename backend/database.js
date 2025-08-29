// Updated database.js for Railway's internal networking
const { Pool } = require('pg');

class Database {
  constructor() {
    // Railway's new internal networking approach
    let connectionConfig;
    
    if (process.env.DATABASE_URL) {
      // If DATABASE_URL is provided, use it
      connectionConfig = {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      };
    } else {
      // Use Railway's internal networking
      connectionConfig = {
        host: process.env.PGHOST || 'postgres.railway.internal',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'railway',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      };
    }
    
    console.log('🔗 Connecting to database with config:', {
      host: connectionConfig.host || 'from connection string',
      port: connectionConfig.port || 'from connection string',
      database: connectionConfig.database || 'from connection string',
      user: connectionConfig.user || 'from connection string'
    });
    
    this.pool = new Pool(connectionConfig);
  }

  async init() {
    try {
      // Test the connection first
      const client = await this.pool.connect();
      console.log('✅ Successfully connected to PostgreSQL');
      client.release();
      
      // Create tables if they don't exist
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          original_name TEXT NOT NULL,
          filename TEXT NOT NULL,
          mimetype TEXT NOT NULL,
          size INTEGER NOT NULL,
          uploaded_at TIMESTAMP NOT NULL,
          uploaded_by INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'processing',
          analysis TEXT,
          error TEXT,
          tags JSONB,
          analysis_file TEXT,
          cloudinary_url TEXT,
          cloudinary_public_id TEXT
        )
      `);
// Add S3 columns to documents table (V2 migration)
await this.pool.query(`
  ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS s3_key TEXT,
  ADD COLUMN IF NOT EXISTS s3_bucket TEXT,
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT 'demo-company'
`);
      
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'investor',
          name TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL,
          is_active BOOLEAN DEFAULT true
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS analytics_questions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          question TEXT NOT NULL,
          answer TEXT,
          timestamp TIMESTAMP NOT NULL,
          processing_time INTEGER,
          sources_used JSONB,
          question_length INTEGER,
          answer_length INTEGER,
          source_count INTEGER,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS analytics_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          login_time TIMESTAMP NOT NULL,
          user_agent TEXT,
          ip_address TEXT,
          last_activity TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS analytics_documents (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          document_id TEXT NOT NULL,
          document_name TEXT NOT NULL,
          action TEXT NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id),
          FOREIGN KEY (document_id) REFERENCES documents (id)
        )
      `);

      // 🆕 CREATE THE MISSING APP_SETTINGS TABLE
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key TEXT PRIMARY KEY,
          setting_value TEXT,
          file_url TEXT,
          updated_by INTEGER,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (updated_by) REFERENCES users (id)
        )
      `);

      // 🆕 INSERT DEFAULT SETTINGS IF THEY DON'T EXIST
      await this.pool.query(`
        INSERT INTO app_settings (setting_key, setting_value) 
        VALUES 
          ('n', 'Data Room Analyzer'),
          ('l', NULL),
          ('c', '#2563eb'),
          ('t', 'Data Room Analyzer')
        ON CONFLICT (setting_key) DO NOTHING
      `);

      console.log('💾 PostgreSQL database initialized');
      console.log('⚙️ Settings table created and initialized');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      console.log('Environment variables available:');
      console.log('PGHOST:', process.env.PGHOST);
      console.log('PGPORT:', process.env.PGPORT);
      console.log('PGDATABASE:', process.env.PGDATABASE);
      console.log('PGUSER:', process.env.PGUSER);
      console.log('PGPASSWORD:', process.env.PGPASSWORD ? '[SET]' : '[NOT SET]');
      console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');
      throw error;
    }
  }

  // Document methods

async deleteDocumentAnalytics(documentId) {
  try {
    const deleteQuery = `
      DELETE FROM analytics_documents 
      WHERE document_id = $1
    `;
    const result = await this.pool.query(deleteQuery, [documentId]);
    console.log(`✅ Deleted ${result.rowCount} analytics records for document ${documentId}`);
    return result.rowCount;
  } catch (error) {
    console.error('Error deleting document analytics:', error);
    throw error;
  }
}
  
  async addDocument(doc) {
  try {
    const query = `
      INSERT INTO documents (
        id, original_name, filename, s3_key, s3_bucket, etag,
        mimetype, size, uploaded_at, uploaded_by, client_id,
        status, analysis, error, tags, analysis_file
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;
    
    const values = [
      doc.id, 
      doc.originalName, 
      doc.filename || doc.originalName,
      doc.s3Key || null,
      doc.s3Bucket || null, 
      doc.etag || null,
      doc.mimetype, 
      doc.size,
      doc.uploadedAt, 
      doc.uploadedBy,
      doc.clientId || 'demo-company', 
      doc.status || 'processing', 
      doc.analysis || null, 
      doc.error || null,
      JSON.stringify(doc.tags || []), 
      doc.analysisFile || null
    ];
    
    console.log(`🔍 DEBUG: Inserting document with S3 info:`, {
      id: doc.id,
      s3Key: doc.s3Key,
      s3Bucket: doc.s3Bucket
    });
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Add document error:', error);
    throw error;
  }
}

  async updateDocument(id, updates) {
  try {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    // 🔥 FIELD MAPPING: camelCase to snake_case
    const fieldMap = {
      'status': 'status',
      'analysis': 'analysis', 
      'error': 'error',
      'tags': 'tags',
      'analysisFile': 'analysis_file',
      'cloudinaryUrl': 'cloudinary_url',
      'cloudinaryPublicId': 'cloudinary_public_id'
    };

    Object.keys(updates).forEach(field => {
      if (fieldMap[field]) {
        const dbField = fieldMap[field];
        
        if (field === 'tags') {
          setClauses.push(`${dbField} = $${paramIndex}`);
          // 🔥 FIX: Ensure tags are properly JSON stringified
          const tagsValue = Array.isArray(updates[field]) ? 
            JSON.stringify(updates[field]) : 
            JSON.stringify([updates[field]]);
          values.push(tagsValue);
          console.log(`🔍 DEBUG: Tags being saved: ${tagsValue}`);
        } else {
          setClauses.push(`${dbField} = $${paramIndex}`);
          values.push(updates[field]);
        }
        paramIndex++;
      }
    });

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);
    
    const query = `
      UPDATE documents 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    console.log(`🔍 DEBUG: SQL Query: ${query}`);
    console.log(`🔍 DEBUG: SQL Values: ${JSON.stringify(values)}`);

    const result = await this.pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Document not found');
    }

    const doc = result.rows[0];
    
    // 🔥 RETURN with camelCase field names and proper tags parsing
    return {
      id: doc.id,
      originalName: doc.original_name,
      filename: doc.filename,
      mimetype: doc.mimetype,
      size: doc.size,
      uploadedAt: doc.uploaded_at,
      uploadedBy: doc.uploaded_by,
      status: doc.status,
      analysis: doc.analysis,
      error: doc.error,
      tags: doc.tags ? (typeof doc.tags === 'string' ? JSON.parse(doc.tags) : doc.tags) : [],
      analysisFile: doc.analysis_file,
      cloudinaryUrl: doc.cloudinary_url,
      cloudinaryPublicId: doc.cloudinary_public_id
    };
  } catch (error) {
    console.error('Error updating document:', error);
    throw error;
  }
}


  async getAllDocuments() {
    try {
      const result = await this.pool.query('SELECT * FROM documents ORDER BY uploaded_at DESC');
      
      // Convert snake_case back to camelCase and parse JSON fields
      return result.rows.map(doc => ({
        id: doc.id,
        originalName: doc.original_name,
        filename: doc.filename,
        mimetype: doc.mimetype,
        size: doc.size,
        uploadedAt: doc.uploaded_at,
        uploadedBy: doc.uploaded_by,
        status: doc.status,
        analysis: doc.analysis,
        error: doc.error,
        tags: doc.tags || [],
        analysisFile: doc.analysis_file,
        cloudinaryUrl: doc.cloudinary_url,
        cloudinaryPublicId: doc.cloudinary_public_id
      }));
    } catch (error) {
      console.error('❌ Get documents error:', error);
      throw error;
    }
  }

  async getDocumentById(id) {
  try {
    const result = await this.pool.query('SELECT * FROM documents WHERE id = $1', [id]);
    
    if (result.rows.length === 0) return null;
    
    const doc = result.rows[0];
    return {
      id: doc.id,
      originalName: doc.original_name,
      filename: doc.filename,
      s3Key: doc.s3_key,
      s3Bucket: doc.s3_bucket,
      etag: doc.etag,
      clientId: doc.client_id,
      mimetype: doc.mimetype,
      size: doc.size,
      uploadedAt: doc.uploaded_at,
      uploadedBy: doc.uploaded_by,
      status: doc.status,
      analysis: doc.analysis,
      error: doc.error,
      tags: doc.tags || [],
      analysisFile: doc.analysis_file,
      cloudinaryUrl: doc.cloudinary_url,
      cloudinaryPublicId: doc.cloudinary_public_id
    };
  } catch (error) {
    console.error('❌ Get document error:', error);
    throw error;
  }
}

  // User methods
  async addUser(user) {
    try {
      const query = `
        INSERT INTO users (email, password, role, name, created_at, is_active) 
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const values = [
        user.email, user.password, user.role, user.name, 
        user.createdAt, user.isActive
      ];
      
      const result = await this.pool.query(query, values);
      const newUser = result.rows[0];
      
      return {
        id: newUser.id,
        email: newUser.email,
        password: newUser.password,
        role: newUser.role,
        name: newUser.name,
        createdAt: newUser.created_at,
        isActive: newUser.is_active
      };
    } catch (error) {
      console.error('❌ Add user error:', error);
      throw error;
    }
  }

  async getAllUsers() {
    try {
      const result = await this.pool.query('SELECT * FROM users ORDER BY created_at DESC');
      
      return result.rows.map(user => ({
        id: user.id,
        email: user.email,
        password: user.password,
        role: user.role,
        name: user.name,
        createdAt: user.created_at,
        isActive: user.is_active
      }));
    } catch (error) {
      console.error('❌ Get users error:', error);
      throw error;
    }
  }

  async getUserByEmail(email) {
    try {
      const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
      
      if (result.rows.length === 0) return null;
      
      const user = result.rows[0];
      return {
        id: user.id,
        email: user.email,
        password: user.password,
        role: user.role,
        name: user.name,
        createdAt: user.created_at,
        isActive: user.is_active
      };
    } catch (error) {
      console.error('❌ Get user by email error:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
      
      if (result.rows.length === 0) return null;
      
      const user = result.rows[0];
      return {
        id: user.id,
        email: user.email,
        password: user.password,
        role: user.role,
        name: user.name,
        createdAt: user.created_at,
        isActive: user.is_active
      };
    } catch (error) {
      console.error('❌ Get user by ID error:', error);
      throw error;
    }
  }

  async updateUser(id, updates) {
    try {
      const fields = [];
      const values = [];
      let paramIndex = 1;
      
      Object.keys(updates).forEach(key => {
        const dbKey = key === 'isActive' ? 'is_active' : key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbKey} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      });
      
      values.push(id);
      
      const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
      
      const result = await this.pool.query(query, values);
      return result.rowCount;
    } catch (error) {
      console.error('❌ Update user error:', error);
      throw error;
    }
  }

  // Analytics methods

  // Analytics Query Methods
async getAnalyticsSummary() {
  try {
    // Get total counts
    const totalQuestions = await this.pool.query('SELECT COUNT(*) FROM analytics_questions');
    const totalSessions = await this.pool.query('SELECT COUNT(*) FROM analytics_sessions');
    const totalUsers = await this.pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['investor']);
    
    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentQuestions = await this.pool.query(
      'SELECT COUNT(*) FROM analytics_questions WHERE timestamp > $1', 
      [thirtyDaysAgo]
    );
    const recentSessions = await this.pool.query(
      'SELECT COUNT(*) FROM analytics_sessions WHERE login_time > $1', 
      [thirtyDaysAgo]
    );

    // Get top questions (group by similar questions)
    const topQuestionsQuery = `
      SELECT 
        LEFT(question, 50) as question_preview,
        COUNT(*) as count
      FROM analytics_questions 
      GROUP BY LEFT(question, 50)
      ORDER BY count DESC 
      LIMIT 10
    `;
    const topQuestions = await this.pool.query(topQuestionsQuery);

    // Get active users (users who asked questions recently)
    const activeUsersQuery = `
      SELECT 
        u.id as user_id,
        u.name,
        u.email,
        COUNT(aq.id) as question_count
      FROM users u
      JOIN analytics_questions aq ON u.id = aq.user_id
      WHERE aq.timestamp > $1
      GROUP BY u.id, u.name, u.email
      ORDER BY question_count DESC
      LIMIT 10
    `;
    const activeUsers = await this.pool.query(activeUsersQuery, [thirtyDaysAgo]);

    return {
      totalQuestions: parseInt(totalQuestions.rows[0].count),
      totalSessions: parseInt(totalSessions.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      recentQuestions: parseInt(recentQuestions.rows[0].count),
      recentSessions: parseInt(recentSessions.rows[0].count),
      topQuestions: topQuestions.rows.map(row => ({
        question: row.question_preview,
        count: parseInt(row.count)
      })),
      activeUsers: activeUsers.rows.map(row => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        questionCount: parseInt(row.question_count)
      }))
    };
  } catch (error) {
    console.error('❌ Get analytics summary error:', error);
    throw error;
  }
}

async getQuestionsByDay(days = 7) {
  try {
    const query = `
      SELECT 
        DATE(timestamp) as day,
        COUNT(*) as count
      FROM analytics_questions 
      WHERE timestamp > NOW() - INTERVAL '${days} days'
      GROUP BY DATE(timestamp)
      ORDER BY day DESC
    `;
    
    const result = await this.pool.query(query);
    
    // Create a complete range of days with 0 counts for missing days
    const questionsByDay = {};
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      questionsByDay[dateStr] = 0;
    }
    
    // Fill in actual counts
    result.rows.forEach(row => {
      questionsByDay[row.day] = parseInt(row.count);
    });
    
    return questionsByDay;
  } catch (error) {
    console.error('❌ Get questions by day error:', error);
    throw error;
  }
}

async getMostActiveUsers(limit = 10) {
  try {
    const query = `
      SELECT 
        u.id as user_id,
        u.name,
        u.email,
        COUNT(aq.id) as question_count
      FROM users u
      LEFT JOIN analytics_questions aq ON u.id = aq.user_id
      WHERE u.role = 'investor'
      GROUP BY u.id, u.name, u.email
      ORDER BY question_count DESC
      LIMIT $1
    `;
    
    const result = await this.pool.query(query, [limit]);
    
    return result.rows.map(row => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      questionCount: parseInt(row.question_count)
    }));
  } catch (error) {
    console.error('❌ Get most active users error:', error);
    throw error;
  }
}

async getPopularDocuments(limit = 10) {
  try {
    const query = `
      SELECT 
        document_name,
        COUNT(*) as views
      FROM analytics_documents 
      GROUP BY document_name
      ORDER BY views DESC
      LIMIT $1
    `;
    
    const result = await this.pool.query(query, [limit]);
    
    return result.rows.map(row => ({
      name: row.document_name,
      views: parseInt(row.views)
    }));
  } catch (error) {
    console.error('❌ Get popular documents error:', error);
    throw error;
  }
}

async getQuestionsWithPagination(page = 1, limit = 50, userId = null, dateFrom = null, dateTo = null) {
  try {
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (userId) {
      whereConditions.push(`aq.user_id = $${paramIndex}`);
      queryParams.push(userId);
      paramIndex++;
    }

    if (dateFrom) {
      whereConditions.push(`aq.timestamp >= $${paramIndex}`);
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      whereConditions.push(`aq.timestamp <= $${paramIndex}`);
      queryParams.push(dateTo);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) 
      FROM analytics_questions aq 
      JOIN users u ON aq.user_id = u.id 
      ${whereClause}
    `;
    const totalResult = await this.pool.query(countQuery, queryParams);
    const total = parseInt(totalResult.rows[0].count);

    // Get paginated results
    const offset = (page - 1) * limit;
    queryParams.push(limit, offset);
    
    const dataQuery = `
      SELECT 
        aq.*,
        u.name as user_name,
        u.email as user_email
      FROM analytics_questions aq
      JOIN users u ON aq.user_id = u.id
      ${whereClause}
      ORDER BY aq.timestamp DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await this.pool.query(dataQuery, queryParams);

    return {
      questions: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        question: row.question,
        answer: row.answer ? row.answer.substring(0, 500) + (row.answer.length > 500 ? '...' : '') : null,
        timestamp: row.timestamp,
        processingTime: row.processing_time,
        sourcesUsed: row.sources_used || [],
        questionLength: row.question_length,
        answerLength: row.answer_length,
        sourceCount: row.source_count,
        userName: row.user_name,
        userEmail: row.user_email
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('❌ Get questions with pagination error:', error);
    throw error;
  }
}

async getSessionsWithPagination(page = 1, limit = 50) {
  try {
    // Get total count
    const countQuery = 'SELECT COUNT(*) FROM analytics_sessions';
    const totalResult = await this.pool.query(countQuery);
    const total = parseInt(totalResult.rows[0].count);

    // Get paginated results
    const offset = (page - 1) * limit;
    const dataQuery = `
      SELECT 
        s.*,
        u.name as user_name,
        u.role as user_role
      FROM analytics_sessions s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.login_time DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.pool.query(dataQuery, [limit, offset]);

    return {
      sessions: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        loginTime: row.login_time,
        userAgent: row.user_agent,
        ipAddress: row.ip_address,
        lastActivity: row.last_activity,
        userName: row.user_name,
        userRole: row.user_role
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('❌ Get sessions with pagination error:', error);
    throw error;
  }
}

async getDocumentInteractions(documentId = null, action = null) {
  try {
    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    if (documentId) {
      whereConditions.push(`ad.document_id = $${paramIndex}`);
      queryParams.push(documentId);
      paramIndex++;
    }

    if (action) {
      whereConditions.push(`ad.action = $${paramIndex}`);
      queryParams.push(action);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        ad.*,
        u.name as user_name,
        u.email as user_email
      FROM analytics_documents ad
      JOIN users u ON ad.user_id = u.id
      ${whereClause}
      ORDER BY ad.timestamp DESC
    `;

    const result = await this.pool.query(query, queryParams);

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      documentId: row.document_id,
      documentName: row.document_name,
      action: row.action,
      timestamp: row.timestamp,
      userName: row.user_name,
      userEmail: row.user_email
    }));
  } catch (error) {
    console.error('❌ Get document interactions error:', error);
    throw error;
  }
}
  async addAnalyticsQuestion(data) {
    try {
      const query = `
        INSERT INTO analytics_questions (
          id, user_id, question, answer, timestamp, processing_time, 
          sources_used, question_length, answer_length, source_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      
      const values = [
        data.id, data.userId, data.question, data.answer, data.timestamp,
        data.processingTime, JSON.stringify(data.sourcesUsed), 
        data.questionLength, data.answerLength, data.sourceCount
      ];
      
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Add analytics question error:', error);
      throw error;
    }
  }

  async addAnalyticsSession(data) {
    try {
      const query = `
        INSERT INTO analytics_sessions (
          id, user_id, email, login_time, user_agent, ip_address, last_activity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      const values = [
        data.id, data.userId, data.email, data.loginTime,
        data.userAgent, data.ipAddress, data.lastActivity
      ];
      
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Add analytics session error:', error);
      throw error;
    }
  }
// Settings methods
async getAllSettings() {
  try {
    const result = await this.pool.query('SELECT setting_key, setting_value, file_url FROM app_settings');
    return result.rows;
  } catch (error) {
    console.error('❌ Get all settings error:', error);
    throw error;
  }
}

async updateSetting(key, value, userId) {
  try {
    const query = 'UPDATE app_settings SET setting_value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $3';
    await this.pool.query(query, [value, userId, key]);
  } catch (error) {
    console.error('❌ Update setting error:', error);
    throw error;
  }
}

async updateSettingFile(key, fileUrl, userId) {
  try {
    const query = 'UPDATE app_settings SET file_url = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $3';
    await this.pool.query(query, [fileUrl, userId, key]);
  } catch (error) {
    console.error('❌ Update setting file error:', error);
    throw error;
  }
}
  
  async deleteDocumentAnalytics(documentId) {
  try {
    const result = await this.pool.query(
      'DELETE FROM analytics_documents WHERE document_id = $1', 
      [documentId]
    );
    console.log(`🗑️ Deleted ${result.rowCount} analytics records for document ${documentId}`);
    return result.rowCount;
  } catch (error) {
    console.error('❌ Delete document analytics error:', error);
    throw error;
  }
}
async deleteDocument(id) {
  try {
    // First get the document to check if file exists
    const document = await this.getDocumentById(id);
    if (!document) {
      throw new Error('Document not found');
    }

    // Delete from database
    const result = await this.pool.query('DELETE FROM documents WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      throw new Error('Document not found');
    }

    console.log(`🗑️ Document ${id} deleted from database`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Delete document error:', error);
    throw error;
  }
}
  async addAnalyticsDocument(data) {
    try {
      const query = `
        INSERT INTO analytics_documents (id, user_id, document_id, document_name, action, timestamp) 
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const values = [
        data.id, data.userId, data.documentId, data.documentName, data.action, data.timestamp
      ];
      
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Add analytics document error:', error);
      throw error;
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
