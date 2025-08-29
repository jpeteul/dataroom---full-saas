#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔄 Multi-Tenant Transition Script\n');

const steps = [
  {
    name: 'Backup current server.js',
    action: () => {
      const serverPath = path.join(__dirname, 'server.js');
      const backupPath = path.join(__dirname, 'server.single-tenant.backup.js');
      
      if (fs.existsSync(serverPath)) {
        fs.copyFileSync(serverPath, backupPath);
        console.log(`   ✅ Backed up to server.single-tenant.backup.js`);
      } else {
        console.log(`   ⚠️  server.js not found`);
      }
    }
  },
  {
    name: 'Check for required dependencies',
    action: () => {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const required = ['bcryptjs', 'jsonwebtoken', 'express-rate-limit'];
      const missing = required.filter(dep => !packageJson.dependencies[dep]);
      
      if (missing.length > 0) {
        console.log(`   📦 Installing missing dependencies: ${missing.join(', ')}`);
        execSync(`npm install ${missing.join(' ')}`, { stdio: 'inherit' });
      } else {
        console.log(`   ✅ All dependencies installed`);
      }
    }
  },
  {
    name: 'Create environment variables template',
    action: () => {
      const envPath = path.join(__dirname, '.env');
      const envExamplePath = path.join(__dirname, '.env.example');
      
      const envTemplate = `# Multi-Tenant SaaS Configuration

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/dataroom

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SUPERADMIN_PASSWORD=SuperAdmin123!

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# Claude API
ANTHROPIC_API_KEY=your-claude-api-key

# Server
PORT=3001
NODE_ENV=development

# Optional: Custom domain for production
APP_DOMAIN=yourdomain.com
`;

      if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envExamplePath, envTemplate);
        console.log(`   ✅ Created .env.example template`);
        console.log(`   ⚠️  Please create .env file with your configuration`);
      } else {
        if (!fs.existsSync(envExamplePath)) {
          fs.writeFileSync(envExamplePath, envTemplate);
        }
        console.log(`   ✅ .env file exists`);
      }
    }
  },
  {
    name: 'Update package.json scripts',
    action: () => {
      const packagePath = path.join(__dirname, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      
      packageJson.scripts = {
        ...packageJson.scripts,
        'start': 'node server-multi-tenant.js',
        'start:single': 'node server.single-tenant.backup.js',
        'migrate': 'node migrate.js',
        'dev': 'nodemon server-multi-tenant.js',
        'transition': 'node transition-to-multi-tenant.js'
      };
      
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
      console.log(`   ✅ Updated package.json scripts`);
    }
  },
  {
    name: 'Create database.js pool export',
    action: () => {
      const dbPath = path.join(__dirname, 'database.js');
      const dbContent = fs.readFileSync(dbPath, 'utf8');
      
      // Check if pool is already exported
      if (!dbContent.includes('module.exports = pool')) {
        // Add pool export at the end
        const updatedContent = dbContent + `

// Export pool for multi-tenant usage
if (typeof pool !== 'undefined') {
  module.exports = pool;
} else {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  module.exports = pool;
}
`;
        fs.writeFileSync(dbPath, updatedContent);
        console.log(`   ✅ Updated database.js to export pool`);
      } else {
        console.log(`   ✅ database.js already exports pool`);
      }
    }
  }
];

// Execute steps
console.log('Starting transition process...\n');

steps.forEach((step, index) => {
  console.log(`Step ${index + 1}: ${step.name}`);
  try {
    step.action();
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    process.exit(1);
  }
  console.log('');
});

console.log('✅ Transition preparation complete!\n');
console.log('Next steps:');
console.log('1. Review and update your .env file');
console.log('2. Run: npm run migrate');
console.log('3. Start the multi-tenant server: npm start');
console.log('4. Or rollback to single-tenant: npm run start:single\n');
console.log('📚 Documentation: See MULTI_TENANT_SETUP.md for detailed instructions');