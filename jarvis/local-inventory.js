/**
 * Jarvis Local File Inventory
 * Implements Phase 4: Local File Inventory with Manual Folder Approval
 * 
 * NOTE: Jarvis scan sync may remove stale database index records for files that no longer exist locally,
 * but it never deletes, moves, renames, opens, or modifies local files.
 */

const fs = require('fs');
const path = require('path');
const { queryDb } = require('./controller');

/**
 * Ensures required local folders and indexing tables exist in database
 */
async function ensureTablesExist() {
  // Schema and migrations are initialized on server boot by jarvis/migrations.js
  return true;
}

/**
 * Registers a folder path to the local inventory (starts as approved = false)
 */
async function addLocalFolder(folderPath) {
  await ensureTablesExist();
  if (!folderPath) {
    throw new Error('Folder path is required.');
  }

  const resolvedPath = path.resolve(folderPath).replace(/\\/g, '/');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Path '${folderPath}' does not exist.`);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path '${folderPath}' is not a directory.`);
  }

  console.log(`[LocalInventory] Registering folder: ${resolvedPath}`);
  const rows = await queryDb(
    `INSERT INTO jarvis_local_folders (folder_path, approved)
     VALUES ($1, false)
     ON CONFLICT (folder_path) DO UPDATE SET folder_path = EXCLUDED.folder_path
     RETURNING *;`,
    [resolvedPath]
  );
  return rows[0];
}

/**
 * Approves a registered folder path by ID or path string
 */
async function approveLocalFolder(idOrPath) {
  await ensureTablesExist();
  if (!idOrPath) {
    throw new Error('Folder ID or path is required.');
  }

  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  let sql = "UPDATE jarvis_local_folders SET approved = true WHERE ";
  let params = [];

  if (uuidRegex.test(idOrPath)) {
    sql += "id = $1 RETURNING *;";
    params = [idOrPath];
  } else {
    const resolvedPath = path.resolve(idOrPath).replace(/\\/g, '/');
    sql += "folder_path = $1 RETURNING *;";
    params = [resolvedPath];
  }

  console.log(`[LocalInventory] Approving folder ${idOrPath}...`);
  const rows = await queryDb(sql, params);
  if (rows.length === 0) {
    throw new Error(`Folder '${idOrPath}' not found in registry.`);
  }
  return rows[0];
}

/**
 * Lists all registered local folders
 */
async function listLocalFolders(filter = null) {
  await ensureTablesExist();
  const cleanFilter = filter ? filter.trim().toLowerCase() : null;
  console.log(`[LocalInventory] Listing registered local folders with filter: ${cleanFilter}...`);
  
  if (cleanFilter === 'pending') {
    return await queryDb("SELECT * FROM jarvis_local_folders WHERE approved = false ORDER BY created_at DESC;");
  } else if (cleanFilter === 'approved') {
    return await queryDb("SELECT * FROM jarvis_local_folders WHERE approved = true ORDER BY created_at DESC;");
  }
  
  return await queryDb("SELECT * FROM jarvis_local_folders ORDER BY created_at DESC;");
}

/**
 * Helper to recursively walk directories (read-only)
 */
function walkDir(dir, depth, maxDepth, fileList, folderLimit, globalLimit, totalGlobalFiles) {
  if (depth > maxDepth) return;
  if (fileList.length >= folderLimit) return;
  if (totalGlobalFiles.count >= globalLimit) return;

  let items;
  try {
    items = fs.readdirSync(dir);
  } catch (err) {
    console.warn(`[LocalInventory] Failed to read directory ${dir}: ${err.message}`);
    return;
  }

  const ignoreList = ['.git', 'node_modules', '.gemini', 'dist', 'build', 'tmp', '.cache'];

  for (const item of items) {
    if (ignoreList.includes(item)) continue;
    if (fileList.length >= folderLimit) break;
    if (totalGlobalFiles.count >= globalLimit) break;

    const fullPath = path.join(dir, item).replace(/\\/g, '/');
    let stat;
    try {
      // Use lstatSync to detect symbolic links
      stat = fs.lstatSync(fullPath);
    } catch (err) {
      console.warn(`[LocalInventory] Failed to stat file ${fullPath}: ${err.message}`);
      continue;
    }

    // Never follow symbolic links
    if (stat.isSymbolicLink()) {
      console.log(`[LocalInventory] Skipping symbolic link: ${fullPath}`);
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, depth + 1, maxDepth, fileList, folderLimit, globalLimit, totalGlobalFiles);
    } else if (stat.isFile()) {
      fileList.push({
        file_path: fullPath,
        file_name: item,
        size_bytes: stat.size,
        extension: path.extname(item),
        last_modified: stat.mtime
      });
      totalGlobalFiles.count++;
    }
  }
}

/**
 * Scans all approved folders and indexes file metadata
 */
async function scanApprovedFolders() {
  await ensureTablesExist();
  console.log('[LocalInventory] Scanning approved folders...');
  const folders = await queryDb("SELECT * FROM jarvis_local_folders WHERE approved = true;");
  
  let foldersScanned = 0;
  let filesIndexed = 0;
  let filesRemoved = 0;
  const totalGlobalFiles = { count: 0 };

  for (const folder of folders) {
    const folderPath = folder.folder_path;
    if (!fs.existsSync(folderPath)) {
      console.warn(`[LocalInventory] Approved folder path does not exist: ${folderPath}`);
      continue;
    }

    foldersScanned++;
    const fileList = [];
    // depth 1, maxDepth 5, fileList, folderLimit 250, globalLimit 1000, totalGlobalFiles
    walkDir(folderPath, 1, 5, fileList, 250, 1000, totalGlobalFiles);

    const scannedPaths = [];
    for (const f of fileList) {
      scannedPaths.push(f.file_path);
      await queryDb(
        `INSERT INTO jarvis_local_file_index (folder_id, file_path, file_name, size_bytes, extension, last_modified)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (file_path) DO UPDATE SET
           file_name = EXCLUDED.file_name,
           size_bytes = EXCLUDED.size_bytes,
           extension = EXCLUDED.extension,
           last_modified = EXCLUDED.last_modified;`,
        [folder.id, f.file_path, f.file_name, f.size_bytes, f.extension, f.last_modified]
      );
      filesIndexed++;
    }

    // Clean up files that are no longer in this directory
    let deletedCount = 0;
    if (scannedPaths.length > 0) {
      const delRows = await queryDb(
        `DELETE FROM jarvis_local_file_index WHERE folder_id = $1 AND NOT (file_path = ANY($2::text[])) RETURNING id;`,
        [folder.id, scannedPaths]
      );
      deletedCount = delRows.length;
    } else {
      const delRows = await queryDb(
        `DELETE FROM jarvis_local_file_index WHERE folder_id = $1 RETURNING id;`,
        [folder.id]
      );
      deletedCount = delRows.length;
    }
    filesRemoved += deletedCount;
  }

  return {
    foldersScanned,
    filesIndexed,
    filesRemoved
  };
}

/**
 * Gets files in index, mapping them to potential active project slugs
 */
async function getFileSuggestions(filter = null, arg = null) {
  await ensureTablesExist();
  const cleanFilter = filter ? filter.trim().toLowerCase() : null;
  const cleanArg = arg ? arg.trim().toLowerCase() : null;
  console.log(`[LocalInventory] Getting file suggestions with filter: ${cleanFilter}, arg: ${cleanArg}...`);

  // Fetch active project slugs
  const projects = await queryDb("SELECT slug, name FROM jarvis_projects WHERE status = 'active';");
  const projectSlugs = projects.map(p => p.slug);

  let files = [];
  let useInMemoryFiltering = true;

  if (cleanFilter === 'recent') {
    files = await queryDb("SELECT * FROM jarvis_local_file_index ORDER BY last_modified DESC LIMIT 15;");
    useInMemoryFiltering = false;
  } else if (cleanFilter === 'large') {
    files = await queryDb("SELECT * FROM jarvis_local_file_index ORDER BY size_bytes DESC LIMIT 15;");
    useInMemoryFiltering = false;
  } else if (cleanFilter === 'by_type') {
    let ext = cleanArg || '';
    if (ext && !ext.startsWith('.')) {
      ext = '.' + ext;
    }
    files = await queryDb("SELECT * FROM jarvis_local_file_index WHERE LOWER(extension) = $1 ORDER BY file_name ASC LIMIT 50;", [ext]);
    useInMemoryFiltering = false;
  } else {
    files = await queryDb("SELECT * FROM jarvis_local_file_index ORDER BY file_name ASC;");
  }

  const suggestions = [];
  for (const f of files) {
    const nameLower = f.file_name.toLowerCase();
    const pathLower = f.file_path.toLowerCase();
    
    // Check match against active projects
    let matchedSlug = null;
    for (const slug of projectSlugs) {
      if (nameLower.includes(slug) || pathLower.includes('/' + slug + '/')) {
        matchedSlug = slug;
        break;
      }
    }

    if (useInMemoryFiltering) {
      if (cleanFilter === 'unmatched') {
        if (matchedSlug !== null) {
          continue;
        }
      } else if (cleanFilter === 'project') {
        if (matchedSlug !== cleanArg) {
          continue;
        }
      } else if (cleanFilter) {
        if (matchedSlug !== cleanFilter) {
          continue;
        }
      }
    }

    suggestions.push({
      id: f.id,
      file_path: f.file_path,
      file_name: f.file_name,
      size_bytes: parseInt(f.size_bytes),
      extension: f.extension,
      last_modified: f.last_modified,
      suggested_project: matchedSlug,
      reason: matchedSlug ? `Filename or path contains active project slug '${matchedSlug}'` : 'No active project slug matched'
    });
  }

  return suggestions;
}

module.exports = {
  addLocalFolder,
  approveLocalFolder,
  listLocalFolders,
  scanApprovedFolders,
  getFileSuggestions
};
