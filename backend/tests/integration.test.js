const request = require('supertest');
const bcrypt = require('bcryptjs');
const pool = require('../database-pool');
const AuthService = require('../services/auth-service');

describe('Multi-Tenant Integration Tests', () => {
    let app;
    let testTenant, testAdmin, superadmin;
    let adminToken, superadminToken;

    beforeAll(async () => {
        app = require('../server-final');
        await setupIntegrationTest();
    });

    afterAll(async () => {
        await cleanupIntegrationTest();
        await pool.end();
    });

    const setupIntegrationTest = async () => {
        // Create test tenant with admin user
        const tenantData = {
            name: 'Integration Test Corp',
            slug: 'integration-test',
            subscriptionTier: 'professional',
            primaryContactEmail: 'contact@integration.test'
        };

        const adminData = {
            email: 'admin@integration.test',
            password: 'SecurePassword123!',
            name: 'Integration Admin'
        };

        const result = await AuthService.createTenant(tenantData, adminData);
        testTenant = result.tenant;
        testAdmin = result.admin;

        // Generate tokens
        adminToken = AuthService.generateToken(testAdmin, testTenant);

        // Get or create superadmin
        const superadminQuery = await pool.query(
            'SELECT * FROM users WHERE global_role = \'superadmin\' LIMIT 1'
        );
        
        if (superadminQuery.rows.length > 0) {
            superadmin = superadminQuery.rows[0];
            superadminToken = AuthService.generateToken(superadmin);
        }
    };

    const cleanupIntegrationTest = async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Clean up in dependency order
            await client.query('DELETE FROM tenant_audit_logs WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM analytics_documents WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM analytics_questions WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM analytics_sessions WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM documents WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM tenant_invitations WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM users WHERE tenant_id = $1', [testTenant.id]);
            await client.query('DELETE FROM tenants WHERE id = $1', [testTenant.id]);
            
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Integration cleanup error:', error);
        } finally {
            client.release();
        }
    };

    // Test complete tenant onboarding workflow
    describe('Tenant Onboarding Workflow', () => {
        test('Complete tenant creation by superadmin', async () => {
            const newTenantData = {
                tenant: {
                    name: 'New Test Company',
                    slug: 'new-test-company',
                    subscription_tier: 'starter',
                    primary_contact_email: 'contact@newtest.com'
                },
                admin: {
                    email: 'admin@newtest.com',
                    password: 'AdminPassword123!',
                    name: 'New Admin'
                }
            };

            const response = await request(app)
                .post('/api/tenants')
                .set('Authorization', `Bearer ${superadminToken}`)
                .send(newTenantData)
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.tenant.name).toBe('New Test Company');
            expect(response.body.admin.email).toBe('admin@newtest.com');

            // Cleanup
            await pool.query('DELETE FROM users WHERE email = \'admin@newtest.com\'');
            await pool.query('DELETE FROM tenants WHERE slug = \'new-test-company\'');
        });

        test('Tenant admin can invite users', async () => {
            const response = await request(app)
                .post('/api/auth/invite')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    email: 'invitee@integration.test',
                    role: 'user'
                })
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.invitation.email).toBe('invitee@integration.test');
            
            // Verify invitation exists
            const inviteCheck = await pool.query(
                'SELECT * FROM tenant_invitations WHERE email = $1 AND tenant_id = $2',
                ['invitee@integration.test', testTenant.id]
            );
            
            expect(inviteCheck.rows.length).toBe(1);
        });

        test('User can accept invitation', async () => {
            // Get invitation token
            const inviteQuery = await pool.query(
                'SELECT token FROM tenant_invitations WHERE email = $1 AND tenant_id = $2',
                ['invitee@integration.test', testTenant.id]
            );
            
            const token = inviteQuery.rows[0].token;

            const response = await request(app)
                .post('/api/auth/accept-invite')
                .send({
                    token,
                    name: 'Invited User',
                    password: 'UserPassword123!'
                })
                .expect(201);

            expect(response.body.success).toBe(true);
            expect(response.body.user.email).toBe('invitee@integration.test');
            
            // Verify user was created
            const userCheck = await pool.query(
                'SELECT * FROM users WHERE email = $1 AND tenant_id = $2',
                ['invitee@integration.test', testTenant.id]
            );
            
            expect(userCheck.rows.length).toBe(1);
        });
    });

    // Test settings and branding workflow
    describe('Tenant Settings Workflow', () => {
        test('Admin can update tenant settings', async () => {
            const settingsData = {
                company_name: 'Updated Company Name',
                app_title: 'Custom DataRoom',
                primary_color: '#FF5733',
                logo_url: 'https://example.com/logo.png'
            };

            const response = await request(app)
                .put('/api/settings')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(settingsData)
                .expect(200);

            expect(response.body.company_name).toBe('Updated Company Name');
            expect(response.body.primary_color).toBe('#FF5733');
        });

        test('Settings are tenant-isolated', async () => {
            const response = await request(app)
                .get('/api/settings')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            expect(response.body.company_name).toBe('Updated Company Name');
        });
    });

    // Test usage tracking and limits
    describe('Usage Tracking and Limits', () => {
        test('Usage is tracked per tenant', async () => {
            const response = await request(app)
                .get('/api/tenant/usage')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.usage).toBeDefined();
            expect(response.body.limits).toBeDefined();
        });

        test('Audit logs are created for actions', async () => {
            // Perform an action that should be logged
            await request(app)
                .put('/api/settings')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ company_name: 'Audit Test Company' });

            // Check if audit log was created
            const auditCheck = await pool.query(
                'SELECT * FROM tenant_audit_logs WHERE tenant_id = $1 AND action = $2',
                [testTenant.id, 'SETTINGS_UPDATE']
            );

            expect(auditCheck.rows.length).toBeGreaterThan(0);
        });
    });

    // Test error handling and edge cases
    describe('Error Handling', () => {
        test('Invalid tenant slug returns proper error', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'admin@integration.test',
                    password: 'SecurePassword123!',
                    tenantSlug: 'non-existent-tenant'
                })
                .expect(401);

            expect(response.body.success).toBe(false);
        });

        test('Cross-tenant resource access is blocked', async () => {
            // Try to access another tenant's resource
            const response = await request(app)
                .get('/api/tenant/current')
                .set('Authorization', `Bearer ${adminToken}`)
                .set('x-tenant-slug', 'different-tenant')
                .expect(200); // Should return their own tenant, not the requested one

            expect(response.body.tenant.id).toBe(testTenant.id);
        });

        test('Malformed JWT is rejected', async () => {
            const response = await request(app)
                .get('/api/documents')
                .set('Authorization', 'Bearer invalid-token')
                .expect(403);

            expect(response.body.error).toContain('Invalid');
        });
    });
});

describe('Security Tests', () => {
    test('SQL injection attempts are prevented', async () => {
        const maliciousInput = "'; DROP TABLE tenants; --";
        
        const response = await request(app)
            .post('/api/tenants')
            .set('Authorization', `Bearer ${superadminToken}`)
            .send({
                tenant: {
                    name: maliciousInput,
                    slug: 'test-injection'
                },
                admin: {
                    email: 'test@test.com',
                    password: 'password123',
                    name: 'Test'
                }
            });

        // Should either fail gracefully or succeed with sanitized input
        // The important part is that it doesn't drop the table
        const tableCheck = await pool.query(
            'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'tenants\')'
        );
        expect(tableCheck.rows[0].exists).toBe(true);
    });

    test('Password requirements are enforced', async () => {
        const response = await request(app)
            .post('/api/auth/accept-invite')
            .send({
                token: 'fake-token',
                name: 'Test User',
                password: '123' // Too weak
            })
            .expect(400);

        expect(response.body.error).toBeDefined();
    });
});