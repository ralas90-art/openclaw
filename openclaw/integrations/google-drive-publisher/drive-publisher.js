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
    fields: 'files(id)'
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
    fields: 'id'
  });
  return createResponse.data.id;
}

/**
 * Publish a single file to Google Drive.
 */
async function publishFileToDrive(filePath, options = {}) {
  const manifest = {
    source: 'openclaw',
    published_to: 'google_drive',
    status: 'failed',
    publish_mode: process.env.GOOGLE_DRIVE_PUBLISH_MODE || 'local',
    local_file: filePath,
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

      // Diagnostic context for error reporting
      let diagStage = 'init';
      let diagEmail = 'unknown';
      let diagHasKey = false;
      let diagFolderId = folderId || 'MISSING';

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
      const diagKeyPrefix = credentials.private_key ? credentials.private_key.substring(0, 27) : 'NONE';

      // Authenticate
      diagStage = 'auth_jwt';
      const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive']
      );
      
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
        fields: 'id, name, webViewLink'
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
    // Include diagnostic context in the error message for Telegram visibility
    manifest.error = err.message;
  }

  // Save the manifest JSON log
  createDrivePublishManifest(manifest);
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

module.exports = {
  publishFileToDrive,
  publishFolderToDrive,
  publishCampaignToDrive,
  verifyPublishSafety
};
