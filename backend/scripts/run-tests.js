#!/usr/bin/env node
const { exec } = require('child_process');
const { setupTestDatabase } = require('./setup-test-db');

async function runTests() {
  console.log('🧪 Multi-Tenant Platform Test Suite\n');

  try {
    // Step 1: Setup test database
    console.log('📊 Setting up test database...');
    await setupTestDatabase();
    
    // Step 2: Install dependencies if needed
    console.log('\n📦 Checking dependencies...');
    await executeCommand('npm list jest supertest', false);
    
    // Step 3: Run tests
    console.log('\n🔬 Running tenant isolation tests...');
    await executeCommand('npm run test:isolation');
    
    console.log('\n🔬 Running integration tests...');
    await executeCommand('npm run test:integration');
    
    console.log('\n📈 Generating coverage report...');
    await executeCommand('npm run test:coverage');
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\nNext steps:');
    console.log('  • Review coverage report in coverage/lcov-report/index.html');
    console.log('  • Add tests to CI/CD pipeline');
    console.log('  • Set up monitoring alerts based on test results');
    
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    
    console.log('\n🔧 Troubleshooting:');
    console.log('  • Ensure PostgreSQL is running');
    console.log('  • Check that test database permissions are correct');
    console.log('  • Run: npm install jest supertest');
    console.log('  • Verify .env.test configuration');
    
    process.exit(1);
  }
}

function executeCommand(command, failOnError = true) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes('warning')) console.error(stderr);
      
      if (error && failOnError) {
        reject(new Error(`Command failed: ${command}\n${error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };