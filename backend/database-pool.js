// Database pool for multi-tenant architecture
// This exports a pool directly for use in all multi-tenant files
const { Pool } = require('pg');

// Create pool based on environment
let connectionConfig;

if (process.env.DATABASE_URL) {
  connectionConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };
} else {
  // Use Railway's internal networking or local development
  connectionConfig = {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'dataroom',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(connectionConfig);

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database pool connected at:', res.rows[0].now);
  }
});

module.exports = pool;