/**
 * OpenClaw Hermes Web Dashboard Express Router
 */

const express = require('express');
const router = express.Router();
router.use(express.urlencoded({ extended: true }));

const engine = require('../hermes/hermes-queue-engine');
const obs = require('../hermes/hermes-observability');
const search = require('../hermes/hermes-search');
const usage = require('../usage/llm-usage-ledger');
const analytics = require('../usage/llm-usage-analytics');
const dailyBrief = require('../hermes/hermes-daily-brief');
const fs = require('fs');
const path = require('path');

const audit = require('./dashboard-action-audit');
const dispatcher = require('../hermes/runtime-dispatcher-adapter');
const roles = require('../runtime/runtime-roles');
const tgHandlers = require('../../interfaces/telegram/handlers');

// Helper to get an authorized chat ID for Telegram/Runtime roles
function getAuthorizedChatId() {
  const currentRoles = roles.loadRuntimeRoles();
  if (currentRoles.super_admin && currentRoles.super_admin.length > 0) {
    return currentRoles.super_admin[0];
  }
  const config = require('../runtime/runtime-config');
  if (config.allowedChatIds && config.allowedChatIds.length > 0) {
    return config.allowedChatIds[0];
  }
  return 'dashboard_admin';
}

// Emergency Switch: Disable Dashboard entirely
router.use((req, res, next) => {
  const enabled = process.env.DASHBOARD_ENABLED !== 'false';
  if (!enabled) {
    return res.status(403).send('Hermes Dashboard is disabled by administration policy.');
  }
  next();
});

// Security Headers Middleware
router.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:;");
  next();
});

// Nonce Storage System (CSRF / Replay protection)
const nonces = new Map(); // nonce -> { bindingKey, expiresAt }

function getNonceBindingKey(action, targetId, token) {
  const crypto = require('crypto');
  const tokenHash = crypto.createHash('sha256').update(token || '').digest('hex').substring(0, 16);
  return `${action}:${targetId}:${tokenHash}`;
}

function generateNonce(action, targetId, token) {
  const crypto = require('crypto');
  const nonce = crypto.randomBytes(16).toString('hex');
  const ttl = parseInt(process.env.DASHBOARD_ACTION_NONCE_TTL_SECONDS, 10) || 300;
  const expiresAt = Date.now() + ttl * 1000;
  const bindingKey = getNonceBindingKey(action, targetId, token);
  nonces.set(nonce, { bindingKey, expiresAt });
  return nonce;
}

function verifyAndConsumeNonce(nonce, action, targetId, token) {
  if (!nonce) return false;
  const record = nonces.get(nonce);
  if (!record) return false;
  
  nonces.delete(nonce); // Consume immediately (one-time use)
  
  const expectedBindingKey = getNonceBindingKey(action, targetId, token);
  if (record.bindingKey !== expectedBindingKey) return false;
  if (Date.now() > record.expiresAt) return false;
  
  return true;
}

// In-memory Rate Limiter
const rateLimitWindowMs = 60 * 1000; // 1 minute
const ipRequestHistory = new Map(); // ip -> [timestamps]

function rateLimitMiddleware(req, res, next) {
  const limit = parseInt(process.env.DASHBOARD_RATE_LIMIT_PER_MINUTE, 10) || 20;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  let timestamps = ipRequestHistory.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < rateLimitWindowMs);
  
  if (timestamps.length >= limit) {
    audit.logDashboardAction({
      actionType: 'rate_limit',
      hermesJobId: (req.body && req.body.jobId) || req.query.jobId || null,
      actor: 'system_rate_limit',
      resultStatus: 'denied',
      safeMessage: `Rate limit exceeded for IP: ${ip}`,
      metadata: { ip, limit }
    });
    return res.status(429).send('Too Many Requests. Please wait a minute and try again.');
  }
  
  timestamps.push(now);
  ipRequestHistory.set(ip, timestamps);
  next();
}

// Actions Enable switch middleware
function actionsEnabledMiddleware(req, res, next) {
  const actionsEnabled = process.env.DASHBOARD_ACTIONS_ENABLED === 'true';
  if (!actionsEnabled) {
    return res.status(403).send('Dashboard operational mutations are disabled.');
  }
  next();
}

// Security helper: get current INTERNAL_ADMIN_TOKEN
function getAdminToken() {
  return process.env.INTERNAL_ADMIN_TOKEN || 'admin-test-token-123';
}

// Authentication Middleware
function protectDashboard(req, res, next) {
  const token = req.query.token || req.headers['x-admin-token'];
  const expected = getAdminToken();
  
  const crypto = require('crypto');
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
  const actor = `ip_hash_${ipHash}`;
  
  if (!token) {
    audit.logDashboardAction({
      actionType: 'access',
      actor,
      resultStatus: 'denied',
      safeMessage: 'missing_dashboard_token',
      metadata: { denialReason: 'missing_dashboard_token' }
    });
    return res.status(401).send(renderLoginPage());
  }
  
  if (token !== expected) {
    audit.logDashboardAction({
      actionType: 'access',
      actor,
      resultStatus: 'denied',
      safeMessage: 'invalid_dashboard_token',
      metadata: { denialReason: 'invalid_dashboard_token' }
    });
    return res.status(401).send(renderLoginPage());
  }
  next();
}

// Middleware to verify POST actions (Token, Nonce, Actions Enabled)
function verifyPostAction(req, res, next) {
  const actionType = req.path.split('/').pop();
  const jobId = (req.body && req.body.jobId) || req.query.jobId || null;
  const approvalId = (req.body && req.body.approvalId) || req.query.approvalId || null;
  const targetId = jobId || approvalId;
  const nonce = (req.body && req.body.nonce) || req.query.nonce;

  const crypto = require('crypto');
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
  const actor = `ip_hash_${ipHash}`;

  // 1. Check if token config is missing
  const expected = process.env.INTERNAL_ADMIN_TOKEN;
  if (!expected || expected.trim() === '') {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'Rejection: INTERNAL_ADMIN_TOKEN is not configured on the server.',
      metadata: { denialReason: 'MISSING_SERVER_TOKEN' }
    });
    return res.status(401).send('Unauthorized: Server admin token is not configured.');
  }

  // 2. Check Actions Enabled
  const actionsEnabled = process.env.DASHBOARD_ACTIONS_ENABLED === 'true';
  if (!actionsEnabled) {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'Dashboard operational mutations are disabled (DASHBOARD_ACTIONS_ENABLED is not true).',
      metadata: { denialReason: 'DASHBOARD_ACTIONS_DISABLED' }
    });
    return res.status(403).send('Dashboard operational mutations are disabled.');
  }

  // 3. Check Token Auth
  const token = req.query.token || req.headers['x-admin-token'] || (req.body && req.body.token);
  if (!token) {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'missing_dashboard_token',
      metadata: { denialReason: 'missing_dashboard_token' }
    });
    return res.status(401).send('Unauthorized: missing_dashboard_token');
  }

  if (token !== expected) {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'invalid_dashboard_token',
      metadata: { denialReason: 'invalid_dashboard_token' }
    });
    return res.status(401).send('Unauthorized: invalid_dashboard_token');
  }

  // 4. Check and Consume Nonce
  if (!targetId || !verifyAndConsumeNonce(nonce, actionType, targetId, token)) {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'expired_session',
      metadata: { denialReason: 'expired_session' }
    });
    return res.status(400).send('Bad Request: expired_session');
  }

  next();
}

/**
 * LoginPage View Template
 */
function renderLoginPage() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>OpenClaw Hermes Dashboard - Auth</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0;
          font-family: 'Inter', sans-serif;
          background: radial-gradient(circle at center, #1e1b4b 0%, #0f0b26 100%);
          color: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
        }
        .login-card {
          background: rgba(30, 27, 75, 0.4);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 3rem;
          border-radius: 1.5rem;
          width: 100%;
          max-width: 400px;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0,0,0,0.5);
        }
        h1 {
          font-size: 1.8rem;
          margin-bottom: 0.5rem;
          font-weight: 700;
          background: linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p {
          font-size: 0.9rem;
          color: #94a3b8;
          margin-bottom: 2rem;
        }
        input {
          width: 100%;
          padding: 1rem;
          box-sizing: border-box;
          background: rgba(15, 11, 38, 0.6);
          border: 1px solid rgba(167, 139, 250, 0.3);
          border-radius: 0.75rem;
          color: white;
          font-size: 1rem;
          margin-bottom: 1.5rem;
          transition: border-color 0.3s;
          text-align: center;
        }
        input:focus {
          border-color: #a78bfa;
          outline: none;
        }
        button {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
          border: none;
          border-radius: 0.75rem;
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
        }
        button:hover {
          opacity: 0.9;
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="login-card">
        <h1>Hermes Portal Auth</h1>
        <p>Enter your administration security token</p>
        <div id="error-message" style="display: none; color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;"></div>
        <input type="password" id="token" placeholder="INTERNAL_ADMIN_TOKEN" onkeydown="if(event.key==='Enter') login()"/>
        <button onclick="login()">Enter Dashboard</button>
      </div>
      <script>
        function login() {
          const t = document.getElementById('token').value.trim();
          if (t) {
            window.location.href = window.location.pathname + '?token=' + encodeURIComponent(t);
          }
        }
        // Try reading token from query or URL if passed
        const urlParams = new URLSearchParams(window.location.search);
        const tok = urlParams.get('token');
        if (tok) {
          // Since the server served the login page (protectDashboard middleware rejected it),
          // the token in the URL query parameter must be invalid.
          sessionStorage.removeItem('hermes_admin_token');
          const errDiv = document.getElementById('error-message');
          if (errDiv) {
            errDiv.style.display = 'block';
            errDiv.textContent = 'Invalid security token. Please try again.';
          }
          // Clean the query parameter from address bar
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          const saved = sessionStorage.getItem('hermes_admin_token');
          if (saved) {
            window.location.href = window.location.pathname + '?token=' + encodeURIComponent(saved);
          }
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * Shell Layout View Template
 */
function renderDashboardShell(title, activeTab, content, token) {
  const tParam = token ? `?token=${encodeURIComponent(token)}` : '';
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>OpenClaw Hermes Dashboard - ${title}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-main: #0b071e;
          --bg-panel: rgba(22, 17, 49, 0.5);
          --border: rgba(255, 255, 255, 0.08);
          --text-primary: #f1f5f9;
          --text-secondary: #94a3b8;
          --accent-purple: #8b5cf6;
          --accent-blue: #3b82f6;
          --accent-green: #10b981;
          --accent-yellow: #f59e0b;
          --accent-red: #ef4444;
        }
        
        body {
          margin: 0;
          background: var(--bg-main);
          color: var(--text-primary);
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* Glassmorphic Navbar */
        nav {
          background: rgba(11, 7, 30, 0.7);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 2rem;
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          text-decoration: none;
          color: white;
        }

        .nav-logo h1 {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0;
          background: linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .nav-links {
          display: flex;
          gap: 1rem;
        }

        .nav-link {
          text-decoration: none;
          color: var(--text-secondary);
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.3s;
        }

        .nav-link:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.05);
        }

        .nav-link.active {
          color: white;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
          border: 1px solid rgba(139, 92, 246, 0.4);
        }

        .main-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          max-width: 1400px;
          width: 95%;
          margin: 2rem auto;
          gap: 2rem;
          box-sizing: border-box;
        }

        /* Common Premium Panel Layout */
        .panel {
          background: var(--bg-panel);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border);
          border-radius: 1rem;
          padding: 2rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        h2 {
          font-size: 1.25rem;
          font-weight: 700;
          margin-top: 0;
          margin-bottom: 1.5rem;
          background: linear-gradient(135deg, white 0%, #94a3b8 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        /* Status Badge Styling */
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .badge-queued { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
        .badge-running { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
        .badge-completed { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-failed { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .badge-blocked { background: rgba(220, 38, 38, 0.2); color: #f87171; border: 1px solid rgba(220, 38, 38, 0.4); }
        .badge-awaiting_approval { background: rgba(167, 139, 250, 0.15); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.3); }
        .badge-canceled { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }

        /* Tables & Lists */
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        th {
          padding: 1rem;
          color: var(--text-secondary);
          font-weight: 600;
          font-size: 0.85rem;
          text-transform: uppercase;
          border-bottom: 1px solid var(--border);
        }

        td {
          padding: 1rem;
          font-size: 0.9rem;
          border-bottom: 1px solid var(--border);
        }

        tr:hover td {
          background: rgba(255, 255, 255, 0.02);
        }

        a {
          color: var(--accent-purple);
          text-decoration: none;
          transition: color 0.2s;
        }

        a:hover {
          color: var(--accent-blue);
        }

        /* Footer */
        footer {
          margin-top: auto;
          text-align: center;
          padding: 2rem;
          font-size: 0.8rem;
          color: var(--text-secondary);
          border-top: 1px solid var(--border);
          background: rgba(11, 7, 30, 0.3);
        }
      </style>
    </head>
    <body>
      <nav>
        <a href="/dashboard" onclick="appendToken(this)" class="nav-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#logoGrad)" />
            <path d="M2 17L12 22L22 17" stroke="url(#logoGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="url(#logoGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <defs>
              <linearGradient id="logoGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stop-color="#8b5cf6" />
                <stop offset="1" stop-color="#3b82f6" />
              </linearGradient>
            </defs>
          </svg>
          <h1>Hermes Portal</h1>
        </a>
        <div class="nav-links">
          <a href="/dashboard" onclick="appendToken(this)" class="nav-link ${activeTab === 'overview' ? 'active' : ''}">Overview</a>
          <a href="/dashboard/queue" onclick="appendToken(this)" class="nav-link ${activeTab === 'queue' ? 'active' : ''}">Queue</a>
          <a href="/dashboard/trace" onclick="appendToken(this)" class="nav-link ${activeTab === 'trace' ? 'active' : ''}">Trace</a>
          <a href="/dashboard/brief" onclick="appendToken(this)" class="nav-link ${activeTab === 'brief' ? 'active' : ''}">Daily Brief</a>
          <a href="/dashboard/usage" onclick="appendToken(this)" class="nav-link ${activeTab === 'usage' ? 'active' : ''}">LLM Usage</a>
        </div>
      </nav>
      <div class="main-container">
        ${content}
      </div>
      <footer>
        OpenClaw Hermes Dashboard &copy; 2026. All operations are strictly dry-run-only.
      </footer>
      <script>
        function appendToken(el) {
          const token = sessionStorage.getItem('hermes_admin_token');
          if (!token) return;
          const separator = el.href.includes('?') ? '&' : '?';
          el.href += separator + 'token=' + encodeURIComponent(token);
        }

        // Try reading token from query or URL if passed
        const urlParams = new URLSearchParams(window.location.search);
        const tok = urlParams.get('token');
        if (tok) {
          sessionStorage.setItem('hermes_admin_token', tok);
          // Clean the token query parameter after successful login too
          urlParams.delete('token');
          const newQuery = urlParams.toString();
          const newSearch = newQuery ? '?' + newQuery : '';
          window.history.historyState = {};
          window.history.replaceState({}, document.title, window.location.pathname + newSearch);
        }
      </script>
    </body>
    </html>
  `;
}

// 1. Overview Page Route
router.get('/', protectDashboard, (req, res) => {
  const token = req.query.token;
  const health = obs.getHermesQueueHealth();
  
  const content = `
    <style>
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }
      .stat-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border);
        border-radius: 0.75rem;
        padding: 1.5rem;
        text-align: center;
        transition: transform 0.3s;
      }
      .stat-card:hover {
        transform: translateY(-5px);
        background: rgba(255, 255, 255, 0.05);
      }
      .stat-value {
        font-size: 2.5rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, white 0%, #cbd5e1 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .stat-label {
        font-size: 0.85rem;
        color: var(--text-secondary);
        font-weight: 500;
        text-transform: uppercase;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--border);
        font-size: 0.95rem;
      }
      .detail-label {
        color: var(--text-secondary);
      }
      .grid-two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
      }
      @media(max-width: 768px) {
        .grid-two-col { grid-template-columns: 1fr; }
      }
    </style>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${health.totalJobs}</div>
        <div class="stat-label">Total Jobs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${health.activeJobs}</div>
        <div class="stat-label">Active Jobs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="background: linear-gradient(135deg, #10b981 0%, #34d399 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${health.completedJobs}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="background: linear-gradient(135deg, #ef4444 0%, #f87171 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${health.failedJobs}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${health.awaitingApprovalJobs}</div>
        <div class="stat-label">Awaiting Approval</div>
      </div>
    </div>

    <div class="grid-two-col">
      <div class="panel">
        <h2>🛰️ Queue Diagnostics</h2>
        <div class="detail-row">
          <span class="detail-label">Queued Status:</span>
          <span>${health.queuedJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Dispatched/Running:</span>
          <span>${health.dispatchedRunningJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blocked Status:</span>
          <span>${health.blockedJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Canceled Status:</span>
          <span>${health.canceledJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duplicate Rejections:</span>
          <span>${health.duplicateRejectionCount}</span>
        </div>
      </div>
      
      <div class="panel">
        <h2>🛡️ Safety & Execution Configuration</h2>
        <div class="detail-row">
          <span class="detail-label">Real External Writes:</span>
          <span class="badge ${health.realExternalExecutionDisabled ? 'badge-failed' : 'badge-completed'}">${health.realExternalExecutionDisabled ? 'DISABLED' : 'ENABLED'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Connector Mode:</span>
          <span><code>${health.connectorMode}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Job:</span>
          <span><code>${health.latestJobId || 'None'}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Completed:</span>
          <span><code>${health.latestCompletedJobId || 'None'}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Failed:</span>
          <span><code>${health.latestFailedJobId || 'None'}</code></span>
        </div>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Overview', 'overview', content, token));
});

// 2. Queue Page Route
router.get('/queue', protectDashboard, (req, res) => {
  const token = req.query.token;
  const { q, status, botId, priority, errorCategory } = req.query;

  let jobs = search.filterHermesJobs({ status, botId, priority, errorCategory });
  
  if (q && q.trim()) {
    const term = q.trim();
    // Run simple matching
    const matches = search.searchHermesJobs(term);
    const matchingIds = matches.map(j => j.hermesJobId);
    jobs = jobs.filter(j => matchingIds.includes(j.hermesJobId));
  }

  // Sort latest updated first
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const content = `
    <style>
      .filter-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.5rem;
        align-items: center;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border);
        padding: 1.5rem;
        border-radius: 0.75rem;
      }
      .filter-input {
        background: rgba(15, 11, 38, 0.6);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        color: white;
        font-size: 0.9rem;
        flex: 1;
        min-width: 200px;
      }
      .filter-select {
        background: rgba(15, 11, 38, 0.6);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        color: white;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .filter-btn {
        padding: 0.5rem 1.5rem;
        background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-blue) 100%);
        border: none;
        border-radius: 0.5rem;
        color: white;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s;
      }
      .filter-btn:hover {
        opacity: 0.9;
      }
    </style>

    <div class="panel">
      <h2>📋 Jobs Queue Registry</h2>
      
      <form method="GET" action="/dashboard/queue" class="filter-bar">
        <input type="hidden" name="token" value="${token}" />
        <input type="text" name="q" value="${q || ''}" placeholder="Search keywords..." class="filter-input" />
        
        <select name="status" class="filter-select">
          <option value="">-- All Statuses --</option>
          ${['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running', 'completed', 'failed', 'canceled', 'blocked']
            .map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
        </select>

        <select name="botId" class="filter-select">
          <option value="">-- All Bots --</option>
          ${['content-forge', 'lead-acquisition-engine', 'revenue-master-orchestrator', 'cresca-content-aeo-engine', 'system-master-orchestrator', 'revenue-optimization-engine', 'weekly-command-center', 'client-value-maximizer', 'auto-loop-system']
            .map(b => `<option value="${b}" ${botId === b ? 'selected' : ''}>${b}</option>`).join('')}
        </select>

        <select name="priority" class="filter-select">
          <option value="">-- All Priorities --</option>
          ${['low', 'normal', 'high', 'urgent']
            .map(p => `<option value="${p}" ${priority === p ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('')}
        </select>

        <button type="submit" class="filter-btn">Apply Filters</button>
      </form>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Target Bot</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Requested By</th>
              <th>Updated At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No matching queue jobs found.</td></tr>' : 
              jobs.map(j => `
                <tr>
                  <td><code>${j.hermesJobId}</code></td>
                  <td><code>${j.botId}</code></td>
                  <td><span class="badge badge-${j.status}">${j.status}</span></td>
                  <td><code>${j.priority || 'normal'}</code></td>
                  <td><code>${j.requestedBy || 'system'}</code></td>
                  <td>${j.updatedAt}</td>
                  <td>
                    <a href="/dashboard/trace?jobId=${j.hermesJobId}" onclick="appendToken(this)">Trace Lifecycle</a>
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'queued' || j.status === 'approved')) ? ` | <a href="/dashboard/action/confirm?action=dispatch&jobId=${j.hermesJobId}" onclick="appendToken(this)" style="color: var(--accent-green);">Dispatch</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'awaiting_approval' && j.approvalId)) ? ` | <a href="/dashboard/action/confirm?action=approve&approvalId=${j.approvalId}" onclick="appendToken(this)" style="color: var(--accent-purple);">Approve</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'failed' || j.status === 'blocked')) ? ` | <a href="/dashboard/action/confirm?action=retry&jobId=${j.hermesJobId}" onclick="appendToken(this)" style="color: var(--accent-yellow);">Retry</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status !== 'completed' && j.status !== 'failed' && j.status !== 'canceled')) ? ` | <a href="/dashboard/action/confirm?action=cancel&jobId=${j.hermesJobId}" onclick="appendToken(this)" style="color: var(--accent-red);">Cancel</a>` : ''}
                  </td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Queue', 'queue', content, token));
});

// 3. Trace Page Route
router.get('/trace', protectDashboard, (req, res) => {
  const token = req.query.token;
  const { jobId } = req.query;

  let job = null;
  let textTrace = '';
  if (jobId && jobId.trim()) {
    const cleanId = jobId.trim();
    job = engine.readHermesJob(cleanId);
    textTrace = obs.buildHermesTrace(cleanId);
  }

  const content = `
    <style>
      .trace-input-group {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
      }
      .pipeline {
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        margin: 3rem 0;
        flex-wrap: wrap;
        gap: 2rem;
      }
      .pipeline::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 4px;
        background: rgba(255, 255, 255, 0.08);
        z-index: 1;
        transform: translateY(-50%);
      }
      .pipeline-node {
        position: relative;
        z-index: 2;
        background: #120e36;
        border: 2px solid var(--border);
        border-radius: 1rem;
        padding: 1.25rem;
        width: 150px;
        text-align: center;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        transition: transform 0.3s, border-color 0.3s;
      }
      .pipeline-node:hover {
        transform: translateY(-5px);
      }
      .pipeline-node.completed {
        border-color: var(--accent-green);
        box-shadow: 0 0 15px rgba(16, 185, 129, 0.2);
      }
      .pipeline-node.active {
        border-color: var(--accent-blue);
        box-shadow: 0 0 15px rgba(59, 130, 246, 0.2);
      }
      .node-title {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-secondary);
        margin-bottom: 0.5rem;
      }
      .pipeline-node.completed .node-title {
        color: #34d399;
      }
      .node-value {
        font-size: 0.85rem;
        font-family: monospace;
        word-break: break-all;
      }
      .trace-events-list {
        margin-top: 2rem;
      }
      .event-item {
        padding: 1rem;
        border-left: 3px solid var(--accent-purple);
        background: rgba(255, 255, 255, 0.02);
        margin-bottom: 0.75rem;
        border-radius: 0 0.5rem 0.5rem 0;
        font-size: 0.9rem;
      }
      .event-time {
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-bottom: 0.25rem;
      }
    </style>

    <div class="panel">
      <h2>🔍 Job Lifecycle Trace Engine</h2>
      
      <form method="GET" action="/dashboard/trace" class="trace-input-group">
        <input type="hidden" name="token" value="${token}" />
        <input type="text" name="jobId" value="${jobId || ''}" placeholder="Enter Hermes Job ID (e.g. hm_...)" class="filter-input" />
        <button type="submit" class="filter-btn">Trace Lifecycle</button>
      </form>

      ${!jobId ? '<p style="color: var(--text-secondary);">Enter a Job ID to begin tracing.</p>' : 
        !job ? `<div style="padding: 2rem; text-align: center; color: var(--accent-red);">❌ Error: Hermes Job <code>${jobId}</code> not found in queue store.</div>` : `
          
          <div class="pipeline">
            <div class="pipeline-node completed">
              <div class="node-title">Request Ingested</div>
              <div class="node-value">telegram_requests/</div>
            </div>
            
            <div class="pipeline-node completed">
              <div class="node-title">Hermes Job</div>
              <div class="node-value"><code>${job.hermesJobId}</code></div>
            </div>
            
            <div class="pipeline-node ${job.runtimeJobId ? 'completed' : 'active'}">
              <div class="node-title">Runtime Job</div>
              <div class="node-value">${job.runtimeJobId ? `<code>${job.runtimeJobId}</code>` : 'Pending'}</div>
            </div>

            <div class="pipeline-node ${job.approvalId ? (job.status === 'awaiting_approval' ? 'active' : 'completed') : ''}">
              <div class="node-title">Approval Token</div>
              <div class="node-value">${job.approvalId ? `<code>${job.approvalId}</code>` : 'None Required'}</div>
            </div>

            <div class="pipeline-node ${job.outputPath ? 'completed' : ''}">
              <div class="node-title">Output Path</div>
              <div class="node-value">${job.outputPath ? `<code>${job.outputPath}</code>` : 'None'}</div>
            </div>

            <div class="pipeline-node ${job.driveLink ? 'completed' : ''}">
              <div class="node-title">Drive Link</div>
              <div class="node-value">${job.driveLink ? `<a href="${job.driveLink}" target="_blank">Published</a>` : 'Not Sync\'d'}</div>
            </div>
          </div>

          ${(() => {
            if (process.env.DASHBOARD_ACTIONS_ENABLED !== 'true') return '';
            const canDispatch = job.status === 'queued' || job.status === 'approved';
            const canCancel = job.status !== 'completed' && job.status !== 'failed' && job.status !== 'canceled';
            const canRetry = job.status === 'failed' || job.status === 'blocked';
            const canApprove = job.status === 'awaiting_approval' && job.approvalId;
            
            if (!canDispatch && !canCancel && !canRetry && !canApprove) return '';
            
            let html = `
              <div class="panel" style="margin-top: 3rem; border-color: rgba(139, 92, 246, 0.4); background: rgba(139, 92, 246, 0.03);">
                <h2>⚡ Operator Control Panel</h2>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
            `;
            if (canDispatch) {
              html += `<a href="/dashboard/action/confirm?action=dispatch&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; color: white;">🚀 Dispatch Job</a>`;
            }
            if (canApprove) {
              html += `<a href="/dashboard/action/confirm?action=approve&approvalId=${job.approvalId}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; color: white;">✅ Approve Execution</a>`;
            }
            if (canRetry) {
              html += `<a href="/dashboard/action/confirm?action=retry&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; color: white;">🔄 Retry Job</a>`;
            }
            if (canCancel) {
              html += `<a href="/dashboard/action/confirm?action=cancel&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; color: white;">❌ Cancel Job</a>`;
            }
            html += `
                </div>
              </div>
            `;
            return html;
          })()}

          <div style="margin-top: 3rem;">
            <h2>📊 Execution Event Logs</h2>
            <div class="trace-events-list">
              ${(job.events || []).map(e => `
                <div class="event-item">
                  <div class="event-time">${e.timestamp}</div>
                  <div>${e.message}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div style="margin-top: 3rem;">
            <h2>📄 Sanitized Trace Breakdown</h2>
            <pre style="background: rgba(0, 0, 0, 0.4); border: 1px solid var(--border); padding: 1.5rem; border-radius: 0.75rem; color: #f1f5f9; overflow-x: auto; font-family: monospace; white-space: pre-wrap;">${textTrace}</pre>
          </div>
        `}
    </div>
  `;

  res.send(renderDashboardShell('Trace', 'trace', content, token));
});

// 4. Daily Brief Page Route
router.get('/brief', protectDashboard, (req, res) => {
  const token = req.query.token;
  const targetDate = req.query.date || new Date().toISOString().substring(0, 10);
  
  // Resolve workspace directory
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  const briefFile = path.resolve(root, 'openclaw', 'hermes', 'briefs', `daily-brief-${targetDate}.json`);

  let brief;
  
  // If it's today's date, always regenerate to show real-time live data
  const todayDate = new Date().toISOString().substring(0, 10);
  if (targetDate === todayDate || !fs.existsSync(briefFile)) {
    brief = dailyBrief.buildHermesDailyBrief(targetDate);
    dailyBrief.saveDailyBrief(brief);
  } else {
    try {
      brief = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
    } catch (err) {
      brief = dailyBrief.buildHermesDailyBrief(targetDate);
      dailyBrief.saveDailyBrief(brief);
    }
  }

  const qs = brief.queueSummary;
  const fsList = brief.failureSummary;
  const ap = brief.approvalSummary;
  const us = brief.usageSummary;
  const ra = brief.recommendedActions;
  const sc = brief.safetyConfirmation;

  const content = `
    <style>
      .brief-grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 2rem;
      }
      .brief-list-item {
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      @media(max-width: 768px) {
        .brief-grid { grid-template-columns: 1fr; }
      }
    </style>

    <div class="brief-grid">
      <div class="panel">
        <h2>📆 Daily Brief Summary (${brief.date})</h2>
        
        <div class="detail-row">
          <span class="detail-label">Jobs Created Today:</span>
          <span><strong>${qs.total}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Jobs Completed Today:</span>
          <span><strong>${qs.completed}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Failures Encountered Today:</span>
          <span style="color: ${qs.failed > 0 ? 'var(--accent-red)' : 'var(--text-primary)'}"><strong>${qs.failed}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Currently Awaiting Approval:</span>
          <span style="color: ${qs.awaiting > 0 ? 'var(--accent-purple)' : 'var(--text-primary)'}"><strong>${qs.awaiting}</strong></span>
        </div>

        <h2 style="margin-top: 2rem;">💸 LLM Token & Cost Summary</h2>
        <div class="detail-row">
          <span class="detail-label">Total Consumption Cost:</span>
          <span><strong>$${us.totalCostUsd.toFixed(5)} USD</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Total Consumed Tokens:</span>
          <span><strong>${us.totalTokens.toLocaleString()}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Input Tokens:</span>
          <span>${us.totalInputTokens.toLocaleString()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Output Tokens:</span>
          <span>${us.totalOutputTokens.toLocaleString()}</span>
        </div>

        <h2 style="margin-top: 2rem;">🚀 Top Bots Used Today</h2>
        ${qs.topBots.length === 0 ? '<p style="color: var(--text-secondary);">No bot executions today.</p>' : 
          qs.topBots.map(b => `
            <div class="brief-list-item">
              <span><code>${b.botId}</code></span>
              <span class="badge badge-queued">${b.count} runs</span>
            </div>
          `).join('')}

        <h2 style="margin-top: 2rem;">📂 Latest Outputs Generated</h2>
        ${qs.latestOutputs.length === 0 ? '<p style="color: var(--text-secondary);">No outputs generated today.</p>' : 
          qs.latestOutputs.slice(0, 10).map(o => `
            <div class="brief-list-item">
              <span><code>${o.outputPath}</code></span>
              <span>${o.driveLink ? `<a href="${o.driveLink}" target="_blank">Drive Url</a>` : '<span style="color: var(--text-secondary);">Local outbox</span>'}</span>
            </div>
          `).join('')}

        <h2 style="margin-top: 2rem;">❌ Failures Today</h2>
        ${fsList.length === 0 ? '<p style="color: var(--text-secondary);">No failures today.</p>' :
          fsList.map(f => `
            <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem;">
              <div style="font-weight: 600; color: var(--accent-red); margin-bottom: 0.25rem;">
                Job: <code>${f.hermesJobId}</code> (${f.botId})
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                Category: <code>${f.errorCategory}</code> | Status: <span class="badge badge-failed">${f.status}</span>
              </div>
              <div style="font-family: monospace; white-space: pre-wrap; font-size: 0.85rem; background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 0.25rem;">${f.safeMessage}</div>
            </div>
          `).join('')}
      </div>

      <div>
        <div class="panel" style="border-color: rgba(139, 92, 246, 0.3); margin-bottom: 2rem;">
          <h2>💡 Recommended Operator Actions</h2>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            ${ra.length === 0 ? `
              <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 1rem; border-radius: 0.5rem; color: #34d399; font-size: 0.95rem;">
                ✅ All systems quiet. No immediate actions required. System status is stable.
              </div>
            ` : ra.map(act => {
              let actionBtnHtml = '';
              if (act.command && process.env.DASHBOARD_ACTIONS_ENABLED === 'true') {
                if (act.command.startsWith('/approve_run ')) {
                  const appVal = act.command.substring(13).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=approve&approvalId=${encodeURIComponent(appVal)}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-blue) 100%); text-decoration: none; padding: 0.25rem 0.75rem; font-size: 0.8rem; display: inline-block; border-radius: 0.25rem; color: white;">Approve Now</a></div>`;
                } else if (act.command.startsWith('/hermes_retry ')) {
                  const jobVal = act.command.substring(14).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=retry&jobId=${encodeURIComponent(jobVal)}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, var(--accent-yellow) 0%, var(--accent-red) 100%); text-decoration: none; padding: 0.25rem 0.75rem; font-size: 0.8rem; display: inline-block; border-radius: 0.25rem; color: white;">Retry Now</a></div>`;
                } else if (act.command.startsWith('/hermes_dispatch ')) {
                  const jobVal = act.command.substring(17).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=dispatch&jobId=${encodeURIComponent(jobVal)}" onclick="appendToken(this)" class="filter-btn" style="background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%); text-decoration: none; padding: 0.25rem 0.75rem; font-size: 0.8rem; display: inline-block; border-radius: 0.25rem; color: white;">Dispatch Now</a></div>`;
                }
              }
              return `
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); padding: 1rem; border-radius: 0.5rem; color: #fbbf24; font-size: 0.9rem; margin-bottom: 1rem;">
                  <strong>${act.message}</strong>
                  ${act.command ? `<div style="margin-top: 0.5rem;">Run: <code>${act.command}</code></div>` : ''}
                  ${actionBtnHtml}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="panel" style="border-color: rgba(255, 255, 255, 0.1);">
          <h2>🛡️ Safety Confirmation</h2>
          <div class="detail-row">
            <span class="detail-label">Runtime frozen:</span>
            <span><strong>${sc.runtimeFrozen ? 'CONFIRMED' : 'WARNING'}</strong></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Real Writes:</span>
            <span class="badge ${sc.realExecutionEnabled ? 'badge-failed' : 'badge-completed'}">${sc.realExecutionEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Connector mode:</span>
            <span><code>${sc.connectorMode}</code></span>
          </div>
        </div>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Daily Brief', 'brief', content, token));
});

// Fallback redirect for /daily-brief
router.get('/daily-brief', protectDashboard, (req, res) => {
  const token = req.query.token;
  res.redirect(`/dashboard/brief?token=${encodeURIComponent(token)}`);
});

// 5. Usage Page Route
router.get('/usage', protectDashboard, (req, res) => {
  const token = req.query.token;
  const { startDate, endDate, provider, model, botId, hermesJobId, runtimeJobId, project } = req.query;
  const filters = { startDate, endDate, provider, model, botId, hermesJobId, runtimeJobId, project };

  // Calculate dates in YYYY-MM-DD and YYYY-MM format
  const todayDate = new Date();
  const y = todayDate.getFullYear();
  const m = todayDate.getMonth() + 1; // 1-indexed
  const todayStr = todayDate.toISOString().substring(0, 10);
  const thisMonthPrefix = `${y}-${String(m).padStart(2, '0')}`;

  // Current calendar day/month summary metrics
  const todaySummary = analytics.buildDailyUsageSummary(todayStr);
  const monthlySummary = analytics.buildMonthlyUsageSummary(y, m);

  // Budget status for the current calendar month
  const startOfMonth = `${thisMonthPrefix}-01T00:00:00.000Z`;
  const endOfMonth = `${thisMonthPrefix}-31T23:59:59.999Z`;
  const budgetWarning = analytics.buildBudgetWarningSummary({ startDate: startOfMonth, endDate: endOfMonth });

  // Filtered summaries & breakdowns
  const filteredSummary = analytics.buildUsageSummary(filters);
  const providerBreakdown = analytics.buildProviderUsageBreakdown(filters);
  const modelBreakdown = analytics.buildModelUsageBreakdown(filters);
  const botBreakdown = analytics.buildBotUsageBreakdown(filters);
  const estVsAct = analytics.buildEstimatedVsActualUsage(filters);
  const filteredEntries = analytics.getFilteredEntries(filters);
  const recentEntries = filteredEntries.slice(0, 100);

  let alertHtml = '';
  if (budgetWarning.exceeded) {
    alertHtml = `
      <div class="panel" style="border-left: 5px solid var(--accent-red); background: rgba(239, 68, 68, 0.08); margin-bottom: 2rem; display: flex; align-items: center; gap: 1.5rem; box-shadow: 0 0 15px rgba(239, 68, 68, 0.15);">
        <div style="font-size: 2.2rem; filter: drop-shadow(0 0 5px rgba(239,68,68,0.4));">⚠️</div>
        <div>
          <h3 style="margin: 0; color: var(--accent-red); font-size: 1.1rem; font-weight: 700;">Monthly Spend Budget Exceeded</h3>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem; color: var(--text-secondary);">
            Operational spend of <strong>$${budgetWarning.currentCostUsd.toFixed(5)}</strong> for <strong>${thisMonthPrefix}</strong> exceeds the set budget cap of <strong>$${budgetWarning.budgetUsd.toFixed(2)}</strong>.
          </p>
        </div>
      </div>
    `;
  }

  const content = `
    <style>
      .usage-card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }
      .progress-container {
        margin-bottom: 1.25rem;
      }
      .progress-header {
        display: flex;
        justify-content: space-between;
        font-size: 0.85rem;
        margin-bottom: 0.25rem;
      }
      .progress-bar-bg {
        background: rgba(255, 255, 255, 0.05);
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
      }
      .progress-bar-fill {
        background: linear-gradient(90deg, var(--accent-purple) 0%, var(--accent-blue) 100%);
        height: 100%;
        border-radius: 4px;
      }
      .filter-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.5rem;
        align-items: center;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border);
        padding: 1.5rem;
        border-radius: 0.75rem;
      }
      .filter-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1;
        min-width: 150px;
      }
      .filter-input, .filter-select {
        background: rgba(15, 11, 38, 0.6);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        color: white;
        font-size: 0.9rem;
        transition: border-color 0.2s;
      }
      .filter-input:focus, .filter-select:focus {
        border-color: var(--accent-purple);
        outline: none;
      }
      .filter-btn-container {
        display: flex;
        align-items: flex-end;
        min-width: 120px;
      }
    </style>

    ${alertHtml}

    <div class="usage-card-grid">
      <div class="stat-card">
        <div class="stat-value">$${todaySummary.totalCostUsd.toFixed(5)}</div>
        <div class="stat-label">Spend Today</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem;">
          Tokens Today: ${todaySummary.totalTokens.toLocaleString()}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${monthlySummary.totalCostUsd.toFixed(5)}</div>
        <div class="stat-label">Spend This Month</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem;">
          Limit Cap: $${budgetWarning.budgetUsd.toFixed(2)} (${(budgetWarning.currentCostUsd / budgetWarning.budgetUsd * 100).toFixed(1)}%)
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${filteredSummary.totalCostUsd.toFixed(5)}</div>
        <div class="stat-label">Filtered Cost</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem;">
          Filtered Runs: ${filteredSummary.entryCount}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${filteredSummary.totalTokens.toLocaleString()}</div>
        <div class="stat-label">Filtered Tokens</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem;">
          In: ${filteredSummary.totalInputTokens.toLocaleString()} / Out: ${filteredSummary.totalOutputTokens.toLocaleString()}
        </div>
      </div>
    </div>

    <form method="GET" action="/dashboard/usage" class="filter-bar">
      <input type="hidden" name="token" value="${token}" />
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; width: 100%;">
        <div class="filter-input-group">
          <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Start Date</label>
          <input type="date" name="startDate" value="${startDate || ''}" class="filter-input" />
        </div>
        <div class="filter-input-group">
          <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">End Date</label>
          <input type="date" name="endDate" value="${endDate || ''}" class="filter-input" />
        </div>
        <div class="filter-input-group">
          <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Provider</label>
          <select name="provider" class="filter-select">
            <option value="">-- All Providers --</option>
            ${['openai', 'anthropic', 'google', 'openrouter', 'mock'].map(p => `<option value="${p}" ${provider === p ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div class="filter-input-group">
          <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Bot ID</label>
          <select name="botId" class="filter-select">
            <option value="">-- All Bots --</option>
            ${['content-forge', 'lead-acquisition-engine', 'revenue-master-orchestrator', 'cresca-content-aeo-engine', 'system-master-orchestrator', 'revenue-optimization-engine', 'weekly-command-center', 'client-value-maximizer', 'auto-loop-system'].map(b => `<option value="${b}" ${botId === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="filter-btn-container">
          <button type="submit" class="filter-btn" style="width: 100%; height: 2.5rem; margin: 0;">Apply Filters</button>
        </div>
      </div>
    </form>

    <div class="grid-two-col" style="margin-bottom: 2rem;">
      <div class="panel">
        <h2>💸 Cost Distribution by Bot</h2>
        ${botBreakdown.length === 0 ? '<p style="color: var(--text-secondary);">No bot usage records found.</p>' : 
          botBreakdown.map(data => {
            return `
              <div class="progress-container">
                <div class="progress-header">
                  <span><code>${data.botId}</code> (${data.count} runs)</span>
                  <span>$${data.costUsd.toFixed(5)} (${data.percent}%)</span>
                </div>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" style="width: ${data.percent}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
      </div>

      <div class="panel">
        <h2>🤖 Usage Distribution by Model</h2>
        ${modelBreakdown.length === 0 ? '<p style="color: var(--text-secondary);">No model usage records found.</p>' : 
          modelBreakdown.map(data => {
            return `
              <div class="progress-container">
                <div class="progress-header">
                  <span><code>${data.model}</code> (${data.count} calls)</span>
                  <span>${data.totalTokens.toLocaleString()} tkn (${data.percent}%)</span>
                </div>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" style="width: ${data.percent}%; background: linear-gradient(90deg, var(--accent-blue) 0%, var(--accent-green) 100%);"></div>
                </div>
              </div>
            `;
          }).join('')}
      </div>
    </div>

    <div class="grid-two-col" style="margin-bottom: 2rem;">
      <div class="panel">
        <h2>🛰️ Cost Distribution by Provider</h2>
        ${providerBreakdown.length === 0 ? '<p style="color: var(--text-secondary);">No provider usage records found.</p>' : 
          providerBreakdown.map(data => {
            return `
              <div class="progress-container">
                <div class="progress-header">
                  <span><code>${data.provider}</code> (${data.count} calls)</span>
                  <span>$${data.costUsd.toFixed(5)} (${data.percent}%)</span>
                </div>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" style="width: ${data.percent}%; background: linear-gradient(90deg, var(--accent-purple) 0%, var(--accent-green) 100%);"></div>
                </div>
              </div>
            `;
          }).join('')}
      </div>

      <div class="panel">
        <h2>📈 Heuristics vs API Usage</h2>
        <div style="display: flex; flex-direction: column; gap: 1.25rem;">
          <div class="progress-container">
            <div class="progress-header">
              <span><strong>Actual API Metrics</strong> (${estVsAct.actual.count} calls)</span>
              <span>$${estVsAct.actual.costUsd.toFixed(5)} (${estVsAct.actual.costPercent}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${estVsAct.actual.costPercent}%; background: linear-gradient(90deg, var(--accent-green) 0%, var(--accent-blue) 100%);"></div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Tokens: ${estVsAct.actual.totalTokens.toLocaleString()} (${estVsAct.actual.tokenPercent}%)
            </div>
          </div>
          <div class="progress-container">
            <div class="progress-header">
              <span><strong>Estimated Heuristics</strong> (${estVsAct.estimated.count} calls)</span>
              <span>$${estVsAct.estimated.costUsd.toFixed(5)} (${estVsAct.estimated.costPercent}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${estVsAct.estimated.costPercent}%; background: linear-gradient(90deg, var(--accent-yellow) 0%, var(--accent-red) 100%);"></div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Tokens: ${estVsAct.estimated.totalTokens.toLocaleString()} (${estVsAct.estimated.tokenPercent}%)
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>📖 Usage Logs (Showing up to 100 events)</h2>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Bot ID</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Hermes Job</th>
              <th>Tokens (I/O)</th>
              <th>Cost (USD)</th>
              <th>Actual/Est</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${recentEntries.length === 0 ? '<tr><td colspan="9" style="text-align: center; color: var(--text-secondary);">No usage logs recorded matching filters.</td></tr>' : 
              recentEntries.map(e => `
                <tr>
                  <td>${e.createdAt}</td>
                  <td><code>${e.botId}</code></td>
                  <td><code>${e.provider}</code></td>
                  <td><code>${e.model}</code></td>
                  <td><code>${e.hermesJobId || 'None'}</code></td>
                  <td>${e.totalTokens.toLocaleString()} <span style="font-size: 0.75rem; color: var(--text-secondary);">(${e.inputTokens}/${e.outputTokens})</span></td>
                  <td>$${e.estimatedCostUsd.toFixed(5)}</td>
                  <td><span class="badge ${e.isEstimated ? 'badge-running' : 'badge-completed'}">${e.isEstimated ? 'Estimated' : 'Actual'}</span></td>
                  <td><a href="/dashboard/trace?jobId=${e.hermesJobId || e.runtimeJobId || ''}" onclick="appendToken(this)">Trace</a></td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('LLM Usage', 'usage', content, token));
});

// ==========================================
// OPERATIONAL MUTATION ROUTES (PHASE D5)
// ==========================================

// GET /dashboard/action/confirm - Confirmation page before mutating queue state
router.get('/action/confirm', protectDashboard, actionsEnabledMiddleware, rateLimitMiddleware, (req, res) => {
  const token = req.query.token;
  const action = req.query.action;
  const jobId = req.query.jobId;
  const approvalId = req.query.approvalId;

  let detailsHtml = '';
  let targetUrl = '';
  let title = '';
  const targetId = jobId || approvalId;

  if (!targetId) {
    return res.status(400).send('Missing target identifier (jobId or approvalId).');
  }

  const nonce = generateNonce(action, targetId, token);

  if (action === 'dispatch') {
    title = 'Confirm Manual Job Dispatch';
    const job = engine.readHermesJob(jobId);
    if (!job) return res.status(404).send('Job not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Job ID:</span><span><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Priority:</span><span><code>${job.priority || 'normal'}</code></span></div>
      <div class="detail-row"><span class="detail-label">Status:</span><span><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row"><span class="detail-label">Input Preview:</span><span><code>${job.inputSummary}</code></span></div>
    `;
    targetUrl = '/dashboard/action/dispatch';
  } else if (action === 'cancel') {
    title = 'Confirm Job Cancellation';
    const job = engine.readHermesJob(jobId);
    if (!job) return res.status(404).send('Job not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Job ID:</span><span><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Status:</span><span><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row" style="flex-direction: column; align-items: flex-start; gap: 0.5rem; border: none; margin-top: 1rem;">
        <span class="detail-label">Cancellation Reason:</span>
        <textarea name="reason" placeholder="Explain why this job is being canceled..." style="width:100%; box-sizing:border-box; height:80px; background:rgba(15,11,38,0.6); border:1px solid var(--border); border-radius:0.5rem; color:white; padding:0.5rem; font-family:inherit;" required>Operator canceled execution via Web Dashboard</textarea>
      </div>
    `;
    targetUrl = '/dashboard/action/cancel';
  } else if (action === 'retry') {
    title = 'Confirm Job Retry';
    const job = engine.readHermesJob(jobId);
    if (!job) return res.status(404).send('Job not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Original Job ID:</span><span><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Previous Status:</span><span><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row"><span class="detail-label">Safe Error Msg:</span><span>${job.safeMessage || 'N/A'}</span></div>
    `;
    targetUrl = '/dashboard/action/retry';
  } else if (action === 'approve') {
    title = 'Confirm Action Approval';
    const { getApproval } = require('../runtime/runtime-approvals');
    const record = getApproval(approvalId);
    if (!record) return res.status(404).send('Approval record not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Approval ID:</span><span><code>${record.approvalId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Command:</span><span><code>${record.command}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot / Preset:</span><span><code>${record.botSlug || record.presetId || 'N/A'}</code></span></div>
      <div class="detail-row"><span class="detail-label">Preview:</span><span><code>${record.inputPreview}</code></span></div>
    `;
    targetUrl = '/dashboard/action/approve';
  } else {
    return res.status(400).send('Invalid action type');
  }

  const content = `
    <div class="panel" style="max-width: 600px; margin: 3rem auto; border-color: var(--accent-purple);">
      <h2>🛡️ ${title}</h2>
      <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 2rem;">
        Please confirm the action details below. This operation will mutate the operational Hermes queue and run inside a dry-run execution wrapper.
      </p>
      
      <form action="${targetUrl}" method="POST" id="confirmForm">
        <input type="hidden" name="jobId" value="${jobId || ''}" />
        <input type="hidden" name="approvalId" value="${approvalId || ''}" />
        <input type="hidden" name="nonce" value="${nonce}" />
        <input type="hidden" name="token" id="form-token" value="" />
        
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 2rem;">
          ${detailsHtml}
        </div>

        <div style="display: flex; gap: 1.5rem; justify-content: flex-end;">
          <a href="javascript:history.back()" class="nav-link" style="padding: 0.75rem 1.5rem; border: 1px solid var(--border); border-radius: 0.5rem; font-weight: 600; text-align: center; text-decoration: none; color: var(--text-secondary); line-height: 1.5;">Cancel</a>
          <button type="submit" class="filter-btn" style="padding: 0.75rem 2rem; border-radius: 0.5rem; font-weight: 600; font-size: 0.95rem; cursor: pointer; border: none; background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-blue) 100%); color: white;">Confirm & Execute</button>
        </div>
      </form>
      <script>
        document.addEventListener("DOMContentLoaded", () => {
          const t = sessionStorage.getItem("hermes_admin_token");
          if (t) {
            document.getElementById("form-token").value = t;
          }
        });
      </script>
    </div>
  `;

  res.send(renderDashboardShell(title, 'overview', content, token));
});

// POST /dashboard/action/dispatch
router.post('/action/dispatch', verifyPostAction, rateLimitMiddleware, async (req, res) => {
  const token = req.body.token || req.query.token;
  const jobId = req.body.jobId || req.query.jobId;

  if (!jobId) {
    return res.status(400).send('Missing jobId');
  }

  const job = engine.readHermesJob(jobId);
  if (!job) {
    return res.status(404).send('Job not found');
  }

  if (job.status !== 'queued' && job.status !== 'approved') {
    return res.status(400).send(`Rejection: Can only dispatch QUEUED or APPROVED jobs. Current status: ${job.status}`);
  }

  try {
    const result = await dispatcher.dispatchHermesJobToRuntime(jobId);
    
    audit.logDashboardAction({
      actionType: 'dispatch',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: result.status === 'failed' ? 'failure' : 'success',
      safeMessage: result.safeMessage || 'Job manual dispatch completed.',
      metadata: {
        outcomeStatus: result.status,
        approvalId: result.approvalId || null,
        runtimeJobId: result.runtimeJobId || null,
        outputPath: result.filename || null
      }
    });

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'dispatch',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Dispatch failed: ${err.message}`);
  }
});

// POST /dashboard/action/cancel
router.post('/action/cancel', verifyPostAction, rateLimitMiddleware, (req, res) => {
  const token = req.body.token || req.query.token;
  const jobId = req.body.jobId || req.query.jobId;
  const reason = req.body.reason || req.query.reason || 'Operator canceled execution via dashboard';

  if (!jobId) {
    return res.status(400).send('Missing jobId');
  }

  const job = engine.readHermesJob(jobId);
  if (!job) {
    return res.status(404).send('Job not found');
  }

  if (job.status === 'completed') {
    return res.status(400).send('Rejection: Cannot cancel a completed job.');
  }

  try {
    engine.cancelHermesJob(jobId, reason);
    
    audit.logDashboardAction({
      actionType: 'cancel',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'success',
      safeMessage: `Job successfully canceled. Reason: ${reason}`,
      metadata: { reason }
    });

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'cancel',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Cancellation failed: ${err.message}`);
  }
});

// POST /dashboard/action/retry
router.post('/action/retry', verifyPostAction, rateLimitMiddleware, async (req, res) => {
  const token = req.body.token || req.query.token;
  const jobId = req.body.jobId || req.query.jobId;

  if (!jobId) {
    return res.status(400).send('Missing jobId');
  }

  const job = engine.readHermesJob(jobId);
  if (!job) {
    return res.status(404).send('Job not found');
  }

  if (job.status !== 'failed' && job.status !== 'blocked') {
    return res.status(400).send(`Rejection: Can only retry FAILED or BLOCKED jobs. Current status: ${job.status}`);
  }

  try {
    const { newJob, result } = await engine.retryHermesJob(jobId);

    audit.logDashboardAction({
      actionType: 'retry',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: result.status === 'failed' ? 'failure' : 'success',
      safeMessage: `Retry initiated successfully. New Job ID: ${newJob.hermesJobId}`,
      metadata: {
        originalJobId: jobId,
        newJobId: newJob.hermesJobId,
        dispatchStatus: result.status,
        approvalId: result.approvalId || null,
        runtimeJobId: result.runtimeJobId || null
      }
    });

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(newJob.hermesJobId)}&token=${encodeURIComponent(token)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'retry',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Retry failed: ${err.message}`);
  }
});

// POST /dashboard/action/approve
router.post('/action/approve', verifyPostAction, rateLimitMiddleware, async (req, res) => {
  const token = req.body.token || req.query.token;
  const approvalId = req.body.approvalId || req.query.approvalId;

  if (!approvalId) {
    return res.status(400).send('Missing approvalId');
  }

  const { getApproval } = require('../runtime/runtime-approvals');
  const record = getApproval(approvalId);
  if (!record) {
    return res.status(404).send('Approval record not found');
  }

  if (record.status !== 'pending') {
    return res.status(400).send(`Rejection: Approval is not pending. Status: ${record.status}`);
  }

  // Find linked Hermes job
  const store = require('../hermes/hermes-queue-store');
  const queue = store.loadQueue();
  const job = Object.values(queue).find(j => j.approvalId === approvalId);
  const hermesJobId = job ? job.hermesJobId : null;

  try {
    const mockMessage = {
      chat: { id: getAuthorizedChatId() },
      from: { id: getAuthorizedChatId() }
    };

    const resultText = await tgHandlers.handleHermesApprove(approvalId, mockMessage);

    // Reload approval record to see final status
    const updatedRecord = getApproval(approvalId);
    
    audit.logDashboardAction({
      actionType: 'approve',
      hermesJobId: hermesJobId,
      approvalId: approvalId,
      actor: 'dashboard_admin',
      resultStatus: (updatedRecord.status === 'failed' || updatedRecord.status === 'execution_failed') ? 'failure' : 'success',
      safeMessage: updatedRecord.safeMessage || resultText || 'Approval executed.',
      metadata: {
        telegramResult: resultText,
        finalApprovalStatus: updatedRecord.status,
        resultJobId: updatedRecord.resultJobId || null,
        resultFilename: updatedRecord.resultFilename || null
      }
    });

    if (hermesJobId) {
      res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(hermesJobId)}&token=${encodeURIComponent(token)}`);
    } else {
      res.redirect(`/dashboard/queue?token=${encodeURIComponent(token)}`);
    }
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'approve',
      hermesJobId: hermesJobId,
      approvalId: approvalId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Approval failed: ${err.message}`);
  }
});

module.exports = {
  dashboardRouter: router,
  protectDashboard,
  getAdminToken,
  _ipRequestHistory: ipRequestHistory
};

