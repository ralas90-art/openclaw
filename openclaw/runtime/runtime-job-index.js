/**
 * OpenClaw Runtime Job Index & Search System
 */

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./bot-loader');
const { isValidRuntimeJobId } = require('./runtime-job-id');

/**
 * Returns the path to the job index file.
 * @returns {string}
 */
function getIndexFilePath() {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, 'openclaw', 'runtime', 'logs', 'runtime-job-index.json');
}

/**
 * Loads the runtime job index.
 * @returns {object}
 */
function loadJobIndex() {
  try {
    const file = getIndexFilePath();
    if (!fs.existsSync(file)) {
      return {};
    }
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[runtime-job-index] Failed to load job index: ${err.message}`);
    return {};
  }
}

/**
 * Saves the runtime job index.
 * @param {object} index
 * @returns {boolean}
 */
function saveJobIndex(index) {
  try {
    const file = getIndexFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(index, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn(`[runtime-job-index] Failed to save job index: ${err.message}`);
    return false;
  }
}

/**
 * Extracts a clean summary preview from the result markdown file.
 * @param {string} filePath
 * @returns {string|null}
 */
function extractSummaryFromMarkdownFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/## Summary\r?\n([\s\S]*?)(?=\r?\n##|$)/);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Updates the job index from a logged runtime event.
 * Safeguarded: never throws exceptions.
 * @param {object} event
 */
function updateJobIndexFromEvent(event) {
  try {
    if (!event || !event.jobId || !isValidRuntimeJobId(event.jobId)) {
      return;
    }
    const jobId = event.jobId;
    const index = loadJobIndex();

    if (!index[jobId]) {
      index[jobId] = {
        jobId: jobId,
        command: event.command || null,
        botSlug: event.botSlug || null,
        presetId: event.presetId || null,
        status: event.status || 'unknown',
        filename: event.filename || null,
        driveLink: event.driveLink || null,
        published: event.published !== undefined ? event.published : false,
        created: event.timestamp || new Date().toISOString(),
        lastUpdated: event.timestamp || new Date().toISOString(),
        summaryPreview: null,
        errorCategory: event.errorCategory || null
      };
    } else {
      const existing = index[jobId];
      if (event.command) existing.command = event.command;
      if (event.botSlug) existing.botSlug = event.botSlug;
      if (event.presetId) existing.presetId = event.presetId;
      if (event.status) existing.status = event.status;
      if (event.filename) existing.filename = event.filename;
      if (event.driveLink) {
        existing.driveLink = event.driveLink;
        existing.published = true;
      }
      if (event.published !== undefined) {
        existing.published = event.published;
      }
      if (event.publishStatus === 'published' || event.publishStatus === 'already_published') {
        existing.published = true;
      }
      if (event.errorCategory) existing.errorCategory = event.errorCategory;
      existing.lastUpdated = event.timestamp || new Date().toISOString();
    }

    const existing = index[jobId];
    if (!existing.summaryPreview && existing.filename) {
      const workspaceRoot = getWorkspaceRoot();
      const filePath = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses', existing.filename);
      existing.summaryPreview = extractSummaryFromMarkdownFile(filePath);
    }

    saveJobIndex(index);
  } catch (err) {
    console.warn(`[runtime-job-index] Failed to update job index from event: ${err.message}`);
  }
}

/**
 * Rebuilds the job index by scanning log files and responses directory.
 * @returns {object} Statistics about the reindexing operation.
 */
function rebuildJobIndex() {
  const stats = {
    jobsIndexed: 0,
    eventsScanned: 0,
    resultFilesScanned: 0,
    errorsSkipped: 0,
    timestamp: new Date().toISOString()
  };

  try {
    const index = {};
    const workspaceRoot = getWorkspaceRoot();

    // 1. Scan runtime-events.jsonl
    const logFilePath = path.join(workspaceRoot, 'openclaw', 'runtime', 'logs', 'runtime-events.jsonl');
    if (fs.existsSync(logFilePath)) {
      const content = fs.readFileSync(logFilePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim() !== '');
      stats.eventsScanned = lines.length;

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event && event.jobId) {
            if (!isValidRuntimeJobId(event.jobId)) {
              stats.errorsSkipped++;
              continue;
            }
            const jobId = event.jobId;
            if (!index[jobId]) {
              index[jobId] = {
                jobId: jobId,
                command: event.command || null,
                botSlug: event.botSlug || null,
                presetId: event.presetId || null,
                status: event.status || 'unknown',
                filename: event.filename || null,
                driveLink: event.driveLink || null,
                published: event.published !== undefined ? event.published : false,
                created: event.timestamp || stats.timestamp,
                lastUpdated: event.timestamp || stats.timestamp,
                summaryPreview: null,
                errorCategory: event.errorCategory || null
              };
            } else {
              const existing = index[jobId];
              if (event.command) existing.command = event.command;
              if (event.botSlug) existing.botSlug = event.botSlug;
              if (event.presetId) existing.presetId = event.presetId;
              if (event.status) existing.status = event.status;
              if (event.filename) existing.filename = event.filename;
              if (event.driveLink) {
                existing.driveLink = event.driveLink;
                existing.published = true;
              }
              if (event.published !== undefined) {
                existing.published = event.published;
              }
              if (event.publishStatus === 'published' || event.publishStatus === 'already_published') {
                existing.published = true;
              }
              if (event.errorCategory) existing.errorCategory = event.errorCategory;
              existing.lastUpdated = event.timestamp || existing.lastUpdated;
            }
          }
        } catch (e) {
          stats.errorsSkipped++;
        }
      }
    }

    // 2. Scan responses directory
    const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
    if (fs.existsSync(responsesDir)) {
      const files = fs.readdirSync(responsesDir).filter(f => f.endsWith('_runtime_result.md'));
      stats.resultFilesScanned = files.length;

      for (const f of files) {
        try {
          const filePath = path.join(responsesDir, f);
          const content = fs.readFileSync(filePath, 'utf8');
          const jobMatch = content.match(/## Job ID\r?\n(rt_[a-zA-Z0-9_]+)/);
          if (jobMatch) {
            const jobId = jobMatch[1];
            if (!isValidRuntimeJobId(jobId)) {
              stats.errorsSkipped++;
              continue;
            }

            const summary = extractSummaryFromMarkdownFile(filePath);
            const botMatch = content.match(/## Bot Used\r?\n([^\s(]+)/);
            const extBotSlug = botMatch ? botMatch[1].trim() : null;

            const presetMatch = content.match(/## Preset Used\r?\n([a-zA-Z0-9_-]+)/);
            const extPresetId = presetMatch ? presetMatch[1].trim() : null;

            if (!index[jobId]) {
              index[jobId] = {
                jobId: jobId,
                command: extPresetId ? 'run_preset' : 'run_bot',
                botSlug: extBotSlug || 'unknown',
                presetId: extPresetId,
                status: 'success',
                filename: f,
                driveLink: null,
                published: false,
                created: stats.timestamp,
                lastUpdated: stats.timestamp,
                summaryPreview: summary,
                errorCategory: null
              };
            } else {
              const existing = index[jobId];
              existing.filename = f;
              existing.summaryPreview = summary;
              if (extBotSlug && !existing.botSlug) {
                existing.botSlug = extBotSlug;
              }
              if (extPresetId && !existing.presetId) {
                existing.presetId = extPresetId;
              }
            }
          }
        } catch (e) {
          stats.errorsSkipped++;
        }
      }
    }

    // 3. Scan Google Drive Sync manifests
    const syncDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'google-drive-sync');
    if (fs.existsSync(syncDir)) {
      const files = fs.readdirSync(syncDir).filter(f => f.startsWith('publish_manifest_') && f.endsWith('.json'));
      for (const f of files) {
        try {
          const filePath = path.join(syncDir, f);
          const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (manifest && manifest.jobId && isValidRuntimeJobId(manifest.jobId)) {
            const jobId = manifest.jobId;
            const existing = index[jobId];
            if (existing) {
              if (manifest.status === 'published') {
                existing.published = true;
                existing.driveLink = manifest.drive_web_url || manifest.drive_local_path || existing.driveLink;
              }
            }
          }
        } catch (e) {}
      }
    }

    saveJobIndex(index);
    stats.jobsIndexed = Object.keys(index).length;

  } catch (err) {
    console.warn(`[runtime-job-index] Failed to rebuild job index: ${err.message}`);
  }

  return stats;
}

/**
 * Searches index matching query keyword.
 * @param {string} query
 * @param {number} limit
 * @returns {object[]}
 */
function searchJobs(query, limit = 5) {
  if (typeof query !== 'string') return [];
  
  let sanitized = query.replace(/[^\w\s-]/g, '').trim().toLowerCase();
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  
  if (!sanitized) return [];

  const index = loadJobIndex();
  const jobs = Object.values(index);

  const matches = jobs.filter(job => {
    const fieldsToSearch = [
      job.jobId,
      job.botSlug,
      job.presetId,
      job.command,
      job.filename,
      job.summaryPreview,
      job.status,
      job.errorCategory
    ];
    return fieldsToSearch.some(field => 
      field && String(field).toLowerCase().includes(sanitized)
    );
  });

  matches.sort((a, b) => {
    const timeA = new Date(a.created || a.lastUpdated || 0).getTime();
    const timeB = new Date(b.created || b.lastUpdated || 0).getTime();
    return timeB - timeA;
  });

  return matches.slice(0, limit);
}

/**
 * Queries jobs matching bot slug.
 * @param {string} botSlug
 * @param {number} limit
 * @returns {object[]}
 */
function getJobsByBot(botSlug, limit = 5) {
  if (typeof botSlug !== 'string') return [];
  const cleanSlug = botSlug.trim().toLowerCase();

  const index = loadJobIndex();
  const jobs = Object.values(index);

  const matches = jobs.filter(job => 
    job.botSlug && job.botSlug.trim().toLowerCase() === cleanSlug
  );

  matches.sort((a, b) => {
    const timeA = new Date(a.created || a.lastUpdated || 0).getTime();
    const timeB = new Date(b.created || b.lastUpdated || 0).getTime();
    return timeB - timeA;
  });

  return matches.slice(0, limit);
}

module.exports = {
  loadJobIndex,
  saveJobIndex,
  updateJobIndexFromEvent,
  rebuildJobIndex,
  searchJobs,
  getJobsByBot
};
