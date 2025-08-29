const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database-pool');

// Test configuration
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Multi-Tenant Isolation Tests', () => {
    let app;
    let tenant1, tenant2, superadmin, admin1, admin2, user1, user2;
    let token1, token2, superadminToken;

    beforeAll(async () => {
        // Import server after environment is set up
        app = require('../server-final');
        
        // Create test tenants and users
        await setupTestData();
    });

    afterAll(async () => {
        // Clean up test data
        await cleanupTestData();
        await pool.end();
    });

    const setupTestData = async () => {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Create test tenants
            const tenant1Result = await client.query(`
                INSERT INTO tenants (name, slug, subscription_tier, aws_bucket_name)
                VALUES ('Test Company 1', 'test-company-1', 'professional', 'test-bucket-1')
                RETURNING *
            `);
            tenant1 = tenant1Result.rows[0];

            const tenant2Result = await client.query(`
                INSERT INTO tenants (name, slug, subscription_tier, aws_bucket_name)
                VALUES ('Test Company 2', 'test-company-2', 'starter', 'test-bucket-2')
                RETURNING *
            `);
            tenant2 = tenant2Result.rows[0];

            // Create superadmin
            const superadminPassword = await bcrypt.hash('superadmin123', 10);
            const superadminResult = await client.query(`
                INSERT INTO users (email, password, name, global_role, is_active)
                VALUES ('superadmin@test.com', $1, 'Super Admin', 'superadmin', true)
                RETURNING *
            `, [superadminPassword]);
            superadmin = superadminResult.rows[0];

            // Create tenant admins
            const admin1Password = await bcrypt.hash('admin123', 10);
            const admin1Result = await client.query(`
                INSERT INTO users (email, password, name, tenant_id, tenant_role, is_active)
                VALUES ('admin1@test.com', $1, 'Admin 1', $2, 'admin', true)
                RETURNING *
            `, [admin1Password, tenant1.id]);
            admin1 = admin1Result.rows[0];

            const admin2Password = await bcrypt.hash('admin123', 10);
            const admin2Result = await client.query(`
                INSERT INTO users (email, password, name, tenant_id, tenant_role, is_active)
                VALUES ('admin2@test.com', $1, 'Admin 2', $2, 'admin', true)
                RETURNING *
            `, [admin2Password, tenant2.id]);
            admin2 = admin2Result.rows[0];

            // Create tenant users
            const user1Password = await bcrypt.hash('user123', 10);
            const user1Result = await client.query(`
                INSERT INTO users (email, password, name, tenant_id, tenant_role, is_active)
                VALUES ('user1@test.com', $1, 'User 1', $2, 'user', true)
                RETURNING *
            `, [user1Password, tenant1.id]);
            user1 = user1Result.rows[0];

            const user2Password = await bcrypt.hash('user123', 10);
            const user2Result = await client.query(`
                INSERT INTO users (email, password, name, tenant_id, tenant_role, is_active)
                VALUES ('user2@test.com', $1, 'User 2', $2, 'user', true)
                RETURNING *
            `, [user2Password, tenant2.id]);
            user2 = user2Result.rows[0];

            // Create test documents
            await client.query(`
                INSERT INTO documents (id, tenant_id, original_name, s3_key, s3_bucket, status, uploaded_by)
                VALUES 
                    ('doc1-tenant1', $1, 'Document 1 Tenant 1', 'docs/doc1.pdf', 'test-bucket-1', 'analyzed', $2),
                    ('doc2-tenant1', $1, 'Document 2 Tenant 1', 'docs/doc2.pdf', 'test-bucket-1', 'analyzed', $2),
                    ('doc1-tenant2', $3, 'Document 1 Tenant 2', 'docs/doc1.pdf', 'test-bucket-2', 'analyzed', $4),
                    ('doc2-tenant2', $3, 'Document 2 Tenant 2', 'docs/doc2.pdf', 'test-bucket-2', 'analyzed', $4)
            `, [tenant1.id, admin1.id, tenant2.id, admin2.id]);

            await client.query('COMMIT');

            // Generate tokens
            superadminToken = jwt.sign({
                id: superadmin.id,
                email: superadmin.email,
                global_role: 'superadmin'
            }, JWT_SECRET);

            token1 = jwt.sign({
                id: admin1.id,
                email: admin1.email,
                tenant_role: 'admin',
                tenant_id: tenant1.id
            }, JWT_SECRET);

            token2 = jwt.sign({
                id: admin2.id,
                email: admin2.email,
                tenant_role: 'admin',
                tenant_id: tenant2.id
            }, JWT_SECRET);

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    };

    const cleanupTestData = async () => {
        const client = await pool.connect();
        
        try {
            // Clean up in reverse order of dependencies
            await client.query('DELETE FROM analytics_documents WHERE user_id IN (SELECT id FROM users WHERE email LIKE \'%@test.com\')');
            await client.query('DELETE FROM analytics_questions WHERE user_id IN (SELECT id FROM users WHERE email LIKE \'%@test.com\')');
            await client.query('DELETE FROM analytics_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE \'%@test.com\')');
            await client.query('DELETE FROM documents WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE \'test-company-%\')');
            await client.query('DELETE FROM tenant_settings WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE \'test-company-%\')');
            await client.query('DELETE FROM users WHERE email LIKE \'%@test.com\'');
            await client.query('DELETE FROM tenants WHERE slug LIKE \'test-company-%\'');
        } catch (error) {
            console.error('Cleanup error:', error);
        } finally {
            client.release();
        }
    };

    // Test 1: Document Isolation
    describe('Document Isolation', () => {
        test('Admin can only see their tenant documents', async () => {
            const response = await request(app)
                .get('/api/documents')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(Array.isArray(response.body.documents)).toBe(true);
            
            // Should only see tenant1 documents
            const documentTenants = response.body.documents.map(d => d.tenant_id);
            expect(documentTenants.every(id => id === tenant1.id)).toBe(true);
        });

        test('Cannot access documents from other tenants', async () => {
            const response = await request(app)
                .get('/api/documents/doc1-tenant2')
                .set('Authorization', `Bearer ${token1}`)
                .expect(404);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('not found');
        });

        test('Superadmin cannot access tenant documents', async () => {
            const response = await request(app)
                .get('/api/documents')
                .set('Authorization', `Bearer ${superadminToken}`)
                .expect(400);

            expect(response.body.error).toContain('Tenant context required');
        });
    });

    // Test 2: User Management Isolation
    describe('User Management Isolation', () => {
        test('Admin can only see users in their tenant', async () => {
            const response = await request(app)
                .get('/api/auth/users')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            const userTenants = response.body.users.map(u => u.tenant_id || 'no-tenant');
            expect(userTenants.every(id => id === tenant1.id || id === 'no-tenant')).toBe(true);
        });

        test('Cannot manage users from other tenants', async () => {
            const response = await request(app)
                .put(`/api/auth/users/${user2.id}`)
                .set('Authorization', `Bearer ${token1}`)
                .send({ name: 'Hacked Name' })
                .expect(403);

            expect(response.body.error).toContain('Cannot update users from other tenants');
        });

        test('Superadmin can see all users when requested', async () => {
            const response = await request(app)
                .get('/api/auth/users?allTenants=true')
                .set('Authorization', `Bearer ${superadminToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            
            // Should include users from both tenants
            const emails = response.body.users.map(u => u.email);
            expect(emails).toContain('admin1@test.com');
            expect(emails).toContain('admin2@test.com');
        });
    });

    // Test 3: Analytics Isolation
    describe('Analytics Isolation', () => {
        beforeAll(async () => {
            // Create test analytics data
            await pool.query(`
                INSERT INTO analytics_questions (user_id, tenant_id, question, answer, processing_time)
                VALUES 
                    ($1, $2, 'Test question 1', 'Test answer 1', 1000),
                    ($3, $4, 'Test question 2', 'Test answer 2', 1500)
            `, [admin1.id, tenant1.id, admin2.id, tenant2.id]);
        });

        test('Analytics dashboard shows only tenant data', async () => {
            const response = await request(app)
                .get('/api/analytics/dashboard')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            // Should only include tenant1 data
            expect(response.body.totalQuestions).toBe('1');
        });

        test('Superadmin can access global analytics', async () => {
            const response = await request(app)
                .get('/api/analytics/global')
                .set('Authorization', `Bearer ${superadminToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.platformStats).toBeDefined();
        });
    });

    // Test 4: Authentication Tests
    describe('Authentication & Authorization', () => {
        test('Tenant login requires correct tenant context', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'admin1@test.com',
                    password: 'admin123',
                    tenantSlug: 'test-company-2' // Wrong tenant!
                })
                .expect(401);

            expect(response.body.success).toBe(false);
        });

        test('Superadmin can login without tenant context', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'superadmin@test.com',
                    password: 'superadmin123'
                })
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.user.global_role).toBe('superadmin');
        });

        test('Role hierarchy is enforced', async () => {
            const userToken = jwt.sign({
                id: user1.id,
                email: user1.email,
                tenant_role: 'user',
                tenant_id: tenant1.id
            }, JWT_SECRET);

            const response = await request(app)
                .post('/api/auth/register')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    email: 'newuser@test.com',
                    password: 'password123',
                    name: 'New User'
                })
                .expect(403);

            expect(response.body.error).toContain('Admin access required');
        });
    });

    // Test 5: API Endpoint Security
    describe('API Endpoint Security', () => {
        test('All document endpoints require authentication', async () => {
            await request(app)
                .get('/api/documents')
                .expect(401);
        });

        test('Analytics endpoints require admin role', async () => {
            const userToken = jwt.sign({
                id: user1.id,
                email: user1.email,
                tenant_role: 'user',
                tenant_id: tenant1.id
            }, JWT_SECRET);

            await request(app)
                .get('/api/analytics/dashboard')
                .set('Authorization', `Bearer ${userToken}`)
                .expect(403);
        });

        test('Superadmin endpoints reject tenant admins', async () => {
            await request(app)
                .get('/api/tenants')
                .set('Authorization', `Bearer ${token1}`)
                .expect(403);
        });
    });

    // Test 6: Data Leakage Prevention
    describe('Data Leakage Prevention', () => {
        test('Q&A only uses tenant documents', async () => {
            const response = await request(app)
                .post('/api/ask')
                .set('Authorization', `Bearer ${token1}`)
                .send({ question: 'What documents do you have access to?' })
                .expect(200);

            // Response should not mention documents from other tenants
            expect(response.body.answer).not.toContain('Document 1 Tenant 2');
            expect(response.body.answer).not.toContain('Document 2 Tenant 2');
        });

        test('Analytics export excludes other tenant data', async () => {
            const response = await request(app)
                .get('/api/analytics/export?type=questions')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            // Should only export tenant1 data
            if (response.body.data && response.body.data.questions) {
                expect(response.body.data.questions.every(q => q.tenant_id === tenant1.id)).toBe(true);
            }
        });
    });
});

describe('Superadmin Analytics Tests', () => {
    let superadminToken;

    beforeAll(async () => {
        const superadmin = await pool.query('SELECT * FROM users WHERE global_role = \'superadmin\' LIMIT 1');
        
        if (superadmin.rows.length > 0) {
            superadminToken = jwt.sign({
                id: superadmin.rows[0].id,
                email: superadmin.rows[0].email,
                global_role: 'superadmin'
            }, JWT_SECRET);
        }
    });

    test('Can access cross-tenant analytics', async () => {
        const response = await request(app)
            .get('/api/analytics/global')
            .set('Authorization', `Bearer ${superadminToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.platformStats).toBeDefined();
    });

    test('Can access tenant management', async () => {
        const response = await request(app)
            .get('/api/tenants')
            .set('Authorization', `Bearer ${superadminToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.tenants)).toBe(true);
    });

    test('Can access realtime metrics', async () => {
        const response = await request(app)
            .get('/api/superadmin/metrics/realtime')
            .set('Authorization', `Bearer ${superadminToken}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.platform).toBeDefined();
        expect(response.body.activity).toBeDefined();
    });
});

describe('Resource Limits Tests', () => {
    let limitedTenant, limitedAdmin, limitedToken;

    beforeAll(async () => {
        // Create tenant with low limits
        const tenantResult = await pool.query(`
            INSERT INTO tenants (name, slug, subscription_tier, max_users, max_documents, max_storage_gb)
            VALUES ('Limited Tenant', 'limited-tenant', 'free', 2, 5, 1)
            RETURNING *
        `);
        limitedTenant = tenantResult.rows[0];

        const adminPassword = await bcrypt.hash('admin123', 10);
        const adminResult = await pool.query(`
            INSERT INTO users (email, password, name, tenant_id, tenant_role, is_active)
            VALUES ('limited@test.com', $1, 'Limited Admin', $2, 'admin', true)
            RETURNING *
        `, [adminPassword, limitedTenant.id]);
        limitedAdmin = adminResult.rows[0];

        limitedToken = jwt.sign({
            id: limitedAdmin.id,
            email: limitedAdmin.email,
            tenant_role: 'admin',
            tenant_id: limitedTenant.id
        }, JWT_SECRET);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM users WHERE email = \'limited@test.com\'');
        await pool.query('DELETE FROM tenants WHERE slug = \'limited-tenant\'');
    });

    test('User creation respects tenant limits', async () => {
        // First user should succeed
        const response1 = await request(app)
            .post('/api/auth/register')
            .set('Authorization', `Bearer ${limitedToken}`)
            .send({
                email: 'user1@limited.com',
                password: 'password123',
                name: 'User 1'
            })
            .expect(201);

        expect(response1.body.success).toBe(true);

        // Third user should fail (limit is 2, admin + 1 user = 2)
        const response2 = await request(app)
            .post('/api/auth/register')
            .set('Authorization', `Bearer ${limitedToken}`)
            .send({
                email: 'user2@limited.com',
                password: 'password123',
                name: 'User 2'
            })
            .expect(403);

        expect(response2.body.error).toContain('User limit reached');
    });
});

describe('S3 Bucket Isolation Tests', () => {
    test('Documents use tenant-specific bucket names', async () => {
        const response = await request(app)
            .get('/api/documents')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        const documents = response.body.documents || response.body;
        if (documents.length > 0) {
            expect(documents[0].s3_bucket).toContain('test-bucket-1');
        }
    });

    test('Download URLs are tenant-scoped', async () => {
        const response = await request(app)
            .get('/api/documents/doc1-tenant1/download')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.downloadUrl).toBeDefined();
    });
});

describe('Performance Tests', () => {
    test('API response times are acceptable', async () => {
        const start = Date.now();
        
        const response = await request(app)
            .get('/api/documents')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        const responseTime = Date.now() - start;
        expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
    });

    test('Concurrent tenant requests don\'t interfere', async () => {
        const requests = [
            request(app).get('/api/documents').set('Authorization', `Bearer ${token1}`),
            request(app).get('/api/documents').set('Authorization', `Bearer ${token2}`),
            request(app).get('/api/analytics/dashboard').set('Authorization', `Bearer ${token1}`),
            request(app).get('/api/analytics/dashboard').set('Authorization', `Bearer ${token2}`)
        ];

        const responses = await Promise.all(requests);
        
        // All requests should succeed
        responses.forEach(response => {
            expect([200, 201].includes(response.status)).toBe(true);
        });
    });
});

module.exports = {
    setupTestData,
    cleanupTestData
};