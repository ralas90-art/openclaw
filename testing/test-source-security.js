/**
 * Static Source Code Security Scanner Test Suite
 * Scans production source files (jarvis/, interfaces/, server.js, admin-ui/) to ensure no raw token URLs,
 * query token parameters, or master token leaks exist.
 * Exits non-zero on failure.
 */

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Source Security Assertion Failed: ${message}`);
    process.exit(1);
  }
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'brain' && file !== 'testing') {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.tsx')) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

async function runTests() {
  console.log('🧪 Starting Source Code Security Audit Scanner...\n');

  const rootDir = path.resolve(__dirname, '..');
  const targetDirs = [
    path.join(rootDir, 'jarvis'),
    path.join(rootDir, 'interfaces'),
    path.join(rootDir, 'admin-ui', 'src'),
    path.join(rootDir, 'server.js')
  ];

  const sourceFiles = [];
  targetDirs.forEach(target => {
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isFile()) {
        sourceFiles.push(target);
      } else {
        getAllFiles(target, sourceFiles);
      }
    }
  });

  console.log(`- Scanning ${sourceFiles.length} source files for secret leaks and forbidden patterns...`);

  const forbiddenPatterns = [
    { pattern: /req\.query\.token/i, name: 'req.query.token parameter usage' },
    { pattern: /token=\$\{process\.env\.INTERNAL_ADMIN_TOKEN/i, name: 'Raw master token URL embedding' },
    { pattern: /connector=[^&]+&token=/i, name: 'Raw connector token query URL' },
    { pattern: /href=["'].*token=\$\{.*INTERNAL_ADMIN_TOKEN/i, name: 'Raw master token HTML href link' }
  ];

  let violationsCount = 0;

  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(rootDir, file);

    forbiddenPatterns.forEach(({ pattern, name }) => {
      if (pattern.test(content)) {
        console.error(`❌ Security Violation in [${relativePath}]: Found ${name}`);
        violationsCount++;
      }
    });
  });

  assert(violationsCount === 0, `Found ${violationsCount} security pattern violations in source code.`);

  console.log('✅ Source security scanner passed: 0 forbidden token patterns detected across production source code.');
  console.log('\n🎉 Source Security Audit Passed Successfully!');
}

runTests().catch(err => {
  console.error('Source security test execution failed:', err);
  process.exit(1);
});
