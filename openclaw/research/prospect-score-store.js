/**
 * OpenClaw Prospect Scores Database Store Manager
 */

const fs = require('fs');
const path = require('path');
const { validateScoreRecord } = require('./prospect-score-schema');

let WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../..');

function getStorePath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || WORKSPACE_ROOT;
  return path.join(root, 'openclaw/research/data/prospect_scores.json');
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

function loadScores() {
  ensureStoreExists();
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    return JSON.parse(raw) || {};
  } catch (err) {
    console.error(`[ProspectScoreStore] Error reading score store, returning empty: ${err.message}`);
    return {};
  }
}

function saveScores(data) {
  ensureStoreExists();
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf8');
}

function getScoreForProspect(prospectId) {
  const db = loadScores();
  const match = Object.values(db).find(s => s.prospectId === prospectId);
  return match || null;
}

function getScoreRecord(scoreId) {
  const db = loadScores();
  return db[scoreId] || null;
}

function saveScoreRecord(record) {
  validateScoreRecord(record);
  const db = loadScores();
  db[record.scoreId] = record;
  saveScores(db);
  return record;
}

function getLatestScores(limit = 5) {
  const db = loadScores();
  return Object.values(db)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit);
}

function getTopScores(limit = 5) {
  const db = loadScores();
  return Object.values(db)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, limit);
}

module.exports = {
  loadScores,
  saveScores,
  getScoreForProspect,
  getScoreRecord,
  saveScoreRecord,
  getLatestScores,
  getTopScores,
  getStorePath
};
