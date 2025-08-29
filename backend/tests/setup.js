require('dotenv').config({ path: '.env.test' });

// Set test environment variables if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
process.env.CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || 'test-api-key';

// Database configuration for tests
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/dataroom_test';
}

// Increase timeout for database operations
jest.setTimeout(30000);

// Global test setup
beforeAll(async () => {
  // Ensure database connection is ready
  const pool = require('../database-pool');
  
  try {
    await pool.query('SELECT 1');
    console.log('✅ Test database connected');
  } catch (error) {
    console.error('❌ Test database connection failed:', error.message);
    console.log('Please ensure your test database is running and accessible');
    process.exit(1);
  }
});

// Global test teardown
afterAll(async () => {
  const pool = require('../database-pool');
  
  try {
    await pool.end();
    console.log('✅ Test database disconnected');
  } catch (error) {
    console.error('Database cleanup error:', error);
  }
});