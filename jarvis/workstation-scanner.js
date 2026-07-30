/**
 * Jarvis Workstation Filesystem Scanner — Phase 4C.4
 *
 * Standalone workstation traversal module.
 * Executes metadata-only directory scanning on local workstation approved roots.
 *
 * Safety Constraints:
 * - Strictly ZERO database imports (no jarvis/db, no pg, no SQL).
 * - Zero content reading (fs.readdirSync, fs.statSync, fs.lstatSync, fs.realpathSync only).
 * - Skips symlinks, junctions, reparse points, dotfiles, and sensitive credential files.
 * - Resolves local aliases exclusively from workstation environment configuration.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORE_RECURSIVE_DIRECTORIES = [
  '.git', 'node_modules', '.gemini', 'dist', 'build', 'tmp', '.cache',
  '.vscode', '.idea', '__pycache__', 'coverage', '.next', '.astro'
];
const MAX_RECURSIVE_DEPTH = 10;
const MAX_RECURSIVE_ENTRIES = 5000;
const MAX_RELATIVE_PATH_LENGTH = 500;
const MAX_CHILD_FOLDERS = 100;

const SENSITIVE_FILE_PATTERNS = [
  /^credentials(\..+)?\.json$/i,
  /^service[-_]account.*\.json$/i,
  /^client[-_]secret.*\.json$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /\.(pem|key|p12|pfx|keystore|jks|kdb|crt|cer|der|ovpn)$/i
];

function isSensitiveCredentialFile(filename) {
  if (!filename || typeof filename !== 'string') return true;
  const baseName = path.basename(filename);
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(baseName));
}

function getWorkstationRoots() {
  const jsonStr = process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON;
  if (!jsonStr) return {};
  try {
    const parsed = JSON.parse(jsonStr);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    return {};
  }
}

function resolveLocalRootPath(alias) {
  if (!alias || typeof alias !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(alias)) {
    throw new Error(`Invalid root alias '${alias}'.`);
  }

  const roots = getWorkstationRoots();
  const relPath = roots[alias];
  if (!relPath || typeof relPath !== 'string') {
    throw new Error(`Unknown local inventory root alias '${alias}'.`);
  }

  if (relPath.includes('\0') || relPath.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`Invalid root configuration for alias '${alias}'.`);
  }

  const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../');
  const targetPath = path.resolve(workspaceRoot, relPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Local root path for alias '${alias}' does not exist.`);
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Local root path for alias '${alias}' is not a directory.`);
  }

  const canonicalWorkspace = fs.realpathSync(workspaceRoot);
  const canonicalTarget = fs.realpathSync(targetPath);

  const isContained = canonicalTarget === canonicalWorkspace || canonicalTarget.startsWith(canonicalWorkspace + path.sep);
  if (!isContained) {
    throw new Error(`Security Exception: Local root for alias '${alias}' is outside workspace boundary.`);
  }

  const fingerprint = crypto.createHash('sha256').update(canonicalTarget).digest('hex');
  return { alias, canonicalPath: canonicalTarget, fingerprint };
}

function scanWorkstationRootLevel1(alias) {
  const { canonicalPath, fingerprint } = resolveLocalRootPath(alias);
  const dirents = fs.readdirSync(canonicalPath, { withFileTypes: true });

  const childFolders = [];
  const childFiles = [];

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue;
    if (dirent.name.startsWith('.')) continue;
    if (IGNORE_RECURSIVE_DIRECTORIES.includes(dirent.name)) continue;

    if (dirent.isDirectory()) {
      childFolders.push(dirent.name);
    } else if (dirent.isFile()) {
      if (isSensitiveCredentialFile(dirent.name)) continue;
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
    throw new Error(`Scan aborted: Root alias '${alias}' contains too many child directories (${childFolders.length}).`);
  }

  return {
    alias,
    fingerprint,
    foldersIndexed: childFolders.length,
    filesIndexed: childFiles.length,
    folders: childFolders,
    files: childFiles
  };
}

function scanWorkstationRootRecursive(alias) {
  const { canonicalPath, fingerprint } = resolveLocalRootPath(alias);
  const workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../');
  const canonicalWorkspace = fs.realpathSync(workspaceRoot);

  const collectedFiles = [];
  let totalExaminedEntries = 0;

  function traverse(currentDir, currentDepth) {
    if (currentDepth > MAX_RECURSIVE_DEPTH) {
      throw new Error(`Maximum recursion depth of ${MAX_RECURSIVE_DEPTH} exceeded for root alias '${alias}'.`);
    }

    const dirents = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const dirent of dirents) {
      totalExaminedEntries++;
      if (totalExaminedEntries > MAX_RECURSIVE_ENTRIES) {
        throw new Error(`Examined entry limit of ${MAX_RECURSIVE_ENTRIES} exceeded for root alias '${alias}'.`);
      }

      if (dirent.isSymbolicLink()) continue;
      const entryName = dirent.name;

      if (entryName.startsWith('.')) continue;
      if (isSensitiveCredentialFile(entryName)) continue;
      if (dirent.isDirectory() && IGNORE_RECURSIVE_DIRECTORIES.includes(entryName.toLowerCase())) continue;

      const fullPath = path.join(currentDir, entryName);
      let realPath;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch (err) {
        continue;
      }

      const isContained = realPath === canonicalWorkspace || realPath.startsWith(canonicalWorkspace + path.sep);
      if (!isContained) {
        throw new Error(`Security Exception: Target '${entryName}' resolves outside workspace boundary.`);
      }

      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) continue;
      } catch (err) {
        continue;
      }

      const relFromRoot = path.relative(canonicalPath, realPath).replace(/\\/g, '/');
      if (relFromRoot.includes('\0') || relFromRoot.includes('..') || /[\x00-\x1F\x7F]/.test(relFromRoot)) continue;
      if (relFromRoot.length > MAX_RELATIVE_PATH_LENGTH) continue;

      if (dirent.isDirectory()) {
        traverse(realPath, currentDepth + 1);
      } else if (dirent.isFile()) {
        try {
          const stat = fs.statSync(realPath);
          const ext = path.extname(entryName).replace(/^\.+/, '').toLowerCase();
          collectedFiles.push({
            name: entryName,
            extension: ext,
            size: stat.size,
            mtime: stat.mtime,
            relativePath: relFromRoot,
            depth: currentDepth
          });
        } catch (err) {}
      }
    }
  }

  traverse(canonicalPath, 1);

  return {
    alias,
    fingerprint,
    filesIndexed: collectedFiles.length,
    totalExamined: totalExaminedEntries,
    files: collectedFiles
  };
}

module.exports = {
  isSensitiveCredentialFile,
  getWorkstationRoots,
  resolveLocalRootPath,
  scanWorkstationRootLevel1,
  scanWorkstationRootRecursive
};
