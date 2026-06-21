const fs = require('fs');
const path = require('path');
const { validateProspect } = require('./prospect-schema');

const DATA_DIR = path.resolve(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'prospects.json');

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify([]), 'utf8');
  }
}

function loadProspects() {
  ensureDataDirectory();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw) || [];
  } catch (err) {
    console.error(`[ProspectStore] Error reading prospects file, returning empty array: ${err.message}`);
    return [];
  }
}

function saveProspects(prospects) {
  ensureDataDirectory();
  fs.writeFileSync(STORE_PATH, JSON.stringify(prospects, null, 2), 'utf8');
}

function addProspects(newProspects) {
  if (!Array.isArray(newProspects)) {
    newProspects = [newProspects];
  }

  const existing = loadProspects();
  const existingMap = new Map(existing.map(p => [p.placeId, p]));
  let addedCount = 0;

  for (const prospect of newProspects) {
    validateProspect(prospect);
    if (!existingMap.has(prospect.placeId)) {
      existing.push(prospect);
      existingMap.set(prospect.placeId, prospect);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    saveProspects(existing);
  }

  return addedCount;
}

module.exports = {
  loadProspects,
  saveProspects,
  addProspects,
  STORE_PATH
};
