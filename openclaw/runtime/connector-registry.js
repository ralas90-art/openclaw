/**
 * OpenClaw Connector Registry (Dry-Run Only)
 */

const fs = require('fs');
const path = require('path');

function getSchemasFilePath() {
  return path.join(__dirname, 'connector-schemas.json');
}

/**
 * Loads the connector schemas.
 * @returns {object}
 */
function _loadSchemas() {
  try {
    const file = getSchemasFilePath();
    if (!fs.existsSync(file)) {
      return {};
    }
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[connector-registry] Failed to load schemas: ${err.message}`);
    return {};
  }
}

/**
 * Returns a list of all connectors with resolved env vars.
 * @returns {object[]}
 */
function listConnectors() {
  const schemas = _loadSchemas();
  return Object.entries(schemas).map(([id, conn]) => {
    const missing = [];
    for (const envVar of conn.requiredEnvVars) {
      if (!process.env[envVar]) {
        missing.push(envVar);
      }
    }
    return {
      connectorId: id,
      name: conn.name,
      status: 'dry_run_only',
      realExecutionEnabled: false,
      supportedDryRunActions: conn.supportedDryRunActions,
      requiredEnvVars: conn.requiredEnvVars,
      missingEnvVars: missing,
      sandboxReady: missing.length === 0,
      notes: conn.notes,
      safetyBoundary: conn.safetyBoundary
    };
  });
}

/**
 * Retrieves a connector by ID.
 * @param {string} connectorId
 * @returns {object|null}
 */
function getConnector(connectorId) {
  if (!connectorId) return null;
  const cleanId = connectorId.trim().toLowerCase();
  const list = listConnectors();
  return list.find(c => c.connectorId === cleanId) || null;
}

/**
 * Checks whether the environment configuration has required env vars.
 * Shape-only check; does not execute any API calls.
 * @param {string} connectorId
 * @returns {object|null}
 */
function validateConnector(connectorId) {
  if (!connectorId) return null;
  const cleanId = connectorId.trim().toLowerCase();
  const conn = getConnector(cleanId);
  if (!conn) return null;

  return {
    valid: conn.sandboxReady,
    requiredEnvVars: conn.requiredEnvVars,
    missingEnvVars: conn.missingEnvVars
  };
}

module.exports = {
  listConnectors,
  getConnector,
  validateConnector
};
