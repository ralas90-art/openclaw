/**
 * OpenClaw Prospect Research Database Store Manager
 */

const fs = require('fs');
const path = require('path');
const { validateResearchRecord } = require('./prospect-research-schema');

let WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../..');

function getStorePath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || WORKSPACE_ROOT;
  return path.join(root, 'openclaw/research/data/prospect_research.json');
}

function ensureStoreExists() {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadResearch() {
  ensureStoreExists();
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    return JSON.parse(raw) || {};
  } catch (err) {
    console.error(`[ProspectResearchStore] Error reading research store, returning empty: ${err.message}`);
    return {};
  }
}

function saveResearch(data) {
  ensureStoreExists();
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getResearchForProspect(prospectId) {
  const db = loadResearch();
  // Find research record that matches prospectId
  const match = Object.values(db).find(r => r.prospectId === prospectId);
  return match || null;
}

function getResearchRecord(researchId) {
  const db = loadResearch();
  return db[researchId] || null;
}

function saveResearchRecord(record) {
  validateResearchRecord(record);
  const db = loadResearch();
  db[record.researchId] = record;
  saveResearch(db);
  return record;
}

function getLatestResearch(limit = 5) {
  const db = loadResearch();
  return Object.values(db)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit);
}

module.exports = {
  loadResearch,
  saveResearch,
  getResearchForProspect,
  getResearchRecord,
  saveResearchRecord,
  getLatestResearch,
  getStorePath
};
