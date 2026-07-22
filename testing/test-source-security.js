/**
 * Static Source Code & Bundle Security Scanner Test Suite
 * Scans production source files (jarvis/, interfaces/, server.js, admin-ui/src) and built frontend bundles (admin-ui/dist).
 * Ensures no raw token URLs, query tokens, legacy auth stores, or request-time DDLs exist.
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

function getAllSourceFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // Exclude testing/, node_modules, .git, dist, brain
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'brain' && file !== 'testing') {
        getAllSourceFiles(fullPath, arrayOfFiles);
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
  console.log('🧪 Starting Comprehensive Source Code & Bundle Security Scanner...\n');

  const rootDir = path.resolve(__dirname, '..');
  const targetPaths = [
    path.join(rootDir, 'jarvis'),
    path.join(rootDir, 'interfaces'),
    path.join(rootDir, 'admin-ui', 'src'),
    path.join(rootDir, 'server.js')
  ];

  const sourceFiles = [];
  targetPaths.forEach(target => {
    if (fs.existsSync(target)) {
      if (fs.statSync(target).isFile()) {
        sourceFiles.push(target);
      } else {
        getAllSourceFiles(target, sourceFiles);
      }
    }
  });

  console.log(`- Scanning ${sourceFiles.length} production source files (excluding testing/)...`);

  // 1. Forbidden Secret Leaks & Token Query Patterns
  const forbiddenPatterns = [
    { pattern: /req\.query\.token/i, name: 'req.query.token parameter usage' },
    { pattern: /token=\$\{process\.env\.INTERNAL_ADMIN_TOKEN/i, name: 'Raw master token URL embedding' },
    { pattern: /connector=[^&]+&token=/i, name: 'Raw connector token query URL' },
    { pattern: /href=["'].*token=\$\{.*INTERNAL_ADMIN_TOKEN/i, name: 'Raw master token HTML href link' },
    { pattern: /VITE_INTERNAL_ADMIN_TOKEN/i, name: 'VITE_INTERNAL_ADMIN_TOKEN reference' }
  ];

  // 2. Legacy Auth Store Symbols
  const legacyAuthSymbols = [
    'ticketStore',
    'sessionStore',
    'issueTicket',
    'exchangeTicket',
    'isValidSession',
    'requireAdminToken'
  ];

  let violationsCount = 0;
  let exchangeTicketRouteCount = 0;
  let DDLViolations = 0;

  const migrationsFile = path.join(rootDir, 'jarvis', 'migrations.js');

  sourceFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(rootDir, file);

    // Forbidden patterns check
    forbiddenPatterns.forEach(({ pattern, name }) => {
      if (pattern.test(content)) {
        console.error(`❌ Security Violation in [${relativePath}]: Found ${name}`);
        violationsCount++;
      }
    });

    // Legacy Auth Symbols check
    legacyAuthSymbols.forEach(sym => {
      // Regex checking for variable declaration or function definition of legacy symbols
      const symRegex = new RegExp(`\\b${sym}\\b`, 'g');
      if (symRegex.test(content)) {
        console.error(`❌ Legacy Auth Violation in [${relativePath}]: Found legacy symbol '${sym}'`);
        violationsCount++;
      }
    });

    // Count /auth/exchange-ticket route definitions
    if (/router\.post\(['"]\/auth\/exchange-ticket['"]/i.test(content) || /app\.post\(['"]\/auth\/exchange-ticket['"]/i.test(content)) {
      exchangeTicketRouteCount++;
    }

    // Check request-time DDL outside jarvis/migrations.js
    if (path.resolve(file) !== path.resolve(migrationsFile)) {
      const ddlRegex = /\b(CREATE\ TABLE|ALTER\ TABLE|DROP\ TABLE)\b/i;
      if (ddlRegex.test(content)) {
        console.error(`❌ DDL Violation in [${relativePath}]: Found inline DDL statement outside jarvis/migrations.js`);
        DDLViolations++;
      }
    }
  });

  assert(violationsCount === 0, `Found ${violationsCount} security & legacy pattern violations in source code.`);
  assert(DDLViolations === 0, `Found ${DDLViolations} DDL violations outside jarvis/migrations.js.`);
  assert(exchangeTicketRouteCount === 1, `Exactly 1 /auth/exchange-ticket route must exist across codebase. Found ${exchangeTicketRouteCount}`);
  console.log('✅ Source security scanner passed: 0 forbidden token patterns, 0 legacy auth symbols, 0 unauthorized DDL statements.');

  // 3. Frontend Bundle Inspection (admin-ui/dist)
  const distDir = path.join(rootDir, 'admin-ui', 'dist', 'assets');
  if (fs.existsSync(distDir)) {
    const bundleFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
    console.log(`- Scanning ${bundleFiles.length} built JS bundle(s) in admin-ui/dist/assets...`);
    const sentinelSecret = process.env.INTERNAL_ADMIN_TOKEN || 'admin-test-token-123';

    bundleFiles.forEach(file => {
      const bundleContent = fs.readFileSync(path.join(distDir, file), 'utf8');
      assert(!bundleContent.includes(sentinelSecret), `Frontend bundle ${file} leaked sentinel secret '${sentinelSecret}'`);
      assert(!bundleContent.includes('VITE_INTERNAL_ADMIN_TOKEN'), `Frontend bundle ${file} contains VITE_INTERNAL_ADMIN_TOKEN reference`);
    });
    console.log('✅ Frontend bundle security scanner passed: No master token secrets in built assets.');
  }

  console.log('\n🎉 Comprehensive Source & Bundle Security Audit Passed Successfully!');
}

runTests().catch(err => {
  console.error('Source security test execution failed:', err);
  process.exit(1);
});
