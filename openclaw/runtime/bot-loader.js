/**
 * OpenClaw Bot Prompt & Instructions Loader
 */

const fs = require('fs');
const path = require('path');
const { isBotAllowed } = require('./runtime-allowlist');

/**
 * Resolves the active workspace root.
 * @returns {string}
 */
function isValidRepoRoot(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;
  if (fs.existsSync(path.join(candidate, 'openclaw', 'bots', 'registry.md'))) return true;
  if (fs.existsSync(path.join(candidate, 'server.js')) && fs.existsSync(path.join(candidate, 'package.json'))) return true;
  return false;
}

/**
 * Resolves the active workspace root.
 * @returns {string}
 */
function getWorkspaceRoot() {
  const envRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
  
  if (process.env.OPENCLAW_TEST === 'true') {
    if (envRoot) return path.resolve(envRoot);
    return path.resolve(__dirname, '../..');
  }

  // 1. OPENCLAW_WORKSPACE_ROOT (if valid)
  if (envRoot && isValidRepoRoot(path.resolve(envRoot))) {
    return path.resolve(envRoot);
  }

  // 2. __dirname-derived app root
  const appRoot = path.resolve(__dirname, '../..');
  if (isValidRepoRoot(appRoot)) {
    return appRoot;
  }

  // 3. Hardcoded /app fallback (Railway)
  const railwayRoot = '/app';
  if (isValidRepoRoot(railwayRoot)) {
    return path.resolve(railwayRoot);
  }

  // 4. process.cwd() fallback
  const cwdRoot = process.cwd();
  if (isValidRepoRoot(cwdRoot)) {
    return path.resolve(cwdRoot);
  }

  // Final fallback
  return path.resolve(__dirname, '../..');
}

/**
 * Safely loads BOT.md and workflow specifications.
 * @param {string} botSlug
 * @param {string} [userRequest]
 * @returns {Promise<{ botSlug: string, name: string, botMd: string, workflows: string, fullContext: string }>}
 */
async function loadBotInstructions(botSlug, userRequest = '') {
  if (!botSlug) {
    throw new Error('Bot slug is required.');
  }

  // 1. Path traversal and sanitization security checks
  const sanitized = botSlug.trim().toLowerCase();
  if (sanitized.includes('/') || sanitized.includes('\\') || sanitized.includes('..')) {
    throw new Error('Security block: Path traversal or invalid characters detected in bot slug.');
  }

  // 2. Validate against allowlist
  if (!isBotAllowed(sanitized)) {
    throw new Error(`Security block: Bot '${botSlug}' is not runtime-enabled.`);
  }

  const workspaceRoot = getWorkspaceRoot();
  const botDir = path.join(workspaceRoot, 'openclaw', 'bots', sanitized);
  
  if (!fs.existsSync(botDir)) {
    throw new Error(`Bot directory not found for: ${sanitized}`);
  }

  // 3. Read main BOT.md file
  const botMdPath = path.join(botDir, 'BOT.md');
  let botMdContent = '';
  if (fs.existsSync(botMdPath)) {
    botMdContent = fs.readFileSync(botMdPath, 'utf8');
  } else {
    throw new Error(`BOT.md file missing for: ${sanitized}`);
  }

  // Parse bot name from BOT.md frontmatter (if present)
  let botName = botSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const nameMatch = botMdContent.match(/name:\s*([^\r\n]+)/i);
  if (nameMatch) {
    botName = nameMatch[1].trim();
  }

  // 4. Read workflow markdown files
  let workflowsContent = '';
  const workflowsDir = path.join(botDir, 'workflows');
  if (fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()) {
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md')).slice(0, 15);
    
    let matchedFile = null;
    if (files.length === 1) {
      matchedFile = files[0];
    } else if (files.length > 1 && userRequest) {
      const normalizedRequest = userRequest.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const file of files) {
        const slug = file.replace('.md', '').toLowerCase();
        const cleanSlug = slug.replace(/[^a-z0-9]/g, '');
        if (normalizedRequest.includes(cleanSlug) || 
            userRequest.toLowerCase().includes(slug) || 
            userRequest.toLowerCase().includes(slug.replace(/-/g, '_')) ||
            userRequest.toLowerCase().includes(slug.replace(/-/g, ' '))) {
          matchedFile = file;
          break;
        }
      }
    }

    if (matchedFile) {
      try {
        const filePath = path.join(workflowsDir, matchedFile);
        // Enforce a maximum file size cap (e.g. read first 50KB only)
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(50000);
        const bytesRead = fs.readSync(fd, buffer, 0, 50000, 0);
        fs.closeSync(fd);
        const fileContent = buffer.toString('utf8', 0, bytesRead);
        workflowsContent = `\n### Active Workflow Instructions (${matchedFile})\n${fileContent}\n`;
      } catch (err) {
        console.error(`[bot-loader] Failed to read workflow file ${matchedFile}:`, err.message);
      }
    } else if (files.length > 0) {
      const list = files.map(f => `- ${f.replace('.md', '')}`).join('\n');
      workflowsContent = `\n### Available Workflows\n${list}\n\n(Select one of the above workflows by referencing its name in your request.)\n`;
    }
  }

  const fullContext = [
    `# Bot Identity: ${botName}`,
    `Slug: ${sanitized}`,
    '',
    `## Bot Profile`,
    botMdContent,
    '',
    `## Workflows & Instructions`,
    workflowsContent || 'No specialized workflows configured.'
  ].join('\n');

  return {
    botSlug: sanitized,
    name: botName,
    botMd: botMdContent,
    workflows: workflowsContent,
    fullContext
  };
}

module.exports = {
  getWorkspaceRoot,
  loadBotInstructions
};
