const express = require('express');
const router = express.Router();
const pool = require('../database');
const { authenticateToken } = require('../middleware/auth-middleware');
const tenantMiddleware = require('../middleware/tenant-middleware');
const Tenant = require('../models/tenant');
const { ClaudeRateLimiter, createClaudeApiWithRateLimit } = require('../services/claude-rate-limiter');

// Initialize Claude service
const claudeApi = createClaudeApiWithRateLimit();

// Ask question about documents
router.post('/ask',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.logActivity('QUESTION_ASKED', 'question'),
    async (req, res) => {
        try {
            const { question, documentIds = [], includeAllDocuments = false } = req.body;
            
            if (!question || question.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Question is required'
                });
            }

            // Get tenant settings for context
            const settingsQuery = 'SELECT * FROM tenant_settings WHERE tenant_id = $1';
            const settingsResult = await pool.query(settingsQuery, [req.tenantId]);
            const settings = settingsResult.rows[0] || {};

            // Get relevant documents
            let documentsQuery;
            let documentsParams;
            
            if (documentIds.length > 0) {
                // Specific documents requested
                documentsQuery = `
                    SELECT id, original_name, analysis, status
                    FROM documents 
                    WHERE tenant_id = $1 
                    AND id = ANY($2)
                    AND status = 'analyzed'
                `;
                documentsParams = [req.tenantId, documentIds];
            } else if (includeAllDocuments) {
                // All analyzed documents
                documentsQuery = `
                    SELECT id, original_name, analysis, status
                    FROM documents 
                    WHERE tenant_id = $1 
                    AND status = 'analyzed'
                    ORDER BY uploaded_at DESC
                    LIMIT 50
                `;
                documentsParams = [req.tenantId];
            } else {
                // Smart document selection based on question relevance
                documentsQuery = `
                    SELECT id, original_name, analysis, status
                    FROM documents 
                    WHERE tenant_id = $1 
                    AND status = 'analyzed'
                    AND (
                        original_name ILIKE $2
                        OR analysis::text ILIKE $2
                    )
                    ORDER BY uploaded_at DESC
                    LIMIT 20
                `;
                documentsParams = [req.tenantId, `%${question.split(' ')[0]}%`];
            }

            const documentsResult = await pool.query(documentsQuery, documentsParams);
            const documents = documentsResult.rows;

            if (documents.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No analyzed documents found. Please upload and analyze documents first.'
                });
            }

            // Build context from documents
            const documentContext = documents.map(doc => ({
                name: doc.original_name,
                id: doc.id,
                content: doc.analysis ? 
                    (typeof doc.analysis === 'string' ? doc.analysis : JSON.stringify(doc.analysis)) 
                    : 'No analysis available'
            }));

            // Prepare Claude prompt with tenant context
            const systemPrompt = `You are an AI assistant helping users understand documents from ${settings.company_name || req.tenant.name}.
            
            IMPORTANT INSTRUCTIONS:
            - Answer based ONLY on the provided document content
            - Be specific and cite which documents you're referencing
            - If the information isn't in the documents, say so clearly
            - Keep responses concise and professional
            - Respond in the same language as the question
            
            Company Context: ${settings.company_name || req.tenant.name}
            `;

            const userPrompt = `Based on the following documents, please answer this question: "${question}"
            
            Documents:
            ${documentContext.map((doc, i) => `
            Document ${i + 1}: ${doc.name}
            Content: ${doc.content.substring(0, 2000)}...
            `).join('\n\n')}
            `;

            // Track start time for analytics
            const startTime = Date.now();

            // Call Claude API
            const response = await claudeApi.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                temperature: 0.3,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userPrompt
                    }
                ]
            });

            const answer = response.content[0].text;
            const processingTime = Date.now() - startTime;

            // Identify which documents were used in the answer
            const sourcesUsed = documents
                .filter(doc => answer.toLowerCase().includes(doc.original_name.toLowerCase()))
                .map(doc => ({
                    id: doc.id,
                    name: doc.original_name
                }));

            // Log the question and answer
            const logQuery = `
                INSERT INTO analytics_questions (
                    user_id, tenant_id, question, answer, 
                    processing_time, sources_used, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                RETURNING id
            `;
            
            const logResult = await pool.query(logQuery, [
                req.user.id,
                req.tenantId,
                question,
                answer,
                processingTime,
                JSON.stringify(sourcesUsed)
            ]);

            // Update usage tracking
            await Tenant.updateUsageTracking(req.tenantId);

            res.json({
                success: true,
                answer,
                sources: sourcesUsed,
                processingTime,
                questionId: logResult.rows[0].id,
                documentsAnalyzed: documents.length
            });

        } catch (error) {
            console.error('Q&A error:', error);
            
            // Check for rate limiting
            if (error.message && error.message.includes('rate')) {
                return res.status(429).json({
                    success: false,
                    error: 'Rate limit exceeded. Please try again in a moment.'
                });
            }

            res.status(500).json({
                success: false,
                error: 'Failed to process question. Please try again.'
            });
        }
    }
);

// Get question history for current user
router.get('/ask/history',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            const { limit = 20, offset = 0 } = req.query;
            
            const query = `
                SELECT 
                    id,
                    question,
                    answer,
                    sources_used,
                    processing_time,
                    created_at
                FROM analytics_questions
                WHERE user_id = $1 AND tenant_id = $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            `;
            
            const result = await pool.query(query, [
                req.user.id,
                req.tenantId,
                limit,
                offset
            ]);

            res.json({
                success: true,
                history: result.rows,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Get question history error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve question history'
            });
        }
    }
);

// Get suggested questions based on documents
router.get('/ask/suggestions',
    authenticateToken,
    tenantMiddleware.extractTenant,
    async (req, res) => {
        try {
            // Get recent documents
            const docsQuery = `
                SELECT original_name, tags
                FROM documents
                WHERE tenant_id = $1 AND status = 'analyzed'
                ORDER BY uploaded_at DESC
                LIMIT 5
            `;
            const docsResult = await pool.query(docsQuery, [req.tenantId]);
            
            // Get popular questions from this tenant
            const popularQuery = `
                SELECT question, COUNT(*) as count
                FROM analytics_questions
                WHERE tenant_id = $1
                GROUP BY question
                ORDER BY count DESC
                LIMIT 5
            `;
            const popularResult = await pool.query(popularQuery, [req.tenantId]);

            // Generate suggestions based on document types and popular questions
            const suggestions = [];
            
            // Add document-specific suggestions
            docsResult.rows.forEach(doc => {
                const docName = doc.original_name.replace(/\.[^/.]+$/, '');
                suggestions.push(`What are the key points in ${docName}?`);
                suggestions.push(`Summarize the main findings from ${docName}`);
            });

            // Add popular questions
            popularResult.rows.forEach(q => {
                if (!suggestions.includes(q.question)) {
                    suggestions.push(q.question);
                }
            });

            // Add generic suggestions if needed
            const genericSuggestions = [
                'What is the overall summary of all documents?',
                'What are the main risks identified?',
                'What are the key financial metrics?',
                'What is the company\'s growth strategy?',
                'Who are the main stakeholders?'
            ];

            genericSuggestions.forEach(suggestion => {
                if (suggestions.length < 10 && !suggestions.includes(suggestion)) {
                    suggestions.push(suggestion);
                }
            });

            res.json({
                success: true,
                suggestions: suggestions.slice(0, 10)
            });
        } catch (error) {
            console.error('Get suggestions error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate suggestions'
            });
        }
    }
);

// Analyze document with Claude
router.post('/documents/:id/analyze',
    authenticateToken,
    tenantMiddleware.extractTenant,
    tenantMiddleware.requireTenantAdmin,
    async (req, res) => {
        try {
            const documentId = req.params.id;
            
            // Get document
            const docQuery = `
                SELECT * FROM documents 
                WHERE id = $1 AND tenant_id = $2
            `;
            const docResult = await pool.query(docQuery, [documentId, req.tenantId]);
            
            if (docResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }
            
            const document = docResult.rows[0];
            
            // Update status to processing
            await pool.query(
                'UPDATE documents SET status = $1 WHERE id = $2',
                ['processing', documentId]
            );

            // Get document content from S3
            const S3Service = require('../services/s3-service');
            const s3Service = new S3Service();
            
            // For now, we'll use the document metadata
            // In production, you'd download and extract text from the actual file
            const documentContent = `Document: ${document.original_name}
            Type: ${document.mime_type}
            Size: ${document.file_size} bytes
            Uploaded: ${document.uploaded_at}`;

            // Analyze with Claude
            const systemPrompt = `You are analyzing a document for a data room. 
            Extract and summarize the following:
            1. Document type and purpose
            2. Key information and data points
            3. Important dates and deadlines
            4. Main parties or stakeholders mentioned
            5. Critical numbers, metrics, or financial data
            6. Any risks or concerns noted
            7. Action items or next steps
            
            Be concise but thorough. Structure your response in JSON format.`;

            const response = await claudeApi.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                temperature: 0.3,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: `Please analyze this document:\n\n${documentContent}`
                    }
                ]
            });

            const analysis = response.content[0].text;

            // Update document with analysis
            await pool.query(
                'UPDATE documents SET status = $1, analysis = $2 WHERE id = $3',
                ['analyzed', analysis, documentId]
            );

            res.json({
                success: true,
                documentId,
                analysis,
                message: 'Document analyzed successfully'
            });

        } catch (error) {
            console.error('Document analysis error:', error);
            
            // Update document status to error
            await pool.query(
                'UPDATE documents SET status = $1, error = $2 WHERE id = $3',
                ['error', error.message, req.params.id]
            );

            res.status(500).json({
                success: false,
                error: 'Failed to analyze document'
            });
        }
    }
);

module.exports = router;