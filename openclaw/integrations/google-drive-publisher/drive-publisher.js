/**
 * OpenClaw Google Drive Publisher Integration
 * Supports Local folder syncing and Google Drive API uploads.
 */

const fs = require('fs');
const path = require('path');

// Dynamically load dotenv if not loaded yet
if (fs.existsSync(path.resolve(__dirname, '../../../.env'))) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
}

// Helper to determine target subfolder based on path
function getSubfolderName(filePath, options = {}) {
  const normPath = filePath.replace(/\\/g, '/').toLowerCase();
  
  if (normPath.includes('telegram-requests')) {
    return 'Telegram Requests';
  }
  if (normPath.includes('telegram-responses')) {
    return 'Telegram Responses';
  }
  if (normPath.includes('campaigns/') || normPath.includes('/campaigns')) {
    const proj = options.project || 'SeptiVolt';
    const camp = options.campaign || 'General';
    return 'Campaigns/' + proj + '/' + camp;
  }
  if (normPath.includes('reports') || path.basename(filePath).toLowerCase().includes('report')) {
    return 'Reports';
  }
  return 'Manifests';
}

/**
 * Scan text files for credentials before publishing.
 */
function scanForSecrets(filePath) {
  const fileExt = path.extname(filePath).toLowerCase();
  const textExtensions = ['.md', '.txt', '.json', '.csv', '.xml', '.html', '.js'];
  
  if (textExtensions.includes(fileExt)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const forbiddenSignatures = [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'OPENAI_API_KEY',
      'ELEVENLABS_API_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_DRIVE_CREDENTIALS',
      '-----BEGIN PRIVATE KEY-----'
    ];
    for (const sig of forbiddenSignatures) {
      if (content.includes(sig)) {
        return { safe: false, reason: 'File contains potential secret signature: ' + sig };
      }
    }
  }
  return { safe: true };
}

function isValidRepoRoot(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;
  if (fs.existsSync(path.join(candidate, 'openclaw', 'bots', 'registry.md'))) return true;
  if (fs.existsSync(path.join(candidate, 'server.js')) && fs.existsSync(path.join(candidate, 'package.json'))) return true;
  return false;
}

function getActiveRoots() {
  const roots = [];
  const envRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  if (process.env.OPENCLAW_TEST === 'true') {
    if (envRoot) {
      roots.push(path.resolve(envRoot));
    }
    return roots;
  }

  // 1. OPENCLAW_WORKSPACE_ROOT (if valid)
  if (envRoot && isValidRepoRoot(path.resolve(envRoot))) {
    roots.push(path.resolve(envRoot));
  }

  // 2. __dirname-derived app root (three levels up from google-drive-publisher)
  const appRoot = path.resolve(__dirname, '../../..');
  if (isValidRepoRoot(appRoot)) {
    roots.push(appRoot);
  }

  // 3. Hardcoded /app fallback (Railway)
  const railwayRoot = '/app';
  if (isValidRepoRoot(railwayRoot)) {
    roots.push(path.resolve(railwayRoot));
  }

  // 4. process.cwd() fallback
  const cwdRoot = process.cwd();
  if (isValidRepoRoot(cwdRoot)) {
    roots.push(path.resolve(cwdRoot));
  }

  const unique = [...new Set(roots)];
  if (unique.length === 0) {
    console.error('[drive-publisher getActiveRoots] WARNING: No valid OpenClaw repo root found.');
  }
  return unique;
}

/**
 * Verify safety of path and folder scope.
 */
function verifyPublishSafety(filePath) {
  const candidate = path.resolve(filePath);
  
  // 1. Path traversal mitigation
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.includes('../') || normalizedPath.includes('..\\')) {
    return { safe: false, reason: 'Security block: Path traversal detected.' };
  }
  
  // 2. Forbidden filename check
  const baseName = path.basename(filePath).toLowerCase();
  const forbiddenNames = ['.env', '.key', '.pem', '.p12', 'credentials.json', 'token.json'];
  if (forbiddenNames.some(name => baseName === name || baseName.endsWith(name))) {
    return { safe: false, reason: 'Security block: Forbidden file type (' + baseName + ').' };
  }
  
  // 3. Approved directories filter (checks both app root and env workspace root)
  const roots = getActiveRoots();

  const approvedDirs = [];
  roots.forEach(rootDir => {
    approvedDirs.push(path.resolve(rootDir, 'openclaw/outbox/telegram-responses'));
    approvedDirs.push(path.resolve(rootDir, 'openclaw/reports'));
    approvedDirs.push(path.resolve(rootDir, 'campaigns'));
  });

  const normCandidate = candidate.toLowerCase();

  // Block google-drive-sync directory explicitly for all roots
  for (const rootDir of roots) {
    const blockedDir = path.resolve(rootDir, 'openclaw/outbox/google-drive-sync');
    const normBlocked = blockedDir.toLowerCase();
    if (normCandidate === normBlocked || normCandidate.startsWith(normBlocked + path.sep)) {
      return { safe: false, reason: 'Security block: Path is inside a blocked directory (google-drive-sync).' };
    }
  }

  const isApproved = approvedDirs.some(dir => {
    const normDir = dir.toLowerCase();
    return normCandidate === normDir || normCandidate.startsWith(normDir + path.sep);
  });
  
  const allowInternalOverride = process.env.GOOGLE_DRIVE_ALLOW_INTERNAL_DOC_PUBLISH === 'true';
  
  if (!isApproved && !allowInternalOverride) {
    return { safe: false, reason: 'Security block: Path is outside approved directories (telegram-responses, reports, campaigns).' };
  }
  
  // 4. Secret content scan
  return scanForSecrets(candidate);
}

/**
 * Google Drive API helper function to dynamically resolve folder IDs.
 */
async function resolveFolderId(drive, parentId, folderName) {
  const query = "name = '" + folderName + "' and mimeType = 'application/vnd.google-apps.folder' and '" + parentId + "' in parents and trashed = false";
  const response = await drive.files.list({
    q: query,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }
  
  // Create folder
  const createResponse = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id',
    supportsAllDrives: true
  });
  return createResponse.data.id;
}

/**
 * Helper to extract jobId from result file content if present.
 */
function extractJobIdFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/## Job ID\r?\n(rt_[a-zA-Z0-9_]+)/);
      if (match) return match[1];
    }
  } catch (e) {}
  return null;
}

/**
 * Publish a single file to Google Drive.
 */
async function publishFileToDrive(filePath, options = {}) {
  const jobId = options.jobId || extractJobIdFromFile(filePath) || null;
  const manifest = {
    source: 'openclaw',
    published_to: 'google_drive',
    status: 'failed',
    publish_mode: process.env.GOOGLE_DRIVE_PUBLISH_MODE || 'local',
    local_file: filePath,
    jobId: jobId,
    drive_file_id: '',
    drive_web_url: '',
    drive_local_path: '',
    drive_folder_id: '',
    published_at: new Date().toISOString(),
    project: options.project || 'SeptiVolt',
    campaign: options.campaign || 'General',
    bot: options.bot || 'content-forge',
    workflow: options.workflow || 'image-prompts',
    error: ''
  };

  try {
    // Check file existence
    if (!fs.existsSync(filePath)) {
      throw new Error('Local file does not exist: ' + filePath);
    }

    // Run Security Checks
    const safety = verifyPublishSafety(filePath);
    if (!safety.safe) {
      throw new Error(safety.reason);
    }

    const mode = manifest.publish_mode;
    if (mode === 'local') {
      // MODE 1: Local Sync copy
      const localRoot = process.env.GOOGLE_DRIVE_LOCAL_ROOT;
      if (!localRoot) {
        throw new Error('GOOGLE_DRIVE_LOCAL_ROOT is not configured.');
      }
      
      const subfolder = getSubfolderName(filePath, options);
      const destDir = path.join(localRoot, 'OpenClaw', subfolder);
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const destFilePath = path.join(destDir, path.basename(filePath));
      fs.copyFileSync(filePath, destFilePath);
      
      manifest.status = 'published';
      manifest.drive_local_path = destFilePath;
      
    } else if (mode === 'api') {
      // MODE 2: Programmatic API Upload
      const folderId = process.env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID;
      const credsBase64 = process.env.GOOGLE_DRIVE_CREDENTIALS_BASE64;
      const credsRaw = process.env.GOOGLE_DRIVE_CREDENTIALS;

      if (!folderId) {
        throw new Error('GOOGLE_DRIVE_OUTPUT_FOLDER_ID is not configured.');
      }

      // Check if googleapis library is installed
      let googleapis;
      try {
        googleapis = require('googleapis');
      } catch (e) {
        manifest.status = 'dry_run';
        throw new Error("googleapis library is missing. Install with 'npm install googleapis' or configure local sync.");
      }

      const { google } = googleapis;
      
      // Parse credentials
      diagStage = 'credential_parse';
      let credentials;
      if (credsBase64) {
        const decoded = Buffer.from(credsBase64, 'base64').toString('utf8');
        credentials = JSON.parse(decoded);
      } else if (credsRaw) {
        credentials = JSON.parse(credsRaw);
      } else {
        manifest.status = 'dry_run';
        throw new Error('Google Drive API credentials are not configured (GOOGLE_DRIVE_CREDENTIALS_BASE64 is missing).');
      }

      diagEmail = credentials.client_email || 'MISSING';
      diagHasKey = !!(credentials.private_key);
      diagKeyLength = credentials.private_key ? credentials.private_key.length : 0;
      diagCredsKeys = Object.keys(credentials);
      const diagKeyPrefix = credentials.private_key ? credentials.private_key.substring(0, 27) : 'NONE';

      // Authenticate
      diagStage = 'auth_jwt';
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/drive']
      });
      
      diagStage = 'auth_authorize';
      await auth.authorize();
      
      const drive = google.drive({ version: 'v3', auth });
      
      // Resolve path subfolders dynamically in Google Drive
      diagStage = 'folder_resolve';
      const subfolderPath = getSubfolderName(filePath, options);
      const pathParts = subfolderPath.split('/');
      let currentParentId = folderId;
      
      for (const part of pathParts) {
        currentParentId = await resolveFolderId(drive, currentParentId, part);
      }

      // Upload file
      diagStage = 'file_upload';
      const uploadResponse = await drive.files.create({
        requestBody: {
          name: path.basename(filePath),
          parents: [currentParentId]
        },
        media: {
          body: fs.createReadStream(filePath)
        },
        fields: 'id, name, webViewLink',
        supportsAllDrives: true
      });

      manifest.status = 'published';
      manifest.drive_file_id = uploadResponse.data.id;
      manifest.drive_web_url = uploadResponse.data.webViewLink;
      manifest.drive_folder_id = currentParentId;
    } else {
      throw new Error('Unknown GOOGLE_DRIVE_PUBLISH_MODE: ' + mode);
    }

  } catch (err) {
    console.error('[Google Drive Publisher] Publish failed:', err.message);
    if (manifest.status !== 'dry_run') {
      manifest.status = 'failed';
    }
    // Include stage info for debugging
    manifest.error = err.message;
  }

  // Save the manifest JSON log
  createDrivePublishManifest(manifest);

  // Log drive publish event
  try {
    const runtimeLogger = require('../../runtime/runtime-logger');
    if (manifest.status === 'published') {
      runtimeLogger.logEvent({
        jobId: jobId,
        type: 'drive_publish',
        status: 'success',
        filename: path.basename(filePath),
        driveLink: manifest.drive_web_url || manifest.drive_local_path || null,
        publishStatus: 'published',
        botSlug: options.bot || null
      });
    } else if (manifest.status === 'failed' || manifest.status === 'dry_run') {
      runtimeLogger.logEvent({
        jobId: jobId,
        type: 'drive_publish',
        status: 'failure',
        filename: path.basename(filePath),
        errorCategory: 'google_drive_error',
        safeMessage: manifest.error || 'Drive publish failed.',
        botSlug: options.bot || null
      });
    }
  } catch (logErr) {
    console.warn(`[drive-publisher] Failed to log drive event: ${logErr.message}`);
  }

  return manifest;
}

/**
 * Save publication manifest to sync log directory.
 */
function createDrivePublishManifest(manifest) {
  try {
    const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
    const logDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'google-drive-sync');
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeFilename = path.basename(manifest.local_file).replace(/[^a-zA-Z0-9.-]/g, '_');
    const manifestPath = path.join(logDir, 'publish_manifest_' + timestamp + '_' + safeFilename + '.json');
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (err) {
    console.error('[Google Drive Publisher] Failed to write manifest file:', err.message);
  }
}

/**
 * Check if a local file has already been successfully published to Drive.
 * Scans the google-drive-sync manifest log directory for a matching local_file entry.
 * Returns { alreadyPublished: true, existingManifest: {...} } or { alreadyPublished: false }.
 */
function checkAlreadyPublished(filePath) {
  try {
    const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
    const logDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'google-drive-sync');
    if (!fs.existsSync(logDir)) return { alreadyPublished: false };

    const manifestFiles = fs.readdirSync(logDir).filter(f => f.startsWith('publish_manifest_') && f.endsWith('.json'));
    const normalizeP = p => p.replace(/\\/g, '/').toLowerCase();
    const targetNorm = normalizeP(path.resolve(filePath));

    for (const mf of manifestFiles) {
      try {
        const mfPath = path.join(logDir, mf);
        const data = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
        if (data.status === 'published' && data.local_file) {
          const existingNorm = normalizeP(path.resolve(data.local_file));
          if (existingNorm === targetNorm) {
            return { alreadyPublished: true, existingManifest: data, manifestFile: mf };
          }
        }
      } catch (_) { /* skip corrupt manifest */ }
    }
  } catch (err) {
    console.error('[Google Drive Publisher] checkAlreadyPublished error:', err.message);
  }
  return { alreadyPublished: false };
}

/**
 * Score files to determine publish priority.
 * Priority 5 = highest (result.md in telegram-responses).
 */
function getFilePriority(filePath) {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  // Ignore manifest/sync files
  if (norm.includes('google-drive-sync')) return 0;
  if (base.startsWith('publish_manifest_')) return 0;
  if (base.endsWith('_manifest.json')) return 0;

  if (norm.includes('outbox/telegram-responses') && base.endsWith('_result.md')) return 5;
  if (norm.includes('outbox/telegram-responses') && base.endsWith('.md')) return 4;
  if (norm.includes('reports') && base.endsWith('.md')) return 3;
  if (norm.includes('campaigns') && base.endsWith('.md')) return 2;
  if (norm.includes('campaigns')) return 1;
  return 0;
}

/**
 * Find the latest generated output file in telegram-responses (sorted by filename desc).
 * Returns the absolute path of the highest-priority, most recent file, or null.
 */
function getLatestResultFile(workspaceRoot) {
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  if (!fs.existsSync(responsesDir)) return null;

  const files = fs.readdirSync(responsesDir)
    .filter(f => {
      const norm = f.toLowerCase();
      return !norm.startsWith('publish_manifest_') && !norm.endsWith('_manifest.json') && !norm.startsWith('.');
    })
    .map(f => ({ name: f, fullPath: path.join(responsesDir, f), priority: getFilePriority(path.join(responsesDir, f)) }))
    .filter(f => f.priority > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.name.localeCompare(a.name); // newest filename first (ISO date prefix)
    });

  return files.length > 0 ? files[0].fullPath : null;
}

/**
 * /drive_publish_latest — publishes the latest generated output file.
 * If it has already been published, returns the existing Drive link instead of re-uploading.
 * Use republishLatestToDrive() to force a re-upload.
 */
async function publishLatestToDrive(options = {}) {
  const roots = getActiveRoots();
  if (roots.length === 0) {
    return { status: 'error', message: 'No valid OpenClaw workspace root found.' };
  }
  const workspaceRoot = roots[0];
  const latestFile = getLatestResultFile(workspaceRoot);

  if (!latestFile) {
    return {
      status: 'no_file',
      message: 'No generated output files found in telegram-responses.\nProcess a queued inbox request first with Antigravity.'
    };
  }

  // Duplicate detection
  const dupCheck = checkAlreadyPublished(latestFile);
  if (dupCheck.alreadyPublished) {
    const m = dupCheck.existingManifest;
    const link = m.drive_web_url || m.drive_local_path || '(local copy — no API link)';
    try {
      const runtimeLogger = require('../../runtime/runtime-logger');
      runtimeLogger.logEvent({
        type: 'drive_publish',
        status: 'already_published',
        filename: path.basename(latestFile),
        driveLink: link,
        publishStatus: 'already_published',
        duplicateDetected: true,
        botSlug: options.bot || null
      });
    } catch (logErr) {
      console.warn(`[drive-publisher] Failed to log drive event: ${logErr.message}`);
    }
    return {
      status: 'already_published',
      message: [
        'This file was already published.',
        '',
        'File: ' + path.basename(latestFile),
        'Existing Drive Link: ' + link,
        '',
        'If you want to republish it, use:',
        '/drive_republish_latest'
      ].join('\n'),
      file: latestFile,
      drive_link: link,
      existing_manifest: m
    };
  }

  const result = await publishFileToDrive(latestFile, options);
  return {
    status: result.status,
    message: result.status === 'published'
      ? 'Published successfully.\n\nFile: ' + path.basename(latestFile) + '\nDrive Link: ' + (result.drive_web_url || result.drive_local_path)
      : 'Publish failed: ' + result.error,
    file: latestFile,
    manifest: result
  };
}

/**
 * /drive_publish_pending — finds the latest generated output file that has NOT been published.
 * If none exist, returns a helpful message to process the inbox first.
 */
async function publishPendingToDrive(options = {}) {
  const roots = getActiveRoots();
  if (roots.length === 0) {
    return { status: 'error', message: 'No valid OpenClaw workspace root found.' };
  }
  const workspaceRoot = roots[0];
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  if (!fs.existsSync(responsesDir)) {
    return { status: 'no_file', message: 'No unpublished generated output files found.\n\nLatest queued request may still need to be processed first.\nRun:\n/inbox_latest\n\nThen process the request with Antigravity before publishing.' };
  }

  const files = fs.readdirSync(responsesDir)
    .filter(f => {
      const norm = f.toLowerCase();
      return !norm.startsWith('publish_manifest_') && !norm.endsWith('_manifest.json') && !norm.startsWith('.');
    })
    .map(f => ({ name: f, fullPath: path.join(responsesDir, f), priority: getFilePriority(path.join(responsesDir, f)) }))
    .filter(f => f.priority > 0)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.name.localeCompare(a.name);
    });

  // Find first unpublished file
  for (const file of files) {
    const dupCheck = checkAlreadyPublished(file.fullPath);
    if (!dupCheck.alreadyPublished) {
      const result = await publishFileToDrive(file.fullPath, options);
      return {
        status: result.status,
        message: result.status === 'published'
          ? 'Pending file published successfully.\n\nFile: ' + file.name + '\nDrive Link: ' + (result.drive_web_url || result.drive_local_path)
          : 'Publish failed: ' + result.error,
        file: file.fullPath,
        manifest: result
      };
    }
  }

  return {
    status: 'no_pending',
    message: [
      'No unpublished generated output files found.',
      '',
      'Latest queued request may still need to be processed first.',
      'Run:',
      '/inbox_latest',
      '',
      'Then process the request with Antigravity before publishing.'
    ].join('\n')
  };
}

/**
 * /drive_republish_latest — forces a re-upload of the latest generated output file.
 * Use only when you intentionally want a new Drive copy.
 */
async function republishLatestToDrive(options = {}) {
  const roots = getActiveRoots();
  if (roots.length === 0) {
    return { status: 'error', message: 'No valid OpenClaw workspace root found.' };
  }
  const workspaceRoot = roots[0];
  const latestFile = getLatestResultFile(workspaceRoot);

  if (!latestFile) {
    return { status: 'no_file', message: 'No generated output files found to republish.' };
  }

  console.log('[Google Drive Publisher] Force republishing:', latestFile);
  const result = await publishFileToDrive(latestFile, options);
  return {
    status: result.status,
    message: result.status === 'published'
      ? 'Force republished successfully.\n\nFile: ' + path.basename(latestFile) + '\nDrive Link: ' + (result.drive_web_url || result.drive_local_path)
      : 'Republish failed: ' + result.error,
    file: latestFile,
    manifest: result
  };
}

/**
 * Publish all files in a folder recursively.
 */
async function publishFolderToDrive(folderPath, options = {}) {
  const results = [];
  if (!fs.existsSync(folderPath)) {
    console.warn('[Google Drive Publisher] Folder does not exist: ' + folderPath);
    return results;
  }

  const items = fs.readdirSync(folderPath);
  for (const item of items) {
    const fullPath = path.join(folderPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const res = await publishFileToDrive(fullPath, options);
      results.push(res);
    } else if (stat.isDirectory()) {
      const subResults = await publishFolderToDrive(fullPath, options);
      results.push(...subResults);
    }
  }
  return results;
}

/**
 * Publish campaign outputs to Drive.
 */
async function publishCampaignToDrive(campaignPath, options = {}) {
  const normPath = campaignPath.replace(/\\/g, '/');
  
  // Extract project and campaign name from folder structure
  const pathParts = normPath.split('/');
  const campaignName = pathParts[pathParts.length - 1] || 'General';
  const projectName = pathParts[pathParts.length - 3] || 'SeptiVolt';
  
  const campaignOptions = {
    ...options,
    project: projectName,
    campaign: campaignName
  };
  
  return publishFolderToDrive(campaignPath, campaignOptions);
}

/**
 * publishExactRuntimeFile(exactFilePath)
 * Safe wrapper for /run_publish — enforces all safety invariants at the library level:
 *   1. Path must be inside openclaw/outbox/telegram-responses/
 *   2. Filename must end in _runtime_result.md
 *   3. Runs duplicate detection — returns existing manifest if already published
 *   4. Creates normal Drive sync manifest records via publishFileToDrive()
 *
 * @param {string} exactFilePath — absolute path to the generated result file
 * @param {object} options — optional publish options (bot, project, campaign)
 * @returns {Promise<{ status: string, drive_web_url?: string, drive_local_path?: string, error?: string, alreadyPublished?: boolean, existingManifest?: object }>}
 */
async function publishExactRuntimeFile(exactFilePath, options = {}) {
  const filename = path.basename(exactFilePath);

  // 1. Filename suffix guard
  if (!filename.endsWith('_runtime_result.md')) {
    return {
      status: 'rejected',
      error: `Security block: File does not match required suffix (_runtime_result.md). Got: ${filename}`
    };
  }

  // 2. Path scope guard — must be inside openclaw/outbox/telegram-responses/
  const roots = getActiveRoots();
  if (roots.length === 0) {
    return { status: 'error', error: 'No valid OpenClaw workspace root found.' };
  }
  const workspaceRoot = roots[0];
  const responsesDir = path.resolve(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  const resolvedPath = path.resolve(exactFilePath);

  if (!resolvedPath.startsWith(responsesDir + path.sep) && resolvedPath !== responsesDir) {
    return {
      status: 'rejected',
      error: 'Security block: Path is outside approved directory (openclaw/outbox/telegram-responses/).'
    };
  }

  // 3. File existence check
  if (!fs.existsSync(resolvedPath)) {
    return { status: 'error', error: `File not found: ${filename}` };
  }

  // 4. Duplicate detection — return existing manifest if already published
  const dupCheck = checkAlreadyPublished(resolvedPath);
  const jobId = options.jobId || (dupCheck.alreadyPublished && dupCheck.existingManifest.jobId) || extractJobIdFromFile(resolvedPath) || null;
  const mergedOptions = { ...options, jobId };

  if (dupCheck.alreadyPublished) {
    try {
      const runtimeLogger = require('../../runtime/runtime-logger');
      const existingLink = dupCheck.existingManifest.drive_web_url || dupCheck.existingManifest.drive_local_path || '';
      runtimeLogger.logEvent({
        jobId: jobId,
        type: 'drive_publish',
        status: 'already_published',
        filename: filename,
        driveLink: existingLink,
        publishStatus: 'already_published',
        duplicateDetected: true,
        botSlug: options.bot || null
      });
    } catch (logErr) {
      console.warn(`[drive-publisher] Failed to log drive event: ${logErr.message}`);
    }
    return {
      status: 'already_published',
      alreadyPublished: true,
      existingManifest: dupCheck.existingManifest,
      drive_web_url: dupCheck.existingManifest.drive_web_url || '',
      drive_local_path: dupCheck.existingManifest.drive_local_path || ''
    };
  }

  // 5. Delegate to publishFileToDrive (creates normal Drive sync manifest records)
  return publishFileToDrive(resolvedPath, mergedOptions);
}

module.exports = {
  publishFileToDrive,
  publishExactRuntimeFile,
  publishFolderToDrive,
  publishCampaignToDrive,
  verifyPublishSafety,
  // Command-level helpers
  publishLatestToDrive,
  publishPendingToDrive,
  republishLatestToDrive,
  checkAlreadyPublished,
  getLatestResultFile,
  getFilePriority
};
