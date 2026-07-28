/**
 * Jarvis Local File Inventory — Phase 4A: Safe Level-1 Folder Inventory
 * 
 * Manually approved, metadata-only Level-1 folder inventory constrained to
 * server-side configured workspace root aliases.
 *
 * Safety Rules:
 * - Non-recursive Level-1 directory listing only (zero file indexing, zero content reading).
 * - Accepts ONLY server-configured aliases mapped to paths inside the OpenClaw workspace.
 * - Rejects raw paths, path traversal, drive roots, filesystem roots, symlinks, and out-of-workspace paths.
 * - Stores NO absolute filesystem paths in database rows, Telegram messages, API payloads, or logs.
 * - Uses central jarvis_approval_requests queue for folder approval.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryDb, withTransaction } = require('./db');

const IGNORE_DIRECTORIES = ['.git', 'node_modules', '.gemini', 'dist', 'build', 'tmp', '.cache'];
const MAX_CHILD_FOLDERS = 100;
const activeScans = new Set();

/**
 * Checks if local inventory feature flag is enabled
 */
function isInventoryEnabled() {
  return process.env.JARVIS_LOCAL_INVENTORY_ENABLED === 'true';
}

/**
 * Resolves canonical OpenClaw workspace root
 */
function getWorkspaceRoot() {
  let rootDir = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'openclaw'))) {
    rootDir = path.resolve(__dirname, '../');
  }
  return fs.realpathSync(rootDir);
}

/**
 * Parses configured roots from server environment JSON
 */
function getConfiguredRoots() {
  const jsonStr = process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON;
  if (!jsonStr) return {};
  try {
    const parsed = JSON.parse(jsonStr);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    console.warn('[LocalInventory] Failed to parse JARVIS_LOCAL_INVENTORY_ROOTS_JSON:', err.message);
    return {};
  }
}

/**
 * Validates alias and resolves safe root containment & SHA-256 fingerprint
 */
function resolveSafeRoot(alias) {
  if (!isInventoryEnabled()) {
    throw new Error('Local inventory feature is disabled (JARVIS_LOCAL_INVENTORY_ENABLED=false).');
  }

  if (!alias || typeof alias !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(alias)) {
    throw new Error('Invalid root alias. Alias must be an alphanumeric identifier.');
  }

  const configuredRoots = getConfiguredRoots();
  const relPath = configuredRoots[alias];
  if (!relPath || typeof relPath !== 'string') {
    throw new Error(`Unknown inventory root alias '${alias}'. Alias must be defined in server configuration.`);
  }

  // Reject invalid patterns in relative path
  if (relPath.includes('\0') || relPath.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`Invalid root configuration for alias '${alias}'. Path must be workspace-relative without traversal.`);
  }

  const workspaceRoot = getWorkspaceRoot();
  const targetPath = path.resolve(workspaceRoot, relPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Configured root path for alias '${alias}' does not exist.`);
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Configured root path for alias '${alias}' is not a directory.`);
  }

  const canonicalWorkspace = fs.realpathSync(workspaceRoot);
  const canonicalTarget = fs.realpathSync(targetPath);

  // Containment check
  const isContained = canonicalTarget === canonicalWorkspace || canonicalTarget.startsWith(canonicalWorkspace + path.sep);
  if (!isContained) {
    throw new Error(`Security Exception: Configured root for alias '${alias}' is outside the verified workspace boundary.`);
  }

  const fingerprint = crypto.createHash('sha256').update(canonicalTarget).digest('hex');
  return { alias, canonicalPath: canonicalTarget, fingerprint };
}

/**
 * Registers a configured root alias to jarvis_local_folders and creates a central approval request
 */
function normalizeClientChatId(reqMessage) {
  if (!reqMessage) return 'admin';
  return String(reqMessage.chat?.id || reqMessage.from?.id || 'admin');
}

async function addLocalFolder(alias, reqMessage = null) {
  const actor = normalizeClientChatId(reqMessage);
  const { fingerprint } = resolveSafeRoot(alias);

  // 1. Upsert root folder record in jarvis_local_folders
  const folderRows = await queryDb(
    `INSERT INTO jarvis_local_folders (safe_alias, root_fingerprint, status, updated_at)
     VALUES ($1, $2, 'pending', NOW())
     ON CONFLICT (safe_alias) DO UPDATE SET
       root_fingerprint = EXCLUDED.root_fingerprint,
       status = 'pending',
       updated_at = NOW()
     RETURNING *;`,
    [alias, fingerprint]
  );
  const folder = folderRows[0];

  // 2. Create pending request in central jarvis_approval_requests table
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const actionSummary = `Approve inventory root for alias '${alias}'`;
  const proposedPayload = { safe_alias: alias, root_fingerprint: fingerprint };

  const approvalRows = await queryDb(
    `INSERT INTO jarvis_approval_requests (
      approval_type, project_slug, requested_action, risk_level, status, action_type,
      proposed_payload, expires_at, requested_by, proposed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *;`,
    [
      'proposal',
      'system',
      actionSummary,
      'medium',
      'pending',
      'approve_local_inventory_root',
      JSON.stringify(proposedPayload),
      expiresAt,
      actor
    ]
  );

  const approval = approvalRows[0];

  // Log audit event
  try {
    await queryDb(
      `INSERT INTO jarvis_approval_audit_events (
        approval_id, event_type, actor, previous_status, new_status, safe_summary
      ) VALUES ($1, $2, $3, $4, $5, $6);`,
      [approval.id, 'propose', actor, null, 'pending', `Requested approval for root alias '${alias}'`]
    );
  } catch (err) {
    console.warn('[LocalInventory] Failed to write audit event:', err.message);
  }

  return {
    success: true,
    alias,
    approval_id: approval.id,
    folder_id: folder.id,
    status: 'pending'
  };
}

/**
 * Deprecated direct approval bypass
 */
async function approveLocalFolder() {
  throw new Error('Direct folder approval is deprecated. Use /jarvis_approve <approval_id> to approve pending folder requests via the central approval queue.');
}

/**
 * Lists registered inventory roots
 */
async function listLocalFolders(filter = null) {
  if (!isInventoryEnabled()) {
    return [];
  }

  const cleanFilter = filter ? filter.trim().toLowerCase() : null;
  if (cleanFilter && !['pending', 'approved', 'revoked'].includes(cleanFilter)) {
    throw new Error(`Invalid folder status filter '${filter}'. Valid options: pending, approved, revoked.`);
  }

  let sql = "SELECT id, safe_alias, status, root_fingerprint, approved_by, approved_at, last_scanned_at, created_at, updated_at FROM jarvis_local_folders";
  let params = [];

  if (cleanFilter) {
    sql += " WHERE status = $1 ORDER BY created_at DESC;";
    params = [cleanFilter];
  } else {
    sql += " ORDER BY created_at DESC;";
  }

  return await queryDb(sql, params);
}

/**
 * Executes Level-1 inventory scan on an approved root alias
 */
async function scanApprovedFolders(alias, reqMessage = null) {
  if (!isInventoryEnabled()) {
    throw new Error('Local inventory feature is disabled (JARVIS_LOCAL_INVENTORY_ENABLED=false).');
  }

  if (!alias || typeof alias !== 'string') {
    throw new Error('Alias parameter is required. Usage: /jarvis_scan <approved_alias>');
  }

  const actor = normalizeClientChatId(reqMessage);
  const { canonicalPath, fingerprint } = resolveSafeRoot(alias);

  // Check registration and approval status
  const rows = await queryDb(
    "SELECT * FROM jarvis_local_folders WHERE safe_alias = $1;",
    [alias]
  );
  if (rows.length === 0) {
    throw new Error(`Root alias '${alias}' is not registered. Run /jarvis_add_folder ${alias} first.`);
  }

  const folderRecord = rows[0];
  if (folderRecord.status !== 'approved') {
    throw new Error(`Root alias '${alias}' is not approved (Current status: '${folderRecord.status}'). Must be approved via central queue.`);
  }

  if (folderRecord.root_fingerprint !== fingerprint) {
    throw new Error(`Root alias '${alias}' approval fingerprint mismatch. Server configuration path changed; re-approval required.`);
  }

  // Single active scan lock per root
  if (activeScans.has(alias)) {
    throw new Error(`Scan already in progress for root alias '${alias}'. Concurrent scans are prohibited.`);
  }

  activeScans.add(alias);

  try {
    // Perform EXACTLY ONE non-recursive directory listing
    let dirents;
    try {
      dirents = fs.readdirSync(canonicalPath, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Failed to read directory for root alias '${alias}': ${err.message}`);
    }

    const childFolders = [];
    const childFiles = [];

    for (const dirent of dirents) {
      // 1. Skip symlinks
      if (dirent.isSymbolicLink()) continue;

      // 2. Skip ignored system directories
      if (IGNORE_DIRECTORIES.includes(dirent.name)) continue;

      if (dirent.isDirectory()) {
        childFolders.push(dirent.name);
      } else if (dirent.isFile()) {
        try {
          const filePath = path.join(canonicalPath, dirent.name);
          const stat = fs.statSync(filePath);
          const ext = path.extname(dirent.name).replace(/^\.+/, '').toLowerCase();
          childFiles.push({
            name: dirent.name,
            extension: ext,
            size: stat.size,
            mtime: stat.mtime,
            relativePath: dirent.name
          });
        } catch (err) {}
      }
    }

    if (childFolders.length > MAX_CHILD_FOLDERS) {
      throw new Error(`Scan aborted: Root alias '${alias}' contains ${childFolders.length} child directories, exceeding maximum limit of ${MAX_CHILD_FOLDERS}.`);
    }

    // Persist Level-1 child inventory and file index in a database transaction
    await withTransaction(async (client) => {
      const lockHash = crypto.createHash('sha256').update(`jarvis_scan_${alias}`).digest();
      const lockKey = lockHash.readInt32BE(0);
      await client.query("SELECT pg_advisory_xact_lock($1);", [lockKey]);

      // Re-verify root approval status under transaction lock
      const lockRows = await client.query(
        "SELECT * FROM jarvis_local_folders WHERE safe_alias = $1 FOR UPDATE;",
        [alias]
      );
      if (lockRows.rows.length === 0 || lockRows.rows[0].status !== 'approved') {
        throw new Error(`Root alias '${alias}' is not approved (Current status: '${lockRows.rows[0]?.status || 'unknown'}'). Scan aborted.`);
      }
      const currentFolderRecord = lockRows.rows[0];

      // 1. Upsert immediate child folders
      for (const folderName of childFolders) {
        await client.query(
          `INSERT INTO jarvis_level1_folder_inventory (root_alias, folder_name, relative_path, status, last_seen_at)
           VALUES ($1, $2, $3, 'active', NOW())
           ON CONFLICT (root_alias, relative_path) DO UPDATE SET
             status = 'active',
             last_seen_at = NOW();`,
          [alias, folderName, folderName]
        );
      }

      // 2. Reconcile missing child folders (mark inactive for stale entries)
      if (childFolders.length > 0) {
        await client.query(
          `UPDATE jarvis_level1_folder_inventory
           SET status = 'inactive'
           WHERE root_alias = $1 AND relative_path NOT IN (SELECT unnest($2::text[]));`,
          [alias, childFolders]
        );
      } else {
        await client.query(
          `UPDATE jarvis_level1_folder_inventory
           SET status = 'inactive'
           WHERE root_alias = $1;`,
          [alias]
        );
      }

      // 3. Upsert immediate Level-1 files into jarvis_local_file_index
      for (const file of childFiles) {
        const safeRelPath = `${alias}/${file.relativePath}`;
        await client.query(
          `INSERT INTO jarvis_local_file_index (
             folder_id, file_path, relative_path, file_name, file_extension, file_size_bytes, modified_at, indexed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (file_path) DO UPDATE SET
             folder_id = EXCLUDED.folder_id,
             relative_path = EXCLUDED.relative_path,
             file_name = EXCLUDED.file_name,
             file_extension = EXCLUDED.file_extension,
             file_size_bytes = EXCLUDED.file_size_bytes,
             modified_at = EXCLUDED.modified_at,
             indexed_at = NOW();`,
          [currentFolderRecord.id, safeRelPath, file.relativePath, file.name, file.extension, file.size, file.mtime]
        );
      }

      // 4. Delete removed files for this root folder
      if (childFiles.length > 0) {
        const currentFilePaths = childFiles.map(f => `${alias}/${f.relativePath}`);
        await client.query(
          `DELETE FROM jarvis_local_file_index
           WHERE folder_id = $1 AND file_path NOT IN (SELECT unnest($2::text[]));`,
          [currentFolderRecord.id, currentFilePaths]
        );
      } else {
        await client.query(
          `DELETE FROM jarvis_local_file_index
           WHERE folder_id = $1;`,
          [currentFolderRecord.id]
        );
      }

      // 5. Update last_scanned_at on root record
      await client.query(
        "UPDATE jarvis_local_folders SET last_scanned_at = NOW(), updated_at = NOW() WHERE safe_alias = $1;",
        [alias]
      );
    });

    // Record audit event
    try {
      await queryDb(
        `INSERT INTO jarvis_audit_logs (actor, action, payload)
         VALUES ($1, $2, $3);`,
        [actor, 'scan_level1_inventory', JSON.stringify({ root_alias: alias, count: childFolders.length, outcome: 'success' })]
      );
    } catch (err) {
      console.warn('[LocalInventory] Failed to write scan audit log:', err.message);
    }

    return {
      success: true,
      alias,
      foldersIndexed: childFolders.length,
      status: 'completed'
    };

  } finally {
    activeScans.delete(alias);
  }
}

/**
 * Gets active Level-1 folder inventory for an approved alias
 */
async function getFolderInventory(alias) {
  if (!isInventoryEnabled()) {
    throw new Error('Local inventory feature is disabled (JARVIS_LOCAL_INVENTORY_ENABLED=false).');
  }

  if (!alias || typeof alias !== 'string') {
    throw new Error('Alias parameter is required.');
  }

  const folderCheck = await queryDb(
    "SELECT status FROM jarvis_local_folders WHERE safe_alias = $1;",
    [alias]
  );
  if (folderCheck.length === 0 || folderCheck[0].status !== 'approved') {
    return [];
  }

  const rows = await queryDb(
    `SELECT folder_name, relative_path, status, first_seen_at, last_seen_at
     FROM jarvis_level1_folder_inventory
     WHERE root_alias = $1 AND status = 'active'
     ORDER BY folder_name ASC;`,
    [alias]
  );

  return rows;
}

/**
 * Revokes approval for a root alias
 */
async function revokeLocalFolder(alias, reqMessage = null) {
  if (!isInventoryEnabled()) {
    throw new Error('Local inventory feature is disabled.');
  }

  if (!alias || typeof alias !== 'string') {
    throw new Error('Alias parameter is required for revocation.');
  }

  const actor = normalizeClientChatId(reqMessage);

  const lockHash = crypto.createHash('sha256').update(`jarvis_scan_${alias}`).digest();
  const lockKey = lockHash.readInt32BE(0);

  const folderRecord = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1);", [lockKey]);

    const rows = await client.query(
      `UPDATE jarvis_local_folders
       SET status = 'revoked', updated_at = NOW()
       WHERE safe_alias = $1
       RETURNING id, safe_alias, status, root_fingerprint, updated_at;`,
      [alias]
    );

    if (rows.rows.length === 0) {
      throw new Error(`Root alias '${alias}' not found.`);
    }

    const rec = rows.rows[0];

    // Purge derived inventory metadata for this root in the same transaction
    await client.query("DELETE FROM jarvis_local_file_index WHERE folder_id = $1;", [rec.id]);
    await client.query("DELETE FROM jarvis_level1_folder_inventory WHERE root_alias = $1;", [alias]);

    return rec;
  });

  // Audit event
  try {
    await queryDb(
      `INSERT INTO jarvis_audit_logs (actor, action, payload)
       VALUES ($1, $2, $3);`,
      [actor, 'revoke_level1_inventory_root', JSON.stringify({ root_alias: alias, outcome: 'revoked' })]
    );
  } catch (err) {}

  return folderRecord;
}

/**
 * Sanitizes file path for display by removing absolute root prefixes and drive letters
 */
function sanitizePathForDisplay(filePath, workspaceRoot) {
  if (!filePath || typeof filePath !== 'string') return '';

  let cleaned = filePath.replace(/\\/g, '/');

  if (workspaceRoot) {
    const normRoot = String(workspaceRoot).replace(/\\/g, '/');
    if (cleaned.startsWith(normRoot)) {
      cleaned = cleaned.substring(normRoot.length);
    }
  }

  // Remove drive letters (e.g., C:, D:)
  cleaned = cleaned.replace(/^[a-zA-Z]:/, '');

  // Remove UNC network share prefixes (e.g. //server/share/)
  cleaned = cleaned.replace(/^\/\/[^/]+\/[^/]+\//, '/');

  // Filter path traversal segments (.. or .)
  cleaned = cleaned.split('/')
    .filter(segment => segment !== '..' && segment !== '.' && segment !== '')
    .join('/');

  // Redact known hostile / system directory prefixes if path remains absolute or unsafe
  const forbiddenPrefixes = ['etc/', 'home/', 'users/', 'var/', 'usr/', 'tmp/', 'private/', 'windows/', 'system32/'];
  const lowerCleaned = cleaned.toLowerCase();
  for (const prefix of forbiddenPrefixes) {
    if (lowerCleaned.startsWith(prefix) || lowerCleaned.includes('/' + prefix)) {
      cleaned = path.posix.basename(cleaned);
      break;
    }
  }

  if (path.isAbsolute(filePath) && !cleaned) {
    cleaned = path.posix.basename(filePath.replace(/\\/g, '/'));
  }

  if (!cleaned) {
    cleaned = path.posix.basename(filePath.replace(/\\/g, '/'));
  }

  return cleaned;
}

/**
 * Matches filename and relative path against active project slugs using boundary-aware logic
 */
function matchProjectSlug(fileName, relativeOrFilePath, activeSlugs = []) {
  if (!fileName && !relativeOrFilePath) return { slug: null, reason: 'Unmatched' };
  const target = `${relativeOrFilePath || ''}/${fileName || ''}`.toLowerCase();

  let bestSlug = null;
  for (const slug of activeSlugs) {
    if (!slug) continue;
    const normSlug = slug.toLowerCase();
    const escaped = normSlug.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
    if (regex.test(target)) {
      if (!bestSlug || normSlug.length > bestSlug.length) {
        bestSlug = normSlug;
      }
    }
  }

  if (bestSlug) {
    return { slug: bestSlug, reason: `Matched project slug '${bestSlug}'` };
  }
  return { slug: null, reason: 'Unmatched' };
}

/**
 * Phase 4B: Queries previously stored metadata from local inventory index (Zero filesystem access)
 */
async function listIndexedFiles(options = {}) {
  if (!isInventoryEnabled()) {
    throw new Error('Local inventory feature is disabled (JARVIS_LOCAL_INVENTORY_ENABLED=false).');
  }

  const filterType = options.filterType ? options.filterType.trim().toLowerCase() : 'recent';
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 15, 1), 100);

  let extension = null;
  if (filterType === 'by_type') {
    if (!options.extension || typeof options.extension !== 'string' || !options.extension.trim()) {
      throw new Error('Extension parameter is required for by_type filter.');
    }
    extension = options.extension.trim().toLowerCase().replace(/^\.+/, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(extension)) {
      throw new Error('Invalid extension format.');
    }
  }

  let projectSlug = null;
  if (filterType === 'project') {
    if (!options.projectSlug || typeof options.projectSlug !== 'string' || !options.projectSlug.trim()) {
      throw new Error('Project slug parameter is required for project filter.');
    }
    projectSlug = options.projectSlug.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_-]+$/.test(projectSlug)) {
      throw new Error('Invalid project slug format.');
    }
  }

  let activeSlugs = [];
  try {
    const projRows = await queryDb("SELECT slug FROM jarvis_projects WHERE status = 'active';");
    activeSlugs = projRows.map(r => r.slug.toLowerCase());
  } catch (err) {}

  if (!activeSlugs.includes('septivolt')) activeSlugs.push('septivolt');
  if (!activeSlugs.includes('cresca-os')) activeSlugs.push('cresca-os');
  if (!activeSlugs.includes('g-g-cleaning')) activeSlugs.push('g-g-cleaning');
  if (!activeSlugs.includes('openclaw')) activeSlugs.push('openclaw');

  let sql = `
    SELECT
      i.id,
      i.folder_id,
      i.file_name,
      i.file_extension,
      i.file_size_bytes,
      i.modified_at,
      i.indexed_at,
      COALESCE(i.relative_path, i.file_path) as relative_path,
      f.safe_alias
    FROM jarvis_local_file_index i
    JOIN jarvis_local_folders f ON i.folder_id = f.id
    WHERE f.status = 'approved'
  `;
  const params = [];

  if (filterType === 'by_type') {
    sql += ` AND LOWER(TRIM(LEADING '.' FROM i.file_extension)) = $1`;
    params.push(extension);
  }

  if (filterType === 'large') {
    sql += ` ORDER BY i.file_size_bytes DESC, i.file_name ASC, i.id ASC`;
  } else {
    sql += ` ORDER BY COALESCE(i.modified_at, i.indexed_at) DESC, i.file_name ASC, i.id ASC`;
  }

  const rawRows = await queryDb(sql, params);
  const workspaceRoot = getWorkspaceRoot();

  const processed = rawRows.map(row => {
    const sanitizedRelPath = sanitizePathForDisplay(row.relative_path, workspaceRoot);
    const matchRes = matchProjectSlug(row.file_name, sanitizedRelPath, activeSlugs);
    return {
      id: row.id,
      safe_alias: row.safe_alias,
      file_name: row.file_name,
      file_extension: (row.file_extension || '').replace(/^\.+/, '').toLowerCase(),
      file_size_bytes: Number(row.file_size_bytes || 0),
      modified_at: row.modified_at || row.indexed_at,
      indexed_at: row.indexed_at,
      relative_path: sanitizedRelPath,
      suggested_project: matchRes.slug,
      match_reason: matchRes.reason
    };
  });

  let filtered = processed;
  if (filterType === 'unmatched') {
    filtered = processed.filter(item => item.suggested_project === null);
  } else if (filterType === 'project') {
    filtered = processed.filter(item => item.suggested_project === projectSlug);
  }

  return filtered.slice(0, limit);
}

/**
 * Deprecated file-level index helper
 */
async function getFileSuggestions() {
  return {
    deprecated: true,
    message: 'File-level inventory indexing has been removed in Phase 4A. Use /jarvis_inventory <approved_alias> to view level-1 folder metadata.'
  };
}

module.exports = {
  isInventoryEnabled,
  getWorkspaceRoot,
  getConfiguredRoots,
  resolveSafeRoot,
  addLocalFolder,
  approveLocalFolder,
  listLocalFolders,
  scanApprovedFolders,
  getFolderInventory,
  revokeLocalFolder,
  getFileSuggestions,
  listIndexedFiles,
  sanitizePathForDisplay,
  matchProjectSlug
};
