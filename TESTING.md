# Multi-Tenant Platform Testing Guide

## Overview

This testing suite ensures complete tenant isolation and security for the multi-tenant SaaS platform transformation.

## Test Categories

### 1. Tenant Isolation Tests (`tenant-isolation.test.js`)
- **Document Isolation**: Ensures tenants can only access their own documents
- **User Management Isolation**: Prevents cross-tenant user management
- **Analytics Isolation**: Verifies analytics data is tenant-scoped
- **Authentication & Authorization**: Tests role hierarchy and login security
- **API Security**: Validates endpoint protection and authentication requirements
- **Data Leakage Prevention**: Ensures no cross-tenant data exposure
- **S3 Bucket Isolation**: Tests per-tenant storage separation
- **Performance Tests**: Validates acceptable response times and concurrent access

### 2. Integration Tests (`integration.test.js`)
- **Complete Workflows**: Tests end-to-end tenant onboarding
- **User Invitation Flow**: Validates invitation and acceptance process
- **Settings Management**: Tests tenant customization features
- **Usage Tracking**: Verifies limits and audit logging
- **Error Handling**: Tests graceful failure scenarios
- **Security Tests**: SQL injection prevention, password requirements

## Quick Start

### Prerequisites
```bash
# Ensure PostgreSQL is running
brew services start postgresql
# or
sudo systemctl start postgresql

# Install dependencies
npm install
```

### Setup Test Environment
```bash
# Setup test database (automatically creates dataroom_test db)
npm run setup:test-db

# Or manually:
createdb dataroom_test
npm run migrate
```

### Run Tests
```bash
# Run all tests
npm test

# Run specific test suites
npm run test:isolation    # Tenant isolation tests
npm run test:integration  # End-to-end workflow tests

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Advanced Test Runner
```bash
# Use the comprehensive test runner
node scripts/run-tests.js
```

## Test Configuration

### Environment Variables (`.env.test`)
```bash
NODE_ENV=test
DATABASE_URL=postgresql://localhost:5432/dataroom_test
JWT_SECRET=test-jwt-secret-key-for-multi-tenant-platform
CLAUDE_API_KEY=test-api-key
AWS_REGION=us-east-1
```

### Jest Configuration (`jest.config.js`)
- Test timeout: 30 seconds
- Setup file: `tests/setup.js`
- Coverage collection from core modules
- Test pattern: `**/tests/**/*.test.js`

## Test Data Management

### Automatic Setup/Cleanup
Tests automatically:
- Create isolated test tenants and users
- Generate JWT tokens with proper tenant context
- Insert test documents and analytics data
- Clean up all test data after completion

### Manual Database Reset
```bash
# Reset test database completely
npm run setup:test-db
```

## Security Test Coverage

✅ **Authentication Tests**
- JWT token validation
- Tenant context enforcement
- Role hierarchy validation
- Cross-tenant access prevention

✅ **Authorization Tests**
- Endpoint protection
- Role-based access control
- Resource ownership validation
- Admin privilege enforcement

✅ **Data Isolation Tests**
- Document access restrictions
- Analytics data separation
- User management boundaries
- S3 bucket isolation

✅ **Input Security Tests**
- SQL injection prevention
- Password requirement enforcement
- Data sanitization validation
- Malformed request handling

## Performance Benchmarks

### Expected Response Times
- Document listing: < 2 seconds
- User authentication: < 1 second
- Analytics dashboard: < 3 seconds
- S3 operations: < 5 seconds

### Concurrent Access Tests
- Multiple tenant requests don't interfere
- Database connections are properly managed
- Memory usage remains stable under load

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Multi-Tenant Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: dataroom_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run setup:test-db
      - run: npm run test:coverage
```

## Coverage Goals

- **Minimum Coverage**: 80% for all core modules
- **Critical Paths**: 95% for authentication and authorization
- **Security Features**: 100% for tenant isolation logic

## Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Check PostgreSQL status
brew services list | grep postgres
sudo systemctl status postgresql

# Reset test database
npm run setup:test-db
```

**JWT Secret Issues**
```bash
# Verify environment variables are loaded
node -e "require('dotenv').config({path:'.env.test'}); console.log(process.env.JWT_SECRET)"
```

**Permission Errors**
```bash
# Grant permissions to test database
psql -c "GRANT ALL PRIVILEGES ON DATABASE dataroom_test TO $(whoami);"
```

**Port Conflicts**
- Test server runs on port 3002 to avoid conflicts
- Ensure no other services are using test ports

### Test Debugging

Enable detailed logging:
```bash
DEBUG=* npm test
```

Run specific test cases:
```bash
npm test -- --testNamePattern="Document Isolation"
```

## Production Readiness

Before deploying to production:
1. ✅ All isolation tests pass
2. ✅ Integration workflows complete successfully  
3. ✅ Security tests validate input sanitization
4. ✅ Performance benchmarks meet requirements
5. ✅ Coverage reports show adequate test coverage
6. ⏳ Load testing under realistic traffic
7. ⏳ Disaster recovery testing
8. ⏳ Cross-browser frontend testing

## Next Steps

1. **Set up CI/CD pipeline** with automated testing
2. **Add load testing** with tools like Artillery or k6
3. **Implement monitoring** alerts for test failures
4. **Create staging environment** for integration testing
5. **Add end-to-end browser tests** with Playwright or Cypress