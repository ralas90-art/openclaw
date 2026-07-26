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
  let sql = "SELECT id, safe_alias, status, root_fingerprint, approved_by, approved_at, last_scanned_at, created_at, updated_at FROM jarvis_local_folders";
  let params = [];

  if (cleanFilter === 'pending' || cleanFilter === 'approved' || cleanFilter === 'revoked') {
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

    for (const dirent of dirents) {
      // 1. Skip symlinks
      if (dirent.isSymbolicLink()) continue;

      // 2. Ignore non-directories (files strictly ignored!)
      if (!dirent.isDirectory()) continue;

      // 3. Skip ignored system directories
      if (IGNORE_DIRECTORIES.includes(dirent.name)) continue;

      childFolders.push(dirent.name);
    }

    if (childFolders.length > MAX_CHILD_FOLDERS) {
      throw new Error(`Scan aborted: Root alias '${alias}' contains ${childFolders.length} child directories, exceeding maximum limit of ${MAX_CHILD_FOLDERS}.`);
    }

    // Persist Level-1 child inventory in a database transaction
    await withTransaction(async (client) => {
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

      // 2. Mark missing folders inactive
      if (childFolders.length > 0) {
        await client.query(
          `UPDATE jarvis_level1_folder_inventory
           SET status = 'inactive'
           WHERE root_alias = $1 AND NOT (relative_path = ANY($2::text[]));`,
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

      // 3. Update last_scanned_at on root record
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

  const rows = await queryDb(
    `UPDATE jarvis_local_folders
     SET status = 'revoked', updated_at = NOW()
     WHERE safe_alias = $1
     RETURNING id, safe_alias, status, root_fingerprint, updated_at;`,
    [alias]
  );

  if (rows.length === 0) {
    throw new Error(`Root alias '${alias}' not found.`);
  }

  // Audit event
  try {
    await queryDb(
      `INSERT INTO jarvis_audit_logs (actor, action, payload)
       VALUES ($1, $2, $3);`,
      [actor, 'revoke_level1_inventory_root', JSON.stringify({ root_alias: alias, outcome: 'revoked' })]
    );
  } catch (err) {}

  return rows[0];
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
  getFileSuggestions
};
