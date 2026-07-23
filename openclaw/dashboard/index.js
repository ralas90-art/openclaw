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
const { sanitizeError } = require('../../jarvis/sanitizer');

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

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts.shift().trim()] = decodeURIComponent(parts.join('=').trim());
    }
  });
  return list;
}

const { validateSessionToken } = require('../../jarvis/auth-tickets');

// Authentication Middleware
async function protectDashboard(req, res, next) {
  let authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof authHeader === 'string') {
    token = authHeader.trim();
  } else if (req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.jarvis_session_token;
  } else if (req.body && typeof req.body.token === 'string') {
    token = req.body.token.trim();
  }

  const crypto = require('crypto');
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
  const actor = `ip_hash_${ipHash}`;

  if (!token || !token.startsWith('srv_sess_')) {
    audit.logDashboardAction({
      actionType: 'access',
      actor,
      resultStatus: 'denied',
      safeMessage: 'invalid_or_missing_session_token',
      metadata: { denialReason: 'invalid_or_missing_session_token' }
    });
    return res.status(401).send(renderLoginPage());
  }

  try {
    const sessionRes = await validateSessionToken(token);
    if (!sessionRes.valid) {
      audit.logDashboardAction({
        actionType: 'access',
        actor,
        resultStatus: 'denied',
        safeMessage: 'expired_or_invalid_session',
        metadata: { denialReason: 'expired_or_invalid_session' }
      });
      return res.status(401).send(renderLoginPage());
    }
    req.sessionMetadata = sessionRes.metadata;
    next();
  } catch (err) {
    return res.status(401).send(renderLoginPage());
  }
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
  let authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof authHeader === 'string') {
    token = authHeader.trim();
  } else if (req.body && typeof req.body.token === 'string') {
    token = req.body.token.trim();
  }

  if (!token || !token.startsWith('srv_sess_')) {
    audit.logDashboardAction({
      actionType,
      hermesJobId: jobId,
      approvalId,
      actor,
      resultStatus: 'denied',
      safeMessage: 'invalid_or_missing_session_token',
      metadata: { denialReason: 'invalid_or_missing_session_token' }
    });
    return res.status(401).send('Unauthorized: invalid_or_missing_session_token');
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

// Serve static theme stylesheet
router.get('/dashboard-theme.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css');
  const cssPath = path.join(__dirname, 'dashboard-theme.css');
  res.sendFile(cssPath, { dotfiles: 'allow' });
});

// Render SVG Budget Ring
function renderBudgetRing(used, total) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, used / total));
  const dash = circ * pct;
  const gap = circ - dash;
  const strokeColor = pct > 0.8 ? "#F87171" : pct > 0.5 ? "#FBBF24" : "#4ADE80";
  return `
    <div class="budget-ring-container">
      <svg width="88" height="88" viewBox="0 0 88 88" style="transform: rotate(-90deg);">
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="#2D3139" stroke-width="5" />
        <circle
          cx="44"
          cy="44"
          r="${r}"
          fill="none"
          stroke="${strokeColor}"
          stroke-width="5"
          stroke-dasharray="${dash} ${gap}"
          stroke-linecap="round"
          style="filter: drop-shadow(0 0 4px ${strokeColor}60);"
        />
        <text
          x="44"
          y="38"
          text-anchor="middle"
          fill="#E4E6ED"
          font-size="14"
          font-family="JetBrains Mono, monospace"
          font-weight="600"
          style="transform: rotate(90deg); transform-origin: 44px 44px;"
        >
          ${used}
        </text>
        <text
          x="44"
          y="53"
          text-anchor="middle"
          fill="#6B7280"
          font-size="9"
          font-family="JetBrains Mono, monospace"
          style="transform: rotate(90deg); transform-origin: 44px 44px;"
        >
          / ${total}
        </text>
      </svg>
      <span class="budget-ring-label">Daily API<br/>Budget</span>
    </div>
  `;
}

// Render dynamic animated waveform
function renderWaveform() {
  let bars = '';
  for (let i = 0; i < 36; i++) {
    const opacity = 0.3 + (i % 5) * 0.12;
    const height = 30 + Math.abs(Math.sin(i * 0.7)) * 60;
    const duration = 0.5 + (i % 7) * 0.09;
    const delay = (i % 4) * 0.07;
    bars += `<div class="waveform-bar" style="background: rgba(34, 211, 238, ${opacity}); height: ${height}%; animation-duration: ${duration}s; animation-delay: ${delay}s;"></div>`;
  }
  return `<div class="waveform-container">${bars}</div>`;
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
      <link rel="stylesheet" href="/dashboard/dashboard-theme.css">
    </head>
    <body class="login-body">
      <div class="login-card">
        <h1>Cresca OS Auth</h1>
        <p>Hermes Portal Auth - Enter your administration security token</p>
        <div id="error-message" style="display: none; color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;"></div>
        <input type="password" id="token" placeholder="INTERNAL_ADMIN_TOKEN" class="input" onkeydown="if(event.key==='Enter') login()"/>
        <div class="btn btn-primary" onclick="login()" style="cursor: pointer;">Enter Dashboard</div>
      </div>
      <script>
        function login() {
          const t = document.getElementById('token').value.trim();
          if (t) {
            const params = new URLSearchParams(window.location.search);
            params.set('token', t);
            window.location.href = window.location.pathname + '?' + params.toString();
          }
        }
        // Try reading token from query or URL if passed
        const urlParams = new URLSearchParams(window.location.search);
        const tok = urlParams.get('token');
        if (tok) {
          sessionStorage.removeItem('hermes_admin_token');
          const errDiv = document.getElementById('error-message');
          if (errDiv) {
            errDiv.style.display = 'block';
            errDiv.textContent = 'Invalid security token. Please try again.';
          }
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

function getSafetyStatus() {
  try {
    const registry = require('../runtime/connector-registry');
    const connectors = registry.listConnectors();
    if (connectors && connectors.length > 0 && connectors.every(c => c.realExecutionEnabled === false)) {
      return {
        verified: true,
        title: "Safety Mode: Dry-Run Active (realExecutionEnabled = false)",
        desc: "No automated outreach (email, SMS, social DMs) is dispatched. CRM synchronizations are in preview mode. Manual review required."
      };
    }
  } catch (e) {}
  return {
    verified: false,
    title: "Safety state unavailable — assume locked",
    desc: "No automated outreach is dispatched. Connector configuration status is unverified."
  };
}

/**
 * Shell Layout View Template
 */
function renderDashboardShell(title, activeTab, content, token) {
  const safety = getSafetyStatus();
  const bannerClass = safety.verified ? "" : " safety-unavailable";
  const tParam = token ? `` : '';
  const links = [
    { id: 'overview', href: '/dashboard', label: 'Overview', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>` },
    { id: 'cockpit', href: '/dashboard/cockpit', label: 'Cockpit', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6l4 2"/></svg>` },
    { id: 'prospects', href: '/dashboard/prospects', label: 'Prospects', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    { id: 'research', href: '/dashboard/research', label: 'Research', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><path d="M11 8a3 3 0 0 0-3 3"/></svg>` },
    { id: 'scores', href: '/dashboard/scores', label: 'Scores', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
    { id: 'outreach', href: '/dashboard/outreach', label: 'Outreach', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
    { id: 'queue', href: '/dashboard/queue', label: 'Queue', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>` },
    { id: 'trace', href: '/dashboard/trace', label: 'Trace', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
    { id: 'brief', href: '/dashboard/brief', label: 'Daily Brief', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
    { id: 'usage', href: '/dashboard/usage', label: 'LLM Usage', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>` },
    { id: 'playbook', href: '/dashboard/playbook', label: 'Playbook', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20M4 19.5V3.5A2.5 2.5 0 0 1 6.5 1M20 1v21H6.5"/></svg>` },
  ];

  let navLinksHtml = '';
  let mobileLinksHtml = '';
  for (const link of links) {
    const isActive = activeTab === link.id;
    navLinksHtml += `
      <a href="${link.href}" onclick="appendToken(this)" class="sidebar-link ${isActive ? 'active' : ''}">
        ${link.icon}
        <span>${link.label}</span>
      </a>
    `;
    mobileLinksHtml += `
      <a href="${link.href}" onclick="appendToken(this)" class="sidebar-link ${isActive ? 'active' : ''}">
        ${link.icon}
        <span>${link.label}</span>
      </a>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>OpenClaw Hermes Dashboard - ${title}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/dashboard/dashboard-theme.css">
    </head>
    <body>
      <div class="app-layout">
        <!-- Sidebar -->
        <aside class="sidebar">
          <a href="/dashboard" onclick="appendToken(this)" class="sidebar-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#logoGrad)" />
              <path d="M2 17L12 22L22 17" stroke="url(#logoGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="url(#logoGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <defs>
                <linearGradient id="logoGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#22D3EE" />
                  <stop offset="1" stop-color="#0284C7" />
                </linearGradient>
              </defs>
            </svg>
            <h1>Cresca OS</h1>
          </a>
          <nav class="sidebar-nav">
            ${navLinksHtml}
          </nav>
        </aside>

        <!-- Mobile Header -->
        <header class="mobile-header">
          <a href="/dashboard" onclick="appendToken(this)" class="mobile-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#22D3EE" />
              <path d="M2 17L12 22L22 17" stroke="#22D3EE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <h1>Cresca OS</h1>
          </a>
          <div class="mobile-menu-toggle" onclick="toggleMobileMenu()" style="cursor: pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </div>
        </header>
        
        <div id="mobile-nav-menu" class="mobile-nav-menu">
          ${mobileLinksHtml}
        </div>

        <!-- Main Content -->
        <main class="content-area">
          <!-- Persistent Safety Banner -->
          <div class="safety-banner${bannerClass}">
            <span class="safety-banner-icon">⚠️</span>
            <div class="safety-banner-text">
              <h3 class="safety-banner-title">${safety.title}</h3>
              <p class="safety-banner-desc">${safety.desc}</p>
            </div>
          </div>

          ${content}
        </main>
      </div>

      <script>
        function toggleMobileMenu() {
          const m = document.getElementById('mobile-nav-menu');
          m.classList.toggle('show');
        }

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
          urlParams.delete('token');
          const newQuery = urlParams.toString();
          const newSearch = newQuery ? '?' + newQuery : '';
          window.history.replaceState({}, document.title, window.location.pathname + newSearch);
        }

        // Auto-populate all form token inputs
        document.addEventListener('DOMContentLoaded', () => {
          const token = sessionStorage.getItem('hermes_admin_token');
          if (token) {
            document.querySelectorAll('input[name="token"]').forEach(input => {
              input.value = token;
            });
          }
        });
      </script>
    </body>
    </html>
  `;
}

// 1. Overview Page Route
router.get('/', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const health = obs.getHermesQueueHealth();
  
  // Calculate budget metrics for the ring
  const todayDate = new Date();
  const y = todayDate.getFullYear();
  const m = todayDate.getMonth() + 1;
  const todayStr = todayDate.toISOString().substring(0, 10);
  const thisMonthPrefix = `${y}-${String(m).padStart(2, '0')}`;
  const startOfMonth = `${thisMonthPrefix}-01T00:00:00.000Z`;
  const endOfMonth = `${thisMonthPrefix}-31T23:59:59.999Z`;
  
  const todaySummary = analytics.buildDailyUsageSummary(todayStr);
  const monthlySummary = analytics.buildMonthlyUsageSummary(y, m);
  const budgetWarning = analytics.buildBudgetWarningSummary({ startDate: startOfMonth, endDate: endOfMonth });

  const content = `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Total Jobs</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="metric-value">${health.totalJobs}</div>
        <div class="metric-sub">Hermes lifecycle count</div>
      </div>
      <div class="metric-card" style="border-color: rgba(59, 130, 246, 0.25);">
        <div class="metric-header">
          <span class="metric-label" style="color: #60a5fa;">Active Jobs</span>
          <span class="badge badge-running" style="font-size: 0.6rem; padding: 0.05rem 0.25rem;">Processing</span>
        </div>
        <div class="metric-value" style="color: #60a5fa;">${health.activeJobs}</div>
        <div class="metric-sub">Executing in runtime</div>
      </div>
      <div class="metric-card" style="border-color: rgba(167, 139, 250, 0.25);">
        <div class="metric-header">
          <span class="metric-label" style="color: #c084fc;">Awaiting Approval</span>
          <span class="badge badge-awaiting_approval" style="font-size: 0.6rem; padding: 0.05rem 0.25rem;">Gated</span>
        </div>
        <div class="metric-value" style="color: #c084fc;">${health.awaitingApprovalJobs}</div>
        <div class="metric-sub">Awaiting release token</div>
      </div>
      <div class="metric-card" style="border-color: rgba(74, 222, 128, 0.2);">
        <div class="metric-header">
          <span class="metric-label" style="color: #34d399;">Completed</span>
          <svg width="16" height="16" fill="none" stroke="#34d399" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3"/></svg>
        </div>
        <div class="metric-value" style="color: #34d399;">${health.completedJobs}</div>
        <div class="metric-sub">Successfully closed</div>
      </div>
      <div class="metric-card" style="border-color: rgba(248, 113, 113, 0.25);">
        <div class="metric-header">
          <span class="metric-label" style="color: #f87171;">Failed</span>
          <svg width="16" height="16" fill="none" stroke="#f87171" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
        </div>
        <div class="metric-value" style="color: #f87171;">${health.failedJobs}</div>
        <div class="metric-sub">Requires triage</div>
      </div>
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Daily Spend</span>
          <span class="metric-sub">LLM API</span>
        </div>
        <div class="metric-value">$${todaySummary.totalCostUsd.toFixed(3)}</div>
        <div class="metric-sub">${todaySummary.totalTokens.toLocaleString()} tokens</div>
      </div>
      <div class="metric-card" style="border-color: ${budgetWarning.exceeded ? 'rgba(239, 68, 68, 0.4)' : 'var(--border)'};">
        <div class="metric-header">
          <span class="metric-label">Monthly Spend</span>
          <span class="metric-sub">Limit</span>
        </div>
        <div class="metric-value" style="${budgetWarning.exceeded ? 'color: #f87171;' : ''}">$${monthlySummary.totalCostUsd.toFixed(2)}</div>
        <div class="metric-sub">Budget Cap: $${budgetWarning.budgetUsd.toFixed(0)}</div>
      </div>
    </div>

    <div class="grid-aside">
      <div class="panel">
        <h2>🛰️ Queue Diagnostics</h2>
        <div class="detail-row">
          <span class="detail-label">Queued Status:</span>
          <span class="detail-value">${health.queuedJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Dispatched/Running:</span>
          <span class="detail-value">${health.dispatchedRunningJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blocked Status:</span>
          <span class="detail-value">${health.blockedJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Canceled Status:</span>
          <span class="detail-value">${health.canceledJobs}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duplicate Rejections:</span>
          <span class="detail-value">${health.duplicateRejectionCount}</span>
        </div>
      </div>
      
      <div class="panel" style="display: flex; flex-direction: column; justify-content: space-between;">
        <h2>🛡️ Safety & Execution Configuration</h2>
        <div class="detail-row">
          <span class="detail-label">Real External Writes:</span>
          <span class="badge ${health.realExternalExecutionDisabled ? 'badge-failed' : 'badge-completed'}">${health.realExternalExecutionDisabled ? 'DISABLED' : 'ENABLED'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Connector Mode:</span>
          <span class="detail-value"><code>${health.connectorMode}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Job:</span>
          <span class="detail-value"><code>${health.latestJobId || 'None'}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Completed:</span>
          <span class="detail-value"><code>${health.latestCompletedJobId || 'None'}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Latest Failed:</span>
          <span class="detail-value"><code>${health.latestFailedJobId || 'None'}</code></span>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel" style="display: flex; align-items: center; justify-content: center; padding: 2rem 1rem;">
        ${renderBudgetRing(Math.round(monthlySummary.totalCostUsd), Math.round(budgetWarning.budgetUsd))}
      </div>
      
      <div class="panel" style="display: flex; flex-direction: column; justify-content: center;">
        <h2>📡 Live Queue Telemetry Waveform</h2>
        <p class="panel-subtitle">Visualizing real-time request activities and pipeline loads</p>
        ${renderWaveform()}
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Overview', 'overview', content, token));
});

// 2. Queue Page Route
router.get('/queue', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
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
    <div class="panel">
      <h2>📋 Jobs Queue Registry</h2>
      <p class="panel-subtitle">Manage runtime Hermes automation tasks and execution lifecycle states.</p>
      
      <form method="GET" action="/dashboard/queue" class="filter-bar">
        <input type="hidden" name="token" value="" />
        
        <div class="filter-group">
          <label>Search Keywords</label>
          <input type="text" name="q" value="${q || ''}" placeholder="Search keywords..." />
        </div>
        
        <div class="filter-group">
          <label>Status</label>
          <select name="status">
            <option value="">-- All Statuses --</option>
            ${['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running', 'completed', 'failed', 'canceled', 'blocked']
              .map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label>Target Bot</label>
          <select name="botId">
            <option value="">-- All Bots --</option>
            ${['content-forge', 'lead-acquisition-engine', 'revenue-master-orchestrator', 'cresca-content-aeo-engine', 'system-master-orchestrator', 'revenue-optimization-engine', 'weekly-command-center', 'client-value-maximizer', 'auto-loop-system']
              .map(b => `<option value="${b}" ${botId === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label>Priority</label>
          <select name="priority">
            <option value="">-- All Priorities --</option>
            ${['low', 'normal', 'high', 'urgent']
              .map(p => `<option value="${p}" ${priority === p ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('')}
          </select>
        </div>

        <button type="submit" class="btn btn-primary" style="height: 40px;">Apply Filters</button>
      </form>

      <div class="table-container">
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
                  <td><code style="color: ${j.priority === 'urgent' ? '#F87171' : j.priority === 'high' ? '#fbbf24' : '#E4E6ED'}">${j.priority || 'normal'}</code></td>
                  <td><code>${j.requestedBy || 'system'}</code></td>
                  <td>${j.updatedAt}</td>
                  <td>
                    <a href="/dashboard/trace?jobId=${j.hermesJobId}" class="action-link" onclick="appendToken(this)">Trace Lifecycle</a>
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'queued' || j.status === 'approved')) ? ` | <a href="/dashboard/action/confirm?action=dispatch&jobId=${j.hermesJobId}" onclick="appendToken(this)" class="action-link" style="color: #4ADE80; font-weight: 600;">Dispatch</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'awaiting_approval' && j.approvalId)) ? ` | <a href="/dashboard/action/confirm?action=approve&approvalId=${j.approvalId}" onclick="appendToken(this)" class="action-link" style="color: #C084FC; font-weight: 600;">Approve</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status === 'failed' || j.status === 'blocked')) ? ` | <a href="/dashboard/action/confirm?action=retry&jobId=${j.hermesJobId}" onclick="appendToken(this)" class="action-link" style="color: #FBBF24; font-weight: 600;">Retry</a>` : ''}
                    ${(process.env.DASHBOARD_ACTIONS_ENABLED === 'true' && (j.status !== 'completed' && j.status !== 'failed' && j.status !== 'canceled')) ? ` | <a href="/dashboard/action/confirm?action=cancel&jobId=${j.hermesJobId}" onclick="appendToken(this)" class="action-link" style="color: #F87171; font-weight: 600;">Cancel</a>` : ''}
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
  const token = (req.body && req.body.token);
  const { jobId } = req.query;

  let job = null;
  let textTrace = '';
  if (jobId && jobId.trim()) {
    const cleanId = jobId.trim();
    job = engine.readHermesJob(cleanId);
    textTrace = obs.buildHermesTrace(cleanId);
  }

  const content = `
    <div class="panel">
      <h2>🔍 Job Lifecycle Trace Engine</h2>
      <p class="panel-subtitle">Diagnose the execution pipeline, trace steps, and log audits for individual Hermes tasks.</p>
      
      <form method="GET" action="/dashboard/trace" class="filter-bar">
        <input type="hidden" name="token" value="" />
        <div class="filter-group">
          <label>Hermes Job ID</label>
          <input type="text" name="jobId" value="${jobId || ''}" placeholder="Enter Hermes Job ID (e.g. hm_...)" />
        </div>
        <button type="submit" class="btn btn-primary" style="height: 40px;">Trace Lifecycle</button>
      </form>

      ${!jobId ? '<p style="color: var(--text-secondary); font-size: 0.9rem;">Enter a Job ID to begin tracing.</p>' : 
        !job ? `<div class="panel" style="border-color: #F87171; background: rgba(239, 68, 68, 0.05); text-align: center; color: #F87171;">❌ Error: Hermes Job <code>${jobId}</code> not found in queue store.</div>` : `
          
          <div class="trace-timeline">
            <div class="trace-node completed">
              <div class="trace-node-title">Request Ingested</div>
              <div class="trace-node-desc">telegram_requests/</div>
            </div>
            
            <div class="trace-node completed">
              <div class="trace-node-title">Hermes Job</div>
              <div class="trace-node-desc"><code>${job.hermesJobId}</code></div>
            </div>
            
            <div class="trace-node ${job.runtimeJobId ? 'completed' : 'active'}">
              <div class="trace-node-title">Runtime Job</div>
              <div class="trace-node-desc">${job.runtimeJobId ? `<code>${job.runtimeJobId}</code>` : 'Pending'}</div>
            </div>

            <div class="trace-node ${job.approvalId ? (job.status === 'awaiting_approval' ? 'active' : 'completed') : ''}">
              <div class="trace-node-title">Approval Token</div>
              <div class="trace-node-desc">${job.approvalId ? `<code>${job.approvalId}</code>` : 'None Required'}</div>
            </div>

            <div class="trace-node ${job.outputPath ? 'completed' : ''}">
              <div class="trace-node-title">Output Path</div>
              <div class="trace-node-desc">${job.outputPath ? `<code>${job.outputPath}</code>` : 'None'}</div>
            </div>

            <div class="trace-node ${job.driveLink ? 'completed' : ''}">
              <div class="trace-node-title">Drive Link</div>
              <div class="trace-node-desc">${job.driveLink ? `<a href="${job.driveLink}" target="_blank" class="action-link">Published</a>` : 'Not Sync\'d'}</div>
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
              <div class="panel" style="margin-top: 2rem; border-color: rgba(139, 92, 246, 0.4); background: rgba(139, 92, 246, 0.03);">
                <h2>⚡ Operator Control Panel</h2>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem;">
            `;
            if (canDispatch) {
              html += `<a href="/dashboard/action/confirm?action=dispatch&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="btn btn-success">🚀 Dispatch Job</a>`;
            }
            if (canApprove) {
              html += `<a href="/dashboard/action/confirm?action=approve&approvalId=${job.approvalId}" onclick="appendToken(this)" class="btn btn-primary">✅ Approve Execution</a>`;
            }
            if (canRetry) {
              html += `<a href="/dashboard/action/confirm?action=retry&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="btn btn-warning">🔄 Retry Job</a>`;
            }
            if (canCancel) {
              html += `<a href="/dashboard/action/confirm?action=cancel&jobId=${job.hermesJobId}" onclick="appendToken(this)" class="btn btn-danger">❌ Cancel Job</a>`;
            }
            html += `
                </div>
              </div>
            `;
            return html;
          })()}

          <div class="grid-2" style="margin-top: 2rem;">
            <div class="panel">
              <h2>📊 Execution Event Logs</h2>
              <div class="trace-events-list" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">
                ${(job.events || []).map(e => `
                  <div style="padding: 0.85rem; border-left: 3px solid var(--primary); background: rgba(255, 255, 255, 0.015); border-radius: 0 var(--radius) var(--radius) 0; font-size: 0.85rem;">
                    <div style="font-size: 0.7rem; color: #6b7280; font-family: monospace; margin-bottom: 0.25rem;">${e.timestamp}</div>
                    <div style="color: #cbd5e1;">${e.message}</div>
                  </div>
                `).join('')}
              </div>
            </div>
            
            <div class="panel">
              <h2>📄 Sanitized Trace Breakdown</h2>
              <pre style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border); padding: 1.25rem; border-radius: var(--radius); color: #cbd5e1; overflow-x: auto; font-family: monospace; white-space: pre-wrap; font-size: 0.8rem; height: 350px; margin-top: 1rem;">${textTrace}</pre>
            </div>
          </div>
        `}
    </div>
  `;

  res.send(renderDashboardShell('Trace', 'trace', content, token));
});

// 4. Daily Brief Page Route
router.get('/brief', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
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
    <div class="grid-aside">
      <div class="panel">
        <h2>📆 Daily Brief Summary (${brief.date})</h2>
        <p class="panel-subtitle">Review of today's runs, execution safety flags, failures, and recommended steps.</p>
        
        <div class="detail-row">
          <span class="detail-label">Jobs Created Today:</span>
          <span class="detail-value"><strong>${qs.total}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Jobs Completed Today:</span>
          <span class="detail-value" style="color: #34d399;"><strong>${qs.completed}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Failures Encountered Today:</span>
          <span class="detail-value" style="color: ${qs.failed > 0 ? '#F87171' : '#cbd5e1'}"><strong>${qs.failed}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Currently Awaiting Approval:</span>
          <span class="detail-value" style="color: ${qs.awaiting > 0 ? '#C084FC' : '#cbd5e1'}"><strong>${qs.awaiting}</strong></span>
        </div>

        <h2 style="margin-top: 2rem;">💸 LLM Token & Cost Summary</h2>
        <div class="detail-row">
          <span class="detail-label">Total Consumption Cost:</span>
          <span class="detail-value" style="color: #22D3EE;"><strong>$${us.totalCostUsd.toFixed(5)} USD</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Total Consumed Tokens:</span>
          <span class="detail-value"><strong>${us.totalTokens.toLocaleString()}</strong></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Input Tokens:</span>
          <span class="detail-value">${us.totalInputTokens.toLocaleString()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Output Tokens:</span>
          <span class="detail-value">${us.totalOutputTokens.toLocaleString()}</span>
        </div>

        <h2 style="margin-top: 2rem;">🚀 Top Bots Used Today</h2>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
          ${qs.topBots.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No bot executions today.</p>' : 
            qs.topBots.map(b => `
              <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                <span><code>${b.botId}</code></span>
                <span class="badge badge-queued">${b.count} runs</span>
              </div>
            `).join('')}
        </div>

        <h2 style="margin-top: 2rem;">📂 Latest Outputs Generated</h2>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
          ${qs.latestOutputs.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No outputs generated today.</p>' : 
            qs.latestOutputs.slice(0, 10).map(o => `
              <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.85rem;">
                <span style="font-family: monospace; font-size: 0.8rem; color: #94A3B8;">${o.outputPath}</span>
                <span>${o.driveLink ? `<a href="${o.driveLink}" target="_blank" class="action-link">Drive Url</a>` : '<span style="color: #6b7280;">Local outbox</span>'}</span>
              </div>
            `).join('')}
        </div>

        <h2 style="margin-top: 2rem;">❌ Failures Today</h2>
        <div style="margin-top: 1rem;">
          ${fsList.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No failures today.</p>' :
            fsList.map(f => `
              <div style="background: rgba(239, 68, 68, 0.03); border: 1px solid rgba(239, 68, 68, 0.2); padding: 1rem; border-radius: var(--radius); margin-bottom: 1rem;">
                <div style="font-weight: 600; color: #F87171; margin-bottom: 0.25rem;">
                  Job: <code>${f.hermesJobId}</code> (${f.botId})
                </div>
                <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.5rem;">
                  Category: <code>${f.errorCategory}</code> | Status: <span class="badge badge-failed">${f.status}</span>
                </div>
                <pre style="font-family: monospace; white-space: pre-wrap; font-size: 0.75rem; background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 4px; color: #cbd5e1; margin: 0;">${f.safeMessage}</pre>
              </div>
            `).join('')}
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        <div class="panel" style="border-color: rgba(139, 92, 246, 0.3);">
          <h2>💡 Recommended Operator Actions</h2>
          <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
            ${ra.length === 0 ? `
              <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); padding: 0.85rem; border-radius: var(--radius); color: #34d399; font-size: 0.85rem;">
                ✅ All systems quiet. No immediate actions required. System status is stable.
              </div>
            ` : ra.map(act => {
              let actionBtnHtml = '';
              if (act.command && process.env.DASHBOARD_ACTIONS_ENABLED === 'true') {
                if (act.command.startsWith('/approve_run ')) {
                  const appVal = act.command.substring(13).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=approve&approvalId=${encodeURIComponent(appVal)}" onclick="appendToken(this)" class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">Approve Now</a></div>`;
                } else if (act.command.startsWith('/hermes_retry ')) {
                  const jobVal = act.command.substring(14).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=retry&jobId=${encodeURIComponent(jobVal)}" onclick="appendToken(this)" class="btn btn-warning" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">Retry Now</a></div>`;
                } else if (act.command.startsWith('/hermes_dispatch ')) {
                  const jobVal = act.command.substring(17).trim();
                  actionBtnHtml = `<div style="margin-top: 0.5rem;"><a href="/dashboard/action/confirm?action=dispatch&jobId=${encodeURIComponent(jobVal)}" onclick="appendToken(this)" class="btn btn-success" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">Dispatch Now</a></div>`;
                }
              }
              return `
                <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 1rem; border-radius: var(--radius); color: #fbbf24; font-size: 0.85rem;">
                  <strong style="display: block; margin-bottom: 0.25rem;">${act.message}</strong>
                  ${act.command ? `<div style="margin-top: 0.25rem; font-family: monospace; font-size: 0.75rem; color: #94A3B8;">Run: ${act.command}</div>` : ''}
                  ${actionBtnHtml}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="panel" style="border-color: rgba(255, 255, 255, 0.1);">
          <h2>🛡️ Safety Confirmation</h2>
          <div class="detail-row" style="margin-top: 1rem;">
            <span class="detail-label">Runtime frozen:</span>
            <span class="detail-value" style="color: ${sc.runtimeFrozen ? '#34d399' : '#fbbf24'}; font-weight: bold;">${sc.runtimeFrozen ? 'CONFIRMED' : 'WARNING'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Real Writes:</span>
            <span class="badge ${sc.realExecutionEnabled ? 'badge-failed' : 'badge-completed'}">${sc.realExecutionEnabled ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Connector mode:</span>
            <span class="detail-value"><code>${sc.connectorMode}</code></span>
          </div>
        </div>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Daily Brief', 'brief', content, token));
});

// Fallback redirect for /daily-brief
router.get('/daily-brief', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  res.redirect(`/dashboard/brief`);
});

// 5. Usage Page Route
router.get('/usage', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
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
      <div class="panel" style="border-left: 4px solid var(--destructive); background: rgba(248, 113, 113, 0.05); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1.5rem; box-shadow: 0 0 15px rgba(248, 113, 113, 0.1);">
        <div style="font-size: 2rem;">⚠️</div>
        <div>
          <h3 style="margin: 0; color: var(--destructive); font-size: 1rem; font-weight: 700;">Monthly Spend Budget Exceeded</h3>
          <p style="margin: 0.15rem 0 0 0; font-size: 0.85rem; color: var(--text-secondary);">
            Operational spend of <strong>$${budgetWarning.currentCostUsd.toFixed(5)}</strong> for <strong>${thisMonthPrefix}</strong> exceeds the set budget cap of <strong>$${budgetWarning.budgetUsd.toFixed(2)}</strong>.
          </p>
        </div>
      </div>
    `;
  }

  const content = `
    ${alertHtml}

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Spend Today</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="metric-value">$${todaySummary.totalCostUsd.toFixed(4)}</div>
        <div class="metric-sub">Tokens: ${todaySummary.totalTokens.toLocaleString()}</div>
      </div>
      <div class="metric-card" style="border-color: ${budgetWarning.exceeded ? 'var(--destructive)' : 'var(--border)'};">
        <div class="metric-header">
          <span class="metric-label">Spend This Month</span>
          <span class="badge ${budgetWarning.exceeded ? 'badge-failed' : 'badge-completed'}" style="font-size: 0.65rem;">
            ${(budgetWarning.currentCostUsd / budgetWarning.budgetUsd * 100).toFixed(0)}%
          </span>
        </div>
        <div class="metric-value">$${monthlySummary.totalCostUsd.toFixed(2)}</div>
        <div class="metric-sub">Limit Cap: $${budgetWarning.budgetUsd.toFixed(2)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Filtered Cost</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3"/></svg>
        </div>
        <div class="metric-value">$${filteredSummary.totalCostUsd.toFixed(4)}</div>
        <div class="metric-sub">Filtered Runs: ${filteredSummary.entryCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-header">
          <span class="metric-label">Filtered Tokens</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="metric-value">${filteredSummary.totalTokens.toLocaleString()}</div>
        <div class="metric-sub">In: ${filteredSummary.totalInputTokens.toLocaleString()} / Out: ${filteredSummary.totalOutputTokens.toLocaleString()}</div>
      </div>
    </div>

    <form method="GET" action="/dashboard/usage" class="filter-bar">
      <input type="hidden" name="token" value="" />
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) auto; gap: 1rem; width: 100%; align-items: end;">
        <div class="filter-group">
          <label>Start Date</label>
          <input type="date" name="startDate" value="${startDate || ''}" />
        </div>
        <div class="filter-group">
          <label>End Date</label>
          <input type="date" name="endDate" value="${endDate || ''}" />
        </div>
        <div class="filter-group">
          <label>Provider</label>
          <select name="provider">
            <option value="">-- All Providers --</option>
            ${['openai', 'anthropic', 'google', 'openrouter', 'mock'].map(p => `<option value="${p}" ${provider === p ? 'selected' : ''}>${p.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group">
          <label>Bot ID</label>
          <select name="botId">
            <option value="">-- All Bots --</option>
            ${['content-forge', 'lead-acquisition-engine', 'revenue-master-orchestrator', 'cresca-content-aeo-engine', 'system-master-orchestrator', 'revenue-optimization-engine', 'weekly-command-center', 'client-value-maximizer', 'auto-loop-system'].map(b => `<option value="${b}" ${botId === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn-primary" style="height: 40px;">Apply Filters</button>
      </div>
    </form>

    <div class="grid-2">
      <div class="panel">
        <h2>💸 Cost Distribution by Bot</h2>
        <div style="margin-top: 1.25rem;">
          ${botBreakdown.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No bot usage records found.</p>' : 
            botBreakdown.map(data => {
              return `
                <div class="progress-container" style="margin-bottom: 1.25rem;">
                  <div class="progress-header" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
                    <span><code>${data.botId}</code> (${data.count} runs)</span>
                    <span style="color: var(--primary); font-weight: 600;">$${data.costUsd.toFixed(5)} (${data.percent}%)</span>
                  </div>
                  <div class="progress-bar-bg" style="background: rgba(255, 255, 255, 0.05); height: 6px; border-radius: 3px; overflow: hidden;">
                    <div class="progress-bar-fill" style="width: ${data.percent}%; background: linear-gradient(90deg, #8B5CF6 0%, #22D3EE 100%); height: 100%; border-radius: 3px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>🤖 Usage Distribution by Model</h2>
        <div style="margin-top: 1.25rem;">
          ${modelBreakdown.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No model usage records found.</p>' : 
            modelBreakdown.map(data => {
              return `
                <div class="progress-container" style="margin-bottom: 1.25rem;">
                  <div class="progress-header" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
                    <span><code>${data.model}</code> (${data.count} calls)</span>
                    <span style="color: #4ADE80; font-weight: 600;">${data.totalTokens.toLocaleString()} tkn (${data.percent}%)</span>
                  </div>
                  <div class="progress-bar-bg" style="background: rgba(255, 255, 255, 0.05); height: 6px; border-radius: 3px; overflow: hidden;">
                    <div class="progress-bar-fill" style="width: ${data.percent}%; background: linear-gradient(90deg, #22D3EE 0%, #4ADE80 100%); height: 100%; border-radius: 3px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top: 1.5rem;">
      <div class="panel">
        <h2>🛰️ Cost Distribution by Provider</h2>
        <div style="margin-top: 1.25rem;">
          ${providerBreakdown.length === 0 ? '<p style="color: var(--text-secondary); font-size: 0.85rem;">No provider usage records found.</p>' : 
            providerBreakdown.map(data => {
              return `
                <div class="progress-container" style="margin-bottom: 1.25rem;">
                  <div class="progress-header" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
                    <span><code>${data.provider}</code> (${data.count} calls)</span>
                    <span style="color: #A78BFA; font-weight: 600;">$${data.costUsd.toFixed(5)} (${data.percent}%)</span>
                  </div>
                  <div class="progress-bar-bg" style="background: rgba(255, 255, 255, 0.05); height: 6px; border-radius: 3px; overflow: hidden;">
                    <div class="progress-bar-fill" style="width: ${data.percent}%; background: linear-gradient(90deg, #8B5CF6 0%, #4ADE80 100%); height: 100%; border-radius: 3px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>📈 Heuristics vs API Usage</h2>
        <div style="display: flex; flex-direction: column; gap: 1.25rem; margin-top: 1.25rem;">
          <div class="progress-container">
            <div class="progress-header" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
              <span><strong>Actual API Metrics</strong> (${estVsAct.actual.count} calls)</span>
              <span style="color: #34D399; font-weight: 600;">$${estVsAct.actual.costUsd.toFixed(5)} (${estVsAct.actual.costPercent}%)</span>
            </div>
            <div class="progress-bar-bg" style="background: rgba(255, 255, 255, 0.05); height: 6px; border-radius: 3px; overflow: hidden;">
              <div class="progress-bar-fill" style="width: ${estVsAct.actual.costPercent}%; background: linear-gradient(90deg, #10B981 0%, #3B82F6 100%); height: 100%; border-radius: 3px;"></div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Tokens: ${estVsAct.actual.totalTokens.toLocaleString()} (${estVsAct.actual.tokenPercent}%)
            </div>
          </div>
          <div class="progress-container">
            <div class="progress-header" style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
              <span><strong>Estimated Heuristics</strong> (${estVsAct.estimated.count} calls)</span>
              <span style="color: #FBBF24; font-weight: 600;">$${estVsAct.estimated.costUsd.toFixed(5)} (${estVsAct.estimated.costPercent}%)</span>
            </div>
            <div class="progress-bar-bg" style="background: rgba(255, 255, 255, 0.05); height: 6px; border-radius: 3px; overflow: hidden;">
              <div class="progress-bar-fill" style="width: ${estVsAct.estimated.costPercent}%; background: linear-gradient(90deg, #FBBF24 0%, #F87171 100%); height: 100%; border-radius: 3px;"></div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Tokens: ${estVsAct.estimated.totalTokens.toLocaleString()} (${estVsAct.estimated.tokenPercent}%)
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top: 1.5rem;">
      <h2>📖 Usage Logs (Showing up to 100 events)</h2>
      <p class="panel-subtitle">Audited event entries matching current filters.</p>
      <div class="table-container">
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
                  <td><a href="/dashboard/trace?jobId=${e.hermesJobId || e.runtimeJobId || ''}" class="action-link" onclick="appendToken(this)">Trace</a></td>
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
  const token = (req.body && req.body.token);
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
      <div class="detail-row"><span class="detail-label">Job ID:</span><span class="detail-value"><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span class="detail-value"><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Priority:</span><span class="detail-value"><code>${job.priority || 'normal'}</code></span></div>
      <div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value"><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row"><span class="detail-label">Input Preview:</span><span class="detail-value"><code>${job.inputSummary}</code></span></div>
    `;
    targetUrl = '/dashboard/action/dispatch';
  } else if (action === 'cancel') {
    title = 'Confirm Job Cancellation';
    const job = engine.readHermesJob(jobId);
    if (!job) return res.status(404).send('Job not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Job ID:</span><span class="detail-value"><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span class="detail-value"><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Status:</span><span class="detail-value"><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row" style="flex-direction: column; align-items: flex-start; gap: 0.5rem; border: none; margin-top: 1rem;">
        <span class="detail-label">Cancellation Reason:</span>
        <textarea name="reason" placeholder="Explain why this job is being canceled..." style="width:100%; box-sizing:border-box; height:80px;" required>Operator canceled execution via Web Dashboard</textarea>
      </div>
    `;
    targetUrl = '/dashboard/action/cancel';
  } else if (action === 'retry') {
    title = 'Confirm Job Retry';
    const job = engine.readHermesJob(jobId);
    if (!job) return res.status(404).send('Job not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Original Job ID:</span><span class="detail-value"><code>${job.hermesJobId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot ID:</span><span class="detail-value"><code>${job.botId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Previous Status:</span><span class="detail-value"><span class="badge badge-${job.status}">${job.status}</span></span></div>
      <div class="detail-row"><span class="detail-label">Safe Error Msg:</span><span class="detail-value">${job.safeMessage || 'N/A'}</span></div>
    `;
    targetUrl = '/dashboard/action/retry';
  } else if (action === 'approve') {
    title = 'Confirm Action Approval';
    const { getApproval } = require('../runtime/runtime-approvals');
    const record = getApproval(approvalId);
    if (!record) return res.status(404).send('Approval record not found');
    detailsHtml = `
      <div class="detail-row"><span class="detail-label">Approval ID:</span><span class="detail-value"><code>${record.approvalId}</code></span></div>
      <div class="detail-row"><span class="detail-label">Command:</span><span class="detail-value"><code>${record.command}</code></span></div>
      <div class="detail-row"><span class="detail-label">Bot / Preset:</span><span class="detail-value"><code>${record.botSlug || record.presetId || 'N/A'}</code></span></div>
      <div class="detail-row"><span class="detail-label">Preview:</span><span class="detail-value"><code>${record.inputPreview}</code></span></div>
    `;
    targetUrl = '/dashboard/action/approve';
  } else {
    return res.status(400).send('Invalid action type');
  }

  const content = `
    <div class="panel" style="max-width: 600px; margin: 3rem auto; border-color: var(--accent-purple);">
      <h2>🛡️ ${title}</h2>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
        Please confirm the action details below. This operation will mutate the operational Hermes queue and run inside a dry-run execution wrapper.
      </p>
      
      <form action="${targetUrl}" method="POST" id="confirmForm">
        <input type="hidden" name="jobId" value="${jobId || ''}" />
        <input type="hidden" name="approvalId" value="${approvalId || ''}" />
        <input type="hidden" name="nonce" value="${nonce}" />
        <input type="hidden" name="token" id="form-token" value="" />
        
        <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.5rem;">
          ${detailsHtml}
        </div>

        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
          <a href="javascript:history.back()" class="btn btn-secondary" style="line-height: 1.5;">Cancel</a>
          <button type="submit" class="btn btn-primary">Confirm & Execute</button>
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
  const token = req.body.token || (req.body && req.body.token);
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

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(jobId)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'dispatch',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Dispatch failed: ${sanitizeError()}`);
  }
});

// POST /dashboard/action/cancel
router.post('/action/cancel', verifyPostAction, rateLimitMiddleware, (req, res) => {
  const token = req.body.token || (req.body && req.body.token);
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

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(jobId)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'cancel',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Cancellation failed: ${sanitizeError()}`);
  }
});

// POST /dashboard/action/retry
router.post('/action/retry', verifyPostAction, rateLimitMiddleware, async (req, res) => {
  const token = req.body.token || (req.body && req.body.token);
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

    res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(newJob.hermesJobId)}`);
  } catch (err) {
    audit.logDashboardAction({
      actionType: 'retry',
      hermesJobId: jobId,
      actor: 'dashboard_admin',
      resultStatus: 'failure',
      safeMessage: err.message
    });
    res.status(500).send(`Retry failed: ${sanitizeError()}`);
  }
});

// POST /dashboard/action/approve
router.post('/action/approve', verifyPostAction, rateLimitMiddleware, async (req, res) => {
  const token = req.body.token || (req.body && req.body.token);
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
      res.redirect(`/dashboard/trace?jobId=${encodeURIComponent(hermesJobId)}`);
    } else {
      res.redirect(`/dashboard/queue`);
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
    res.status(500).send(`Approval failed: ${sanitizeError()}`);
  }
});

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GET /dashboard/prospects
router.get('/prospects', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const store = require('../prospects/prospect-store');
  const researchStore = require('../research/prospect-research-store');
  const scoreStore = require('../research/prospect-score-store');
  const prospects = store.loadProspects();

  // Load queue for fast job-status mapping
  const queueStore = require('../hermes/hermes-queue-store');
  const hermesQueue = queueStore.loadQueue() || {};

  // Handle optional query/filter
  const q = (req.query.q || '').trim().toLowerCase();
  const filtered = q 
    ? prospects.filter(p => {
        const name = (p.businessName || p.name || '').toLowerCase();
        const addr = (p.formattedAddress || '').toLowerCase();
        const qy = (p.query || '').toLowerCase();
        return name.includes(q) || addr.includes(q) || qy.includes(q);
      })
    : prospects;

  let rows = '';
  if (filtered.length > 0) {
    for (const p of filtered) {
      const displayName = p.businessName || p.name || 'Unknown Business';

      let jobHtml = '<span style="color: var(--muted-foreground);">None</span>';
      let actionHtml = '';

      const research = researchStore.getResearchForProspect(p.prospectId);
      const outreachModeLabel = research 
        ? `<div style="font-size: 0.75rem; color: #34d399; margin-top: 0.25rem; font-weight: 500;">Research-informed</div>`
        : `<div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem;">Basic prospect-only</div>`;

      if (p.hermesJobId) {
        const job = hermesQueue[p.hermesJobId];
        if (job) {
          jobHtml = `<a href="/dashboard/trace?jobId=${p.hermesJobId}" onclick="appendToken(this)" class="action-link"><code>${escapeHtml(p.hermesJobId)}</code></a> <span class="badge badge-${job.status}">${job.status}</span>`;
          const isActive = !['completed', 'failed', 'canceled'].includes(job.status);
          if (isActive) {
            actionHtml = `<span style="color: var(--muted-foreground); font-size: 0.85rem;">Job Active</span><br/>${outreachModeLabel}`;
          } else {
            actionHtml = `<a href="/dashboard/prospects/outreach/confirm?prospectId=${p.prospectId}" onclick="appendToken(this)" class="action-link" style="font-weight: 600;">Handoff Again</a>${outreachModeLabel}`;
          }
        } else {
          jobHtml = `<code>${escapeHtml(p.hermesJobId)}</code> <span style="color: var(--muted-foreground); font-size: 0.75rem;">(missing)</span>`;
          actionHtml = `<a href="/dashboard/prospects/outreach/confirm?prospectId=${p.prospectId}" onclick="appendToken(this)" class="action-link" style="font-weight: 600;">Outreach Handoff</a>${outreachModeLabel}`;
        }
      } else {
        actionHtml = `<a href="/dashboard/prospects/outreach/confirm?prospectId=${p.prospectId}" onclick="appendToken(this)" class="action-link" style="font-weight: 600;">Outreach Handoff</a>${outreachModeLabel}`;
      }

      let researchHtml = '';
      if (research) {
        researchHtml = `<a href="/dashboard/research/view?researchId=${research.researchId}" onclick="appendToken(this)" class="action-link" style="color: #38bdf8; font-weight: 600;">Findings</a> <span class="badge" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2);">Enriched</span>`;
      } else {
        researchHtml = `<span style="color: var(--muted-foreground);">None</span>`;
      }

      const score = scoreStore.getScoreForProspect(p.prospectId);
      let scoreHtml = '<span style="color: var(--muted-foreground);">None</span>';
      if (score) {
        let badgeColor = '#94a3b8';
        let badgeBg = 'rgba(148, 163, 184, 0.1)';
        let badgeBorder = 'rgba(148, 163, 184, 0.2)';
        if (score.priority === 'high') {
          badgeColor = '#10b981';
          badgeBg = 'rgba(16, 185, 129, 0.1)';
          badgeBorder = 'rgba(16, 185, 129, 0.2)';
        } else if (score.priority === 'medium') {
          badgeColor = '#f59e0b';
          badgeBg = 'rgba(245, 158, 11, 0.1)';
          badgeBorder = 'rgba(245, 158, 11, 0.2)';
        }
        scoreHtml = `
          <div style="font-weight: bold; color: ${badgeColor};">${score.fitScore}/100</div>
          <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">${score.priority.toUpperCase()}</span>
        `;
      }

      rows += `
        <tr>
          <td><strong>${escapeHtml(displayName)}</strong></td>
          <td>${escapeHtml(p.formattedAddress)}</td>
          <td>${escapeHtml(p.phoneNumber || 'N/A')}</td>
          <td>${p.website ? `<a href="${escapeHtml(p.website)}" target="_blank" rel="noopener noreferrer" class="action-link">${escapeHtml(p.website)}</a>` : 'N/A'}</td>
          <td><span class="badge" style="background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2);">${p.rating || 'N/A'} (${p.userRatingCount || 0})</span></td>
          <td><code>${escapeHtml(p.query)}</code></td>
          <td>${new Date(p.discoveredAt).toLocaleString()}</td>
          <td>${jobHtml}</td>
          <td>${researchHtml}</td>
          <td>${scoreHtml}</td>
          <td>${actionHtml}</td>
        </tr>
      `;
    }
  } else {
    rows = `<tr><td colspan="11" style="text-align: center; color: var(--muted-foreground);">No prospects found.</td></tr>`;
  }

  let bannerHtml = '';
  if (req.query.success === 'true') {
    const found = req.query.found || '0';
    const added = req.query.added || '0';
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Found ${escapeHtml(found)} prospects, added ${escapeHtml(added)} new prospects!
      </div>
    `;
  } else if (req.query.success === 'outreach_queued') {
    const jobId = req.query.jobId || '';
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Outreach Job Queued:</strong> Successfully created Hermes job <a href="/dashboard/trace?jobId=${escapeHtml(jobId)}" onclick="appendToken(this)" style="color: #34d399; font-weight: bold; text-decoration: underline;"><code>${escapeHtml(jobId)}</code></a>!
      </div>
    `;
  } else if (req.query.error) {
    bannerHtml = `
      <div style="color: #ef4444; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Error:</strong> ${escapeHtml(req.query.error)}
      </div>
    `;
  }

  const content = `
    ${bannerHtml}

    <div class="panel" style="margin-bottom: 2rem;">
      <h2>🔍 Discovery Search (Google Places / Mock)</h2>
      <p class="panel-subtitle">
        Discover and catalog local businesses. When GOOGLE_PLACES_PROSPECTING_ENABLED is false, mock mode is active.
      </p>

      <form method="POST" action="/dashboard/prospects/search" class="filter-bar" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) auto; gap: 1rem; align-items: end;">
        <input type="hidden" name="token" value="" />
        <div class="filter-group">
          <label>Query</label>
          <input type="text" name="searchQuery" placeholder="e.g. roofing contractors" required>
        </div>
        <div class="filter-group">
          <label>Region</label>
          <input type="text" name="searchRegion" placeholder="e.g. Suffolk County, NY">
        </div>
        <div class="filter-group">
          <label>Field Profile</label>
          <select name="searchProfile">
            <option value="BASIC_DISCOVERY" selected>BASIC_DISCOVERY</option>
            <option value="ENRICHED_DISCOVERY">ENRICHED_DISCOVERY</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" style="height: 38px;">Run Discovery</button>
      </form>
    </div>

    <div class="panel">
      <h2>Discovered Local Prospects (Cresca OS Read-Only)</h2>
      <p class="panel-subtitle">
        Prospects discovered via Google Places API Text Search. Automatic outreach and live CRM mutations are disabled.
      </p>

      <form method="GET" action="/dashboard/prospects" class="filter-bar" style="display: flex; gap: 1rem; margin-bottom: 2rem; padding: 0.75rem 1.25rem;">
        <input type="hidden" name="token" value="">
        <input type="text" name="q" value="${escapeHtml(req.query.q || '')}" placeholder="Search prospects..." style="flex: 1;">
        <button type="submit" class="btn btn-primary" style="height: 38px;">Search</button>
        ${req.query.q ? `<a href="/dashboard/prospects" onclick="appendToken(this)" class="btn btn-secondary" style="height: 38px; display: inline-flex; align-items: center; justify-content: center; text-decoration: none;">Clear</a>` : ''}
      </form>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Website</th>
              <th>Rating</th>
              <th>Query</th>
              <th>Discovered</th>
              <th>Outreach Job</th>
              <th>Research</th>
              <th>Score</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Prospects', 'prospects', content, token));
});

// POST /dashboard/prospects/search
router.post('/prospects/search', protectDashboard, async (req, res) => {
  const token = (req.body && req.body.token) || req.headers['x-admin-token'] || req.body.token;
  const q = (req.body.searchQuery || '').trim();
  const region = (req.body.searchRegion || '').trim();
  const profile = (req.body.searchProfile || 'BASIC_DISCOVERY').trim();

  if (!q) {
    return res.redirect(`/dashboard/prospects&error=${encodeURIComponent('Search query is required.')}`);
  }

  try {
    const store = require('../prospects/prospect-store');
    const intake = require('../prospects/google-places-prospect-intake');
    
    const countBefore = store.loadProspects().length;
    const results = await intake.searchLocalProspects(q, {
      region: region || undefined,
      fieldProfile: profile
    });
    const countAfter = store.loadProspects().length;

    const found = results.length;
    const added = countAfter - countBefore;

    res.redirect(`/dashboard/prospects&success=true&found=${found}&added=${added}`);
  } catch (err) {
    res.redirect(`/dashboard/prospects&error=${encodeURIComponent(err.message)}`);
  }
});

// GET /dashboard/prospects/outreach/confirm - Confirmation page before outreach handoff
router.get('/prospects/outreach/confirm', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const prospectId = (req.query.prospectId || '').trim();

  if (!prospectId) {
    return res.status(400).send('Missing prospectId parameter.');
  }

  const store = require('../prospects/prospect-store');
  const prospects = store.loadProspects();
  const prospect = prospects.find(p => p.prospectId === prospectId);

  if (!prospect) {
    return res.status(404).send('Prospect not found.');
  }

  const detailsHtml = `
    <div class="detail-row"><span class="detail-label">Business Name:</span><span><strong>${escapeHtml(prospect.businessName || prospect.name || 'Unknown')}</strong></span></div>
    <div class="detail-row"><span class="detail-label">Address:</span><span>${escapeHtml(prospect.formattedAddress || 'N/A')}</span></div>
    <div class="detail-row"><span class="detail-label">Category:</span><span><code>${escapeHtml(prospect.category || 'N/A')}</code></span></div>
    <div class="detail-row"><span class="detail-label">Phone:</span><span>${escapeHtml(prospect.phoneNumber || 'N/A')}</span></div>
    <div class="detail-row"><span class="detail-label">Website:</span><span>${prospect.website ? `<a href="${escapeHtml(prospect.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(prospect.website)}</a>` : 'N/A'}</span></div>
  `;

  const researchStore = require('../research/prospect-research-store');
  const research = researchStore.getResearchForProspect(prospectId);

  let researchSummaryHtml = '';
  if (research) {
    researchSummaryHtml = `
      <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 0.5rem;">
        <h4 style="margin: 0 0 0.5rem 0; color: #38bdf8; font-size: 0.95rem;">🔬 Linked Research summary (Research-informed outreach enabled)</h4>
        <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-primary); margin-bottom: 0.5rem;">
          <strong>Summary:</strong> ${escapeHtml(research.websiteSummary)}
        </div>
        <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-primary); margin-bottom: 0.5rem;">
          <strong>Gaps Found:</strong> ${escapeHtml(research.leadCaptureIssues.join(', '))}
        </div>
        <div style="font-size: 0.85rem; line-height: 1.4; color: var(--text-primary);">
          <strong>Angle:</strong> ${escapeHtml(research.recommendedOutreachAngle)}
        </div>
      </div>
    `;
  } else {
    researchSummaryHtml = `
      <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
        ℹ️ No research record found. A basic prospect-only outreach job will be generated.
      </div>
    `;
  }

  const content = `
    <div class="panel" style="max-width: 600px; margin: 3rem auto; border-color: var(--primary);">
      <h2>🤝 Confirm Outreach Handoff</h2>
      <p class="panel-subtitle" style="margin-bottom: 2rem;">
        Are you sure you want to hand off this prospect to Hermes? This will queue a Hermes job to generate draft audit and outreach copy assets.
      </p>

      <form action="/dashboard/prospects/outreach" method="POST">
        <input type="hidden" name="prospectId" value="${escapeHtml(prospectId)}" />
        <input type="hidden" name="token" value="" />

        <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 2rem;">
          ${detailsHtml}
          ${researchSummaryHtml}
        </div>

        <div style="margin-bottom: 2rem;">
          <label style="display: block; font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--muted-foreground);">Target Bot</label>
          <select name="botId" style="width: 100%;">
            <option value="content-forge" selected>content-forge</option>
          </select>
        </div>

        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
          <a href="/dashboard/prospects" onclick="appendToken(this)" class="btn btn-secondary">Cancel</a>
          <button type="submit" class="btn btn-primary">Confirm Handoff</button>
        </div>
      </form>
    </div>
  `;

  res.send(renderDashboardShell('Confirm Handoff', 'prospects', content, token));
});

// POST /dashboard/prospects/outreach - Outreach handoff execution
router.post('/prospects/outreach', protectDashboard, async (req, res) => {
  const token = (req.body && req.body.token) || req.headers['x-admin-token'] || req.body.token;
  const prospectId = (req.body.prospectId || '').trim();
  const botId = (req.body.botId || 'content-forge').trim();

  if (!prospectId) {
    return res.redirect(`/dashboard/prospects&error=${encodeURIComponent('Prospect ID is required.')}`);
  }

  try {
    const store = require('../prospects/prospect-store');
    const crypto = require('crypto');
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
    const actor = `ip_hash_${ipHash}`;

    const result = store.createHermesOutreachJobFromProspects([prospectId], {
      requestedBy: actor,
      source: 'system',
      botId
    });

    const job = result.jobs[0];
    res.redirect(`/dashboard/prospects&success=outreach_queued&jobId=${job.hermesJobId}`);
  } catch (err) {
    res.redirect(`/dashboard/prospects&error=${encodeURIComponent(err.message)}`);
  }
});

// GET /dashboard/outreach
router.get('/outreach', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const reviewStore = require('../prospects/prospect-outreach-review-store');
  const reviews = reviewStore.syncReviews();

  const q = (req.query.q || '').trim().toLowerCase();
  const statusFilter = (req.query.status || '').trim();
  const townFilter = (req.query.town || '').trim().toLowerCase();
  const categoryFilter = (req.query.category || '').trim().toLowerCase();
  const followUpDueFilter = (req.query.follow_up_due || '').trim();

  // Load prospects to map town and category
  const prospectStore = require('../prospects/prospect-store');
  const prospects = prospectStore.loadProspects();
  const prospectMap = new Map(prospects.map(p => [p.prospectId, p]));

  let filtered = reviews.map(r => {
    const p = prospectMap.get(r.prospectId) || {};
    return {
      ...r,
      town: p.town || 'Unknown',
      category: p.category || 'Unknown'
    };
  });

  if (q) {
    filtered = filtered.filter(r => r.businessName.toLowerCase().includes(q));
  }
  if (statusFilter) {
    filtered = filtered.filter(r => r.status === statusFilter);
  }
  if (townFilter) {
    filtered = filtered.filter(r => r.town.toLowerCase().includes(townFilter));
  }
  if (categoryFilter) {
    filtered = filtered.filter(r => r.category.toLowerCase().includes(categoryFilter));
  }

  const todayStr = new Date().toISOString().split('T')[0];

  if (followUpDueFilter === 'due_today') {
    filtered = filtered.filter(r => r.nextFollowUpAt && r.nextFollowUpAt.substring(0, 10) <= todayStr);
  } else if (followUpDueFilter === 'no_followup') {
    filtered = filtered.filter(r => !r.nextFollowUpAt);
  }

  // Sort by updatedAt desc
  filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const { ALLOWED_STATUSES } = require('../prospects/prospect-outreach-review-schema');
  const analytics = reviewStore.getPipelineAnalytics();

  let rows = '';
  if (filtered.length > 0) {
    for (const r of filtered) {
      const traceLink = r.hermesJobId ? `/dashboard/trace?jobId=${escapeHtml(r.hermesJobId)}` : '#';
      const detailLink = `/dashboard/outreach/view?reviewId=${escapeHtml(r.reviewId)}`;

      const statusBadgeClass = `badge-${r.status}`;
      
      const statusOptions = ALLOWED_STATUSES.map(s => 
        `<option value="${s}" ${r.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ').toUpperCase()}</option>`
      ).join('');

      let followUpHtml = '<span style="color: var(--text-secondary);">None</span>';
      if (r.nextFollowUpAt) {
        const isOverdue = r.nextFollowUpAt.substring(0, 10) <= todayStr;
        followUpHtml = `<span style="font-weight: 600; color: ${isOverdue ? '#ef4444' : 'white'};">${escapeHtml(r.nextFollowUpAt)} ${isOverdue ? '⚠️' : ''}</span>`;
      }

      rows += `
        <tr>
          <td>
            <strong>${escapeHtml(r.businessName)}</strong>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Town: <code>${escapeHtml(r.town)}</code> | Category: <code>${escapeHtml(r.category)}</code>
            </div>
          </td>
          <td>
            <span class="badge ${statusBadgeClass}">${r.status.replace(/_/g, ' ')}</span>
          </td>
          <td>
            <span style="font-weight: 500;">Count: ${r.manualContactCount || 0}</span>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">
              Channel: <code>${escapeHtml(r.lastManualContactChannel || 'None')}</code>
            </div>
          </td>
          <td>
            ${followUpHtml}
          </td>
          <td>
            ${r.hermesJobId ? `<a href="${traceLink}" onclick="appendToken(this)" style="color: var(--accent-purple); text-decoration: underline;"><code>${escapeHtml(r.hermesJobId)}</code></a>` : '<span style="color: var(--text-secondary);">None</span>'}
          </td>
          <td>
            ${r.runtimeJobId ? `<code>${escapeHtml(r.runtimeJobId)}</code>` : '<span style="color: var(--text-secondary);">None</span>'}
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <form method="POST" action="/dashboard/outreach/status" style="display: flex; gap: 0.5rem; align-items: center; margin: 0;">
                <input type="hidden" name="token" value="" />
                <input type="hidden" name="reviewId" value="${escapeHtml(r.reviewId)}" />
                <select name="status" style="padding: 0.25rem; background: #161131; border: 1px solid var(--border); border-radius: 0.25rem; color: white; font-size: 0.85rem;">
                  ${statusOptions}
                </select>
                <button type="submit" style="padding: 0.25rem 0.5rem; background: var(--accent-purple); color: white; border: none; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer;">Update</button>
              </form>
              <form method="POST" action="/dashboard/outreach/notes" style="display: flex; gap: 0.5rem; align-items: center; margin: 0;">
                <input type="hidden" name="token" value="" />
                <input type="hidden" name="reviewId" value="${escapeHtml(r.reviewId)}" />
                <input type="text" name="notes" value="${escapeHtml(r.operatorNotes || '')}" placeholder="Notes..." style="padding: 0.25rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.25rem; color: white; font-size: 0.85rem; flex: 1;" />
                <button type="submit" style="padding: 0.25rem 0.5rem; background: var(--accent-blue); color: white; border: none; border-radius: 0.25rem; font-size: 0.8rem; cursor: pointer;">Save</button>
              </form>
            </div>
          </td>
          <td>
            <a href="${detailLink}" onclick="appendToken(this)" style="font-weight: 600; text-decoration: underline; color: var(--accent-purple);">View Drafts</a>
          </td>
        </tr>
      `;
    }
  } else {
    rows = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No outreach review records found.</td></tr>`;
  }

  let bannerHtml = '';
  if (req.query.success === 'status_updated') {
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Outreach status updated successfully!
      </div>
    `;
  } else if (req.query.success === 'notes_saved') {
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Operator notes saved successfully!
      </div>
    `;
  } else if (req.query.error) {
    bannerHtml = `
      <div style="color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Error:</strong> ${escapeHtml(req.query.error)}
      </div>
    `;
  }

  const content = `
    ${bannerHtml}

    <!-- P4 Metrics Summary -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Total Reviews</div>
        <div style="font-size: 1.5rem; font-weight: 700;">${analytics.total}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Draft Generated</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent-blue);">${analytics.draft_generated}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Reviewed</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent-purple);">${analytics.reviewed}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Contacted</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent-green);">${analytics.contacted_manually}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Follow-up Req</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">${analytics.follow_up_needed}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Booked Call</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${analytics.booked_call}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: rgba(255, 255, 255, 0.08); padding: 1rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Not Interested</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-secondary);">${analytics.not_interested}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; border-color: ${analytics.due_today > 0 ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}; background: ${analytics.due_today > 0 ? 'rgba(239, 68, 68, 0.08)' : 'transparent'}; padding: 1rem;">
        <div style="font-size: 0.75rem; color: ${analytics.due_today > 0 ? '#f87171' : 'var(--text-secondary)'}; text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em; font-weight: 600;">Due Today ⚠️</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: ${analytics.due_today > 0 ? '#f87171' : 'white'};">${analytics.due_today}</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom: 2rem;">
      <h2>🔍 Outreach Reviews Filter</h2>
      <form method="GET" action="/dashboard/outreach" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto; gap: 1rem; align-items: end;">
        <input type="hidden" name="token" value="">
        
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Business Name</label>
          <input type="text" name="q" value="${escapeHtml(req.query.q || '')}" placeholder="Search..." style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Status</label>
          <select name="status" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All Statuses --</option>
            ${ALLOWED_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s.replace(/_/g, ' ').toUpperCase()}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Town / City</label>
          <input type="text" name="town" value="${escapeHtml(req.query.town || '')}" placeholder="e.g. Melville" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Category</label>
          <input type="text" name="category" value="${escapeHtml(req.query.category || '')}" placeholder="e.g. roofing" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Follow-up Due</label>
          <select name="follow_up_due" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="" ${!followUpDueFilter ? 'selected' : ''}>-- All --</option>
            <option value="due_today" ${followUpDueFilter === 'due_today' ? 'selected' : ''}>Due Today / Overdue</option>
            <option value="no_followup" ${followUpDueFilter === 'no_followup' ? 'selected' : ''}>No Follow-up Scheduled</option>
          </select>
        </div>
        
        <div style="display: flex; gap: 0.5rem;">
          <input type="submit" value="Filter" class="btn btn-primary" style="height: 44px; cursor: pointer;">
          ${(req.query.q || req.query.status || req.query.town || req.query.category || req.query.follow_up_due) ? `<a href="/dashboard/outreach" onclick="appendToken(this)" style="display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); border-radius: 0.5rem; color: var(--text-secondary); text-decoration: none; height: 44px; box-sizing: border-box;">Clear</a>` : ''}
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>📬 Outreach Review Workspace (Dry-Run Only)</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
        Review generated outreach drafts, manage pipeline statuses, and save manual contact logs. Automated sends are disabled.
      </p>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Business Name & Details</th>
              <th>Status</th>
              <th>Contacts</th>
              <th>Next Follow-Up</th>
              <th>Hermes Job</th>
              <th>Runtime Job</th>
              <th>Quick Actions</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Outreach Reviews', 'outreach', content, token));
});

// GET /dashboard/outreach/view
router.get('/outreach/view', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const reviewId = (req.query.reviewId || '').trim();

  if (!reviewId) {
    return res.status(400).send('Missing reviewId parameter.');
  }

  const reviewStore = require('../prospects/prospect-outreach-review-store');
  const reviews = reviewStore.loadReviews();
  const record = reviews[reviewId];

  if (!record) {
    return res.status(404).send('Outreach review record not found.');
  }

  const { ALLOWED_STATUSES } = require('../prospects/prospect-outreach-review-schema');

  const statusOptions = ALLOWED_STATUSES.map(s => 
    `<option value="${s}" ${record.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ').toUpperCase()}</option>`
  ).join('');

  const followUpsHtml = (record.followUpDrafts || []).map((step, idx) => `
    <div style="margin-bottom: 1rem; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <label style="font-size: 0.85rem; color: var(--text-secondary);">Follow-up Step ${idx + 1}</label>
        <button class="filter-btn" style="margin: 0; padding: 0.15rem 0.5rem; font-size: 0.75rem;" onclick="copyText('followup-textarea-${idx}', this)">Copy</button>
      </div>
      <textarea id="followup-textarea-${idx}" readonly style="width: 100%; box-sizing: border-box; height: 80px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.5rem; font-family: monospace;" onclick="this.select()">${escapeHtml(step)}</textarea>
    </div>
  `).join('') || '<p style="color: var(--text-secondary); font-size: 0.9rem;">No follow-up sequence drafted.</p>';

  let bannerHtml = '';
  if (req.query.success === 'outreach_updated') {
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Outreach pipeline log updated successfully!
      </div>
    `;
  } else if (req.query.success === 'status_updated') {
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Outreach status updated successfully!
      </div>
    `;
  } else if (req.query.success === 'notes_saved') {
    bannerHtml = `
      <div style="color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Success:</strong> Operator notes saved successfully!
      </div>
    `;
  } else if (req.query.error) {
    bannerHtml = `
      <div style="color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.75rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center;">
        <strong>Error:</strong> ${escapeHtml(req.query.error)}
      </div>
    `;
  }

  const content = `
    ${bannerHtml}

    <script>
      function copyText(elementId, btn) {
        const textarea = document.getElementById(elementId);
        textarea.select();
        navigator.clipboard.writeText(textarea.value);
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.background = 'var(--accent-green)';
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.background = '';
        }, 2000);
      }
    </script>

    <div class="panel" style="margin-bottom: 2rem;">
      <a href="/dashboard/outreach" onclick="appendToken(this)" style="display: inline-flex; align-items: center; margin-bottom: 1.5rem; color: var(--text-secondary); font-weight: 500; text-decoration: none;">
        &larr; Back to Reviews Workspace
      </a>

      <h2>🏢 Outreach Details & Drafts: ${escapeHtml(record.businessName)}</h2>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 2rem;">
        Click "Copy" to copy scripts for manual outreach. Automated sending is disabled.
      </p>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem;">
        <div>
          <!-- Draft Assets -->
          <div class="panel" style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="margin: 0;">💬 SMS Outreach Draft</h3>
              <button class="filter-btn" style="margin: 0; padding: 0.25rem 0.75rem; font-size: 0.8rem;" onclick="copyText('sms-draft-textarea', this)">Copy</button>
            </div>
            <textarea id="sms-draft-textarea" readonly style="width: 100%; box-sizing: border-box; height: 120px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.75rem; font-family: monospace; font-size: 0.9rem; line-height: 1.4;" onclick="this.select()">${escapeHtml(record.smsDraft || 'No SMS draft generated.')}</textarea>
          </div>

          <div class="panel" style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="margin: 0;">✉️ Email Outreach Draft</h3>
              <button class="filter-btn" style="margin: 0; padding: 0.25rem 0.75rem; font-size: 0.8rem;" onclick="copyText('email-draft-textarea', this)">Copy</button>
            </div>
            <textarea id="email-draft-textarea" readonly style="width: 100%; box-sizing: border-box; height: 160px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.75rem; font-family: monospace; font-size: 0.9rem; line-height: 1.4;" onclick="this.select()">${escapeHtml(record.emailDraft || 'No email draft generated.')}</textarea>
          </div>

          <div class="panel" style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="margin: 0;">📱 Social DM Opener Draft (Facebook / Instagram)</h3>
              <button class="filter-btn" style="margin: 0; padding: 0.25rem 0.75rem; font-size: 0.8rem;" onclick="copyText('dm-draft-textarea', this)">Copy</button>
            </div>
            <textarea id="dm-draft-textarea" readonly style="width: 100%; box-sizing: border-box; height: 120px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.75rem; font-family: monospace; font-size: 0.9rem; line-height: 1.4;" onclick="this.select()">${escapeHtml(record.dmDraft || 'No DM draft generated.')}</textarea>
          </div>

          <div class="panel" style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="margin: 0;">📞 Discovery Call Opener & Angles</h3>
              <button class="filter-btn" style="margin: 0; padding: 0.25rem 0.75rem; font-size: 0.8rem;" onclick="copyText('call-draft-textarea', this)">Copy</button>
            </div>
            <textarea id="call-draft-textarea" readonly style="width: 100%; box-sizing: border-box; height: 120px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.75rem; font-family: monospace; font-size: 0.9rem; line-height: 1.4;" onclick="this.select()">${escapeHtml(record.discoveryCallAngle || 'No discovery call opener generated.')}</textarea>
          </div>

          <div class="panel" style="margin-bottom: 1.5rem; background: rgba(255,255,255,0.01);">
            <h3>🔄 3-Step Follow-Up Sequence</h3>
            ${followUpsHtml}
          </div>
        </div>

        <div>
          <!-- Settings / Pipeline Panel -->
          <form method="POST" action="/dashboard/outreach/update">
            <input type="hidden" name="token" value="" />
            <input type="hidden" name="reviewId" value="${escapeHtml(record.reviewId)}" />
            
            <div class="panel" style="border-color: rgba(139, 92, 246, 0.3); padding: 1.25rem;">
              <h3 style="margin-top: 0;">⚙️ Pipeline Actions</h3>
              
              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Pipeline Status</label>
                <select name="status" style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
                  ${statusOptions}
                </select>
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Next Follow-up Date</label>
                <input type="date" name="nextFollowUpAt" value="${escapeHtml(record.nextFollowUpAt || '')}" style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;" />
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Follow-up Stage</label>
                <input type="number" name="followUpStage" value="${record.followUpStage || 0}" min="0" style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;" />
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Manual Contact Count</label>
                <input type="number" name="manualContactCount" value="${record.manualContactCount || 0}" min="0" style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;" />
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Last Contact Channel</label>
                <select name="lastManualContactChannel" style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
                  <option value="" ${!record.lastManualContactChannel ? 'selected' : ''}>None</option>
                  <option value="sms" ${record.lastManualContactChannel === 'sms' ? 'selected' : ''}>SMS</option>
                  <option value="email" ${record.lastManualContactChannel === 'email' ? 'selected' : ''}>Email</option>
                  <option value="dm" ${record.lastManualContactChannel === 'dm' ? 'selected' : ''}>DM (FB/IG/LI)</option>
                  <option value="phone" ${record.lastManualContactChannel === 'phone' ? 'selected' : ''}>Phone Call</option>
                  <option value="other" ${record.lastManualContactChannel === 'other' ? 'selected' : ''}>Other</option>
                </select>
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Outreach Outcome</label>
                <input type="text" name="outcome" value="${escapeHtml(record.outcome || '')}" placeholder="e.g. Interested, Booked..." style="width: 100%; box-sizing: border-box; padding: 0.5rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;" />
              </div>

              <div style="margin-bottom: 1rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Booking Notes</label>
                <textarea name="bookingNotes" placeholder="e.g. Call scheduled on..." style="width: 100%; box-sizing: border-box; height: 60px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.5rem; font-family: inherit;">${escapeHtml(record.bookingNotes || '')}</textarea>
              </div>

              <div style="margin-bottom: 1.5rem;">
                <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Operator Notes</label>
                <textarea name="operatorNotes" placeholder="General comments..." style="width: 100%; box-sizing: border-box; height: 80px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white; padding: 0.5rem; font-family: inherit;">${escapeHtml(record.operatorNotes || '')}</textarea>
              </div>

              <button type="submit" class="filter-btn" style="width: 100%; height: 40px; margin: 0; background: linear-gradient(135deg, var(--accent-purple) 0%, var(--accent-blue) 100%); font-weight: 600;">Save Pipeline Changes</button>
            </div>
          </form>

          <div class="panel" style="margin-top: 1.5rem; border-color: rgba(255, 255, 255, 0.08);">
            <h3>🛡️ Metadata</h3>
            <div class="detail-row"><span class="detail-label">Review ID:</span><span><code>${escapeHtml(record.reviewId)}</code></span></div>
            <div class="detail-row"><span class="detail-label">Prospect ID:</span><span><code>${escapeHtml(record.prospectId)}</code></span></div>
            <div class="detail-row"><span class="detail-label">Hermes Job:</span><span>${record.hermesJobId ? `<a href="/dashboard/trace?jobId=${escapeHtml(record.hermesJobId)}" onclick="appendToken(this)"><code>${escapeHtml(record.hermesJobId)}</code></a>` : 'None'}</span></div>
            <div class="detail-row"><span class="detail-label">Runtime Job:</span><span><code>${escapeHtml(record.runtimeJobId || 'None')}</code></span></div>
            <div class="detail-row"><span class="detail-label">Last Contact:</span><span>${record.lastManualContactAt ? new Date(record.lastManualContactAt).toLocaleString() : 'Never'}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Review Outreach Drafts', 'outreach', content, token));
});

// POST /dashboard/outreach/status
router.post('/outreach/status', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token) || req.body.token;
  const reviewId = (req.body.reviewId || '').trim();
  const status = (req.body.status || '').trim();
  const redirectTarget = req.body.redirect || 'list';

  if (!reviewId || !status) {
    const errorMsg = 'Missing reviewId or status.';
    if (redirectTarget === 'view') {
      return res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&error=${encodeURIComponent(errorMsg)}`);
    }
    return res.redirect(`/dashboard/outreach&error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    const reviewStore = require('../prospects/prospect-outreach-review-store');
    reviewStore.updateReviewStatus(reviewId, status);

    if (redirectTarget === 'view') {
      return res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&success=status_updated`);
    }
    res.redirect(`/dashboard/outreach&success=status_updated`);
  } catch (err) {
    if (redirectTarget === 'view') {
      return res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&error=${encodeURIComponent(err.message)}`);
    }
    res.redirect(`/dashboard/outreach&error=${encodeURIComponent(err.message)}`);
  }
});

// POST /dashboard/outreach/notes
router.post('/outreach/notes', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token) || req.body.token;
  const reviewId = (req.body.reviewId || '').trim();
  const notes = req.body.notes || '';
  const redirectTarget = req.body.redirect || 'list';

  if (!reviewId) {
    const errorMsg = 'Missing reviewId.';
    return res.redirect(`/dashboard/outreach&error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    const reviewStore = require('../prospects/prospect-outreach-review-store');
    reviewStore.updateReviewNotes(reviewId, notes);

    if (redirectTarget === 'view') {
      return res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&success=notes_saved`);
    }
    res.redirect(`/dashboard/outreach&success=notes_saved`);
  } catch (err) {
    if (redirectTarget === 'view') {
      return res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&error=${encodeURIComponent(err.message)}`);
    }
    res.redirect(`/dashboard/outreach&error=${encodeURIComponent(err.message)}`);
  }
});

// POST /dashboard/outreach/update
router.post('/outreach/update', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token) || req.body.token;
  const reviewId = (req.body.reviewId || '').trim();

  if (!reviewId) {
    const errorMsg = 'Missing reviewId.';
    return res.redirect(`/dashboard/outreach&error=${encodeURIComponent(errorMsg)}`);
  }

  const updates = {};
  const fields = [
    'status',
    'operatorNotes',
    'manualContactCount',
    'lastManualContactChannel',
    'nextFollowUpAt',
    'followUpStage',
    'outcome',
    'bookingNotes'
  ];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'manualContactCount' || f === 'followUpStage') {
        updates[f] = req.body[f] !== '' ? parseInt(req.body[f], 10) : 0;
      } else if (f === 'nextFollowUpAt') {
        updates[f] = req.body[f] || null;
      } else {
        updates[f] = req.body[f];
      }
    }
  }

  try {
    const reviewStore = require('../prospects/prospect-outreach-review-store');
    reviewStore.updateReviewFields(reviewId, updates);
    res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&success=outreach_updated`);
  } catch (err) {
    res.redirect(`/dashboard/outreach/view?reviewId=${encodeURIComponent(reviewId)}&error=${encodeURIComponent(err.message)}`);
  }
});

// GET /dashboard/research - List all research records
router.get('/research', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const store = require('../research/prospect-research-store');
  const records = Object.values(store.loadResearch());

  let rows = '';
  if (records.length > 0) {
    for (const r of records) {
      rows += `
        <tr>
          <td><strong>${escapeHtml(r.businessName)}</strong></td>
          <td>${r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.website)}</a>` : 'N/A'}</td>
          <td><code>${escapeHtml(r.sourceType)}</code></td>
          <td>${escapeHtml(r.websiteSummary)}</td>
          <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: bold;">${Math.round(r.confidence * 100)}%</span></td>
          <td>${new Date(r.updatedAt).toLocaleString()}</td>
          <td>
            <a href="/dashboard/research/view?researchId=${r.researchId}" onclick="appendToken(this)" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">View Summary</a>
          </td>
        </tr>
      `;
    }
  } else {
    rows = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No research records found. Run <code>/research_prospect &lt;prospectId&gt;</code> in Telegram to enrich prospects.</td></tr>`;
  }

  const content = `
    <div class="panel">
      <h2>🔬 Discovered Prospect Research Database</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
        View public-source website summaries, detected services, funnel gaps, and recommended outreach strategies.
      </p>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Business Name</th>
              <th>Website</th>
              <th>Source Type</th>
              <th>Website Summary</th>
              <th>Confidence</th>
              <th>Last Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Research Catalog', 'research', content, token));
});

// GET /dashboard/research/view - Detailed view of a single research record
router.get('/research/view', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const researchId = req.query.researchId;

  if (!researchId) {
    return res.status(400).send('Research ID is required.');
  }

  const store = require('../research/prospect-research-store');
  const r = store.getResearchRecord(researchId);

  if (!r) {
    return res.status(404).send('Research record not found.');
  }

  const scoreStore = require('../research/prospect-score-store');
  const score = scoreStore.getScoreForProspect(r.prospectId);

  let scoreHtml = '';
  if (score) {
    let badgeColor = '#94a3b8';
    let badgeBg = 'rgba(148, 163, 184, 0.15)';
    let badgeBorder = 'rgba(148, 163, 184, 0.3)';
    if (score.priority === 'high') {
      badgeColor = '#10b981';
      badgeBg = 'rgba(16, 185, 129, 0.15)';
      badgeBorder = 'rgba(16, 185, 129, 0.3)';
    } else if (score.priority === 'medium') {
      badgeColor = '#f59e0b';
      badgeBg = 'rgba(245, 158, 11, 0.15)';
      badgeBorder = 'rgba(245, 158, 11, 0.3)';
    }

    scoreHtml = `
      <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(16, 185, 129, 0.03); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(16, 185, 129, 0.2); padding-bottom: 0.5rem; margin-bottom: 1rem;">
          <h3 style="margin: 0; color: #10b981; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">🎯 Prospect Quality Scoring</h3>
          <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-size: 0.85rem; padding: 0.25rem 0.6rem; border-radius: 0.25rem; font-weight: bold;">
            ${score.priority.toUpperCase()} PRIORITY
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div style="text-align: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Fit Score</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: ${badgeColor};">${score.fitScore}/100</div>
          </div>
          <div style="text-align: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Urgency</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: #fbbf24;">${score.urgencyScore}/100</div>
          </div>
          <div style="text-align: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Website Gaps</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: #fecdd3;">${score.websiteGapScore}/100</div>
          </div>
          <div style="text-align: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Follow-Up Potential</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--accent-blue);">${score.followUpPotentialScore}/100</div>
          </div>
        </div>
        <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 0.75rem;">
          <strong>Recommended Channel:</strong> <code style="font-size: 0.95rem; color: var(--accent-blue); padding: 0.1rem 0.4rem; background: rgba(59, 130, 246, 0.1); border-radius: 0.25rem;">${score.recommendedChannel.toUpperCase()}</code>
        </div>
        <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 0.75rem;">
          <strong>Recommended Offer Angle:</strong> <span style="color: var(--accent-green); font-weight: 500;">${escapeHtml(score.recommendedOfferAngle)}</span>
        </div>
        <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 0.75rem;">
          <strong>Scoring Reasoning:</strong> <span style="font-style: italic; color: var(--text-secondary);">${escapeHtml(score.reasoning)}</span>
        </div>
        ${score.redFlags && score.redFlags.length > 0 ? `
          <div style="font-size: 0.95rem; line-height: 1.5; color: #fca5a5; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
            <strong>⚠️ Red Flags:</strong>
            ${score.redFlags.map(rf => `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 0.25rem;">${escapeHtml(rf)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  const content = `
    <div style="margin-bottom: 1.5rem;">
      <a href="/dashboard/research" onclick="appendToken(this)" style="color: var(--accent-purple); text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem;">
        &larr; Back to Research Catalog
      </a>
    </div>

    <div class="panel" style="margin-bottom: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="margin: 0; font-size: 1.8rem; background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
            ${escapeHtml(r.businessName)}
          </h2>
          <p style="color: var(--text-secondary); margin: 0.25rem 0 0 0; font-size: 0.9rem;">
            Source: <code>${escapeHtml(r.sourceType)}</code> | URL: <a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue); text-decoration: underline;">${escapeHtml(r.website)}</a>
          </p>
        </div>
        <div style="text-align: right;">
          <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.9rem; font-weight: bold;">
            Confidence: ${Math.round(r.confidence * 100)}%
          </span>
          <p style="color: var(--text-secondary); margin: 0.25rem 0 0 0; font-size: 0.8rem;">
            ID: <code>${escapeHtml(r.researchId)}</code>
          </p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; align-items: start;">
        <div>
          <h3 style="margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">📝 Website Summary</h3>
          <p style="line-height: 1.6; color: var(--text-primary); font-size: 1.05rem; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 0.5rem; border: 1px solid var(--border);">
            ${escapeHtml(r.websiteSummary)}
          </p>

          <h3 style="margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; color: #fbbf24;">⚠️ Lead Capture Gaps & Issues</h3>
          <ul style="padding-left: 1.5rem; line-height: 1.6;">
            ${r.leadCaptureIssues.map(issue => `<li style="margin-bottom: 0.5rem; color: #fecdd3;"><strong>${escapeHtml(issue)}</strong></li>`).join('')}
          </ul>

          <h3 style="margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; color: var(--accent-green);">🤝 Trust Signals</h3>
          <ul style="padding-left: 1.5rem; line-height: 1.6;">
            ${r.trustSignals.map(sig => `<li style="margin-bottom: 0.5rem; color: #a7f3d0;">${escapeHtml(sig)}</li>`).join('')}
          </ul>
        </div>

        <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.2); padding: 1.5rem; border-radius: 1rem;">
          <h3 style="margin-top: 0; color: var(--accent-purple); border-bottom: 1px solid rgba(139, 92, 246, 0.2); padding-bottom: 0.5rem;">🛠️ Services Detected</h3>
          <ul style="padding-left: 1.2rem; line-height: 1.6; font-size: 0.95rem;">
            ${r.servicesDetected.map(s => `<li style="margin-bottom: 0.4rem;">${escapeHtml(s)}</li>`).join('')}
          </ul>

          <h3 style="margin-top: 2rem; color: var(--accent-blue); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 0.5rem;">🗣️ Review Themes</h3>
          <ul style="padding-left: 1.2rem; line-height: 1.6; font-size: 0.95rem;">
            ${r.reviewThemes.map(t => `<li style="margin-bottom: 0.4rem;">${escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>
      </div>

      <div style="margin-top: 2rem; padding: 1.5rem; background: linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(99, 102, 241, 0.1) 100%); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 0.75rem;">
        <h3 style="margin-top: 0; color: #38bdf8;">🎯 Recommended Outreach Pitch Angle</h3>
        <p style="font-size: 1.1rem; line-height: 1.6; font-weight: 500; color: #e0f2fe; margin-bottom: 0;">
          ${escapeHtml(r.recommendedOutreachAngle)}
        </p>
      </div>

      ${scoreHtml}

      <!-- Safety notice verifying read-only boundaries -->
      <div style="margin-top: 2rem; padding: 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; color: var(--text-secondary);">
        ℹ️ <strong>Read-Only Compliance Notice:</strong> Automatic email, SMS outreach, and CRM connection operations are deactivated in this environment.
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Research Detail', 'research', content, token));
});

// GET /dashboard/scores - Ranked prospect scores leaderboard
router.get('/scores', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const scoreStore = require('../research/prospect-score-store');
  const scores = scoreStore.getTopScores(100);

  let rows = '';
  if (scores.length > 0) {
    for (const s of scores) {
      let badgeColor = '#94a3b8';
      let badgeBg = 'rgba(148, 163, 184, 0.15)';
      let badgeBorder = 'rgba(148, 163, 184, 0.3)';
      if (s.priority === 'high') {
        badgeColor = '#10b981';
        badgeBg = 'rgba(16, 185, 129, 0.15)';
        badgeBorder = 'rgba(16, 185, 129, 0.3)';
      } else if (s.priority === 'medium') {
        badgeColor = '#f59e0b';
        badgeBg = 'rgba(245, 158, 11, 0.15)';
        badgeBorder = 'rgba(245, 158, 11, 0.3)';
      }

      const researchLink = s.researchId && s.researchId !== 'none'
        ? `<a href="/dashboard/research/view?researchId=${encodeURIComponent(s.researchId)}" onclick="appendToken(this)" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">View Research</a>`
        : '<span style="color: var(--text-secondary);">No Research</span>';

      rows += `
        <tr>
          <td><strong>${escapeHtml(s.businessName)}</strong></td>
          <td><span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: bold;">${s.priority.toUpperCase()}</span></td>
          <td><strong style="color: ${badgeColor};">${s.fitScore}/100</strong></td>
          <td style="color: #fbbf24; font-weight: 500;">${s.urgencyScore}/100</td>
          <td style="color: #fecdd3; font-weight: 500;">${s.websiteGapScore}/100</td>
          <td style="color: var(--accent-blue); font-weight: 500;">${s.followUpPotentialScore}/100</td>
          <td><code style="color: var(--accent-blue); font-weight: bold;">${s.recommendedChannel.toUpperCase()}</code></td>
          <td style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(s.recommendedOfferAngle)}">${escapeHtml(s.recommendedOfferAngle)}</td>
          <td>${researchLink}</td>
        </tr>
      `;
    }
  } else {
    rows = `<tr><td colspan="9" style="text-align: center; color: var(--text-secondary);">No score records found. Run <code>/score_prospect &lt;prospectId&gt;</code> in Telegram to evaluate prospects.</td></tr>`;
  }

  const content = `
    <div class="panel">
      <h2>🎯 Prospect Angle & Quality Leaderboard</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
        Ranking enriched prospects by B2B fit. Evaluate gaps, target channels, and recommended conversion offer angles.
      </p>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Business Name</th>
              <th>Priority</th>
              <th>Fit Score</th>
              <th>Urgency</th>
              <th>Website Gaps</th>
              <th>Follow-Up</th>
              <th>Target Channel</th>
              <th>Recommended Offer Angle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Scores Leaderboard', 'scores', content, token));
});

// GET /dashboard/cockpit - Prioritized Daily Prospecting Cockpit (Phase R4)
router.get('/cockpit', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const cockpit = require('../prospects/prospect-priority-cockpit');
  
  const filters = {
    priority: req.query.priority || '',
    status: req.query.status || '',
    town: req.query.town || '',
    category: req.query.category || '',
    recommendedChannel: req.query.recommendedChannel || '',
    hasResearch: req.query.hasResearch || '',
    hasScore: req.query.hasScore || '',
    hasOutreachDraft: req.query.hasOutreachDraft || ''
  };

  const items = cockpit.getCockpitData(filters);
  const todayStr = new Date().toISOString().split('T')[0];

  // Stats bar calculations
  const totalMatching = items.length;
  const highPriorityCount = items.filter(item => item.priority === 'high').length;
  const followUpsDue = items.filter(item => item.nextFollowUpAt && item.nextFollowUpAt.substring(0, 10) <= todayStr).length;
  const bookedCalls = items.filter(item => item.outreachStatus === 'booked_call').length;

  let rows = '';
  if (items.length > 0) {
    for (const item of items) {
      let priorityColor = '#cbd5e1';
      let priorityBg = 'rgba(148, 163, 184, 0.15)';
      let priorityBorder = 'rgba(148, 163, 184, 0.3)';
      
      if (item.priority === 'high') {
        priorityColor = '#10b981';
        priorityBg = 'rgba(16, 185, 129, 0.15)';
        priorityBorder = 'rgba(16, 185, 129, 0.3)';
      } else if (item.priority === 'medium') {
        priorityColor = '#f59e0b';
        priorityBg = 'rgba(245, 158, 11, 0.15)';
        priorityBorder = 'rgba(245, 158, 11, 0.3)';
      } else if (item.priority === 'low') {
        priorityColor = '#3b82f6';
        priorityBg = 'rgba(59, 130, 246, 0.15)';
        priorityBorder = 'rgba(59, 130, 246, 0.3)';
      }

      const researchStatusBadge = item.hasResearch
        ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.75rem;">Enriched</span>`
        : `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); font-size: 0.75rem;">None</span>`;

      const scoreHtml = item.hasScore
        ? `<div style="font-weight: bold; color: ${priorityColor};">${item.fitScore}/100</div>
           <div style="font-size: 0.75rem; color: var(--text-secondary);">Urgency: ${item.urgencyScore}/100</div>`
        : `<span style="color: var(--text-secondary);">Unscored</span>`;

      const draftBadge = item.hasOutreachDraft
        ? `<span class="badge badge-completed" style="font-size: 0.75rem;">Draft Ready</span>`
        : `<span class="badge badge-queued" style="font-size: 0.75rem;">No Draft</span>`;

      let contactHtml = `<span style="color: var(--text-secondary);">Not Contacted</span>`;
      if (item.manualContactCount > 0) {
        contactHtml = `<span style="font-weight: 500;">Contacted (${item.manualContactCount})</span>
                       <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">
                         Channel: <code>${escapeHtml(item.lastManualContactChannel || 'unknown')}</code>
                       </div>`;
      }

      let followUpHtml = '<span style="color: var(--text-secondary);">None</span>';
      if (item.nextFollowUpAt) {
        const isOverdue = item.nextFollowUpAt.substring(0, 10) <= todayStr;
        followUpHtml = `<span style="font-weight: 600; color: ${isOverdue ? '#ef4444' : 'white'};">${escapeHtml(item.nextFollowUpAt)} ${isOverdue ? '⚠️' : ''}</span>`;
      }

      let outcomeHtml = '<span style="color: var(--text-secondary);">N/A</span>';
      if (item.outreachStatus === 'booked_call') {
        outcomeHtml = `<span class="badge badge-completed" style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.25);">Booked Call</span>`;
      } else if (item.outcome) {
        outcomeHtml = `<span class="badge badge-queued" style="font-size: 0.75rem;">${escapeHtml(item.outcome)}</span>`;
      }

      // Safe action links
      const viewProspectLink = `/dashboard/prospects?q=${encodeURIComponent(item.businessName)}`;
      
      const viewResearchLink = item.hasResearch
        ? `<a href="/dashboard/research/view?researchId=${item.researchId}" onclick="appendToken(this)" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">View Research</a>`
        : `<span style="color: var(--text-secondary);">No Research</span>`;

      const viewScoreLink = item.hasScore
        ? (item.hasResearch 
            ? `<a href="/dashboard/research/view?researchId=${item.researchId || item.scoreId}" onclick="appendToken(this)" style="color: #34d399; text-decoration: underline; font-weight: 600;">View Score</a>`
            : `<a href="/dashboard/scores" onclick="appendToken(this)" style="color: #34d399; text-decoration: underline; font-weight: 600;">Leaderboard</a>`)
        : `<span style="color: var(--text-secondary);">Unscored</span>`;

      const viewOutreachLink = item.reviewId
        ? `<a href="/dashboard/outreach/view?reviewId=${item.reviewId}" onclick="appendToken(this)" style="color: var(--accent-purple); text-decoration: underline; font-weight: 600;">View Outreach</a>`
        : `<span style="color: var(--text-secondary);">No Outreach</span>`;

      const handoffLink = `<a href="/dashboard/prospects/outreach/confirm?prospectId=${item.prospectId}" onclick="appendToken(this)" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600;">Handoff Flow</a>`;

      rows += `
        <tr>
          <td>
            <strong>${escapeHtml(item.businessName)}</strong>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Town: <code>${escapeHtml(item.town)}</code> | Category: <code>${escapeHtml(item.category)}</code>
            </div>
          </td>
          <td>
            <span class="badge" style="background: ${priorityBg}; color: ${priorityColor}; border: 1px solid ${priorityBorder}; font-weight: bold;">
              ${item.priority.toUpperCase()}
            </span>
          </td>
          <td>${scoreHtml}</td>
          <td>
            <code style="color: var(--accent-blue); font-weight: bold;">${item.recommendedChannel.toUpperCase()}</code>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(item.recommendedOfferAngle)}">
              ${escapeHtml(item.recommendedOfferAngle)}
            </div>
          </td>
          <td>${researchStatusBadge}</td>
          <td>${draftBadge}</td>
          <td>${contactHtml}</td>
          <td>${followUpHtml}</td>
          <td>${outcomeHtml}</td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem;">
              <a href="${viewProspectLink}" onclick="appendToken(this)" style="color: var(--accent-purple); text-decoration: underline;">View Prospect</a>
              ${item.hasResearch ? viewResearchLink : ''}
              ${item.hasScore ? viewScoreLink : ''}
              ${item.reviewId ? viewOutreachLink : ''}
              ${handoffLink}
            </div>
          </td>
        </tr>
      `;
    }
  } else {
    rows = `<tr><td colspan="10" style="text-align: center; color: var(--text-secondary);">No prospects found in cockpit. Adjust filters or run discovery.</td></tr>`;
  }

  const content = `
    <!-- Stats Bar -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <div class="panel" style="margin: 0; text-align: center; padding: 1.5rem;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Total Matching</div>
        <div style="font-size: 2rem; font-weight: 700;">${totalMatching}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; padding: 1.5rem; border-color: rgba(16, 185, 129, 0.3);">
        <div style="font-size: 0.75rem; color: #34d399; text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">High Priority</div>
        <div style="font-size: 2rem; font-weight: 700; color: #34d399;">${highPriorityCount}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; padding: 1.5rem; border-color: ${followUpsDue > 0 ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}; background: ${followUpsDue > 0 ? 'rgba(239, 68, 68, 0.08)' : 'transparent'};">
        <div style="font-size: 0.75rem; color: ${followUpsDue > 0 ? '#f87171' : 'var(--text-secondary)'}; text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em; font-weight: 600;">Follow-ups Due Today</div>
        <div style="font-size: 2rem; font-weight: 700; color: ${followUpsDue > 0 ? '#f87171' : 'white'};">${followUpsDue}</div>
      </div>
      <div class="panel" style="margin: 0; text-align: center; padding: 1.5rem; border-color: rgba(59, 130, 246, 0.3);">
        <div style="font-size: 0.75rem; color: #60a5fa; text-transform: uppercase; margin-bottom: 0.5rem; letter-spacing: 0.05em;">Booked Calls</div>
        <div style="font-size: 2rem; font-weight: 700; color: #60a5fa;">${bookedCalls}</div>
      </div>
    </div>

    <!-- Filters Panel -->
    <div class="panel" style="margin-bottom: 2rem;">
      <h2>📋 Cockpit Filters</h2>
      <form method="GET" action="/dashboard/cockpit" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto; gap: 1rem; align-items: end;">
        <input type="hidden" name="token" value="">
        
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Priority</label>
          <select name="priority" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="high" ${filters.priority === 'high' ? 'selected' : ''}>HIGH</option>
            <option value="medium" ${filters.priority === 'medium' ? 'selected' : ''}>MEDIUM</option>
            <option value="low" ${filters.priority === 'low' ? 'selected' : ''}>LOW</option>
            <option value="unscored" ${filters.priority === 'unscored' ? 'selected' : ''}>UNSCORED</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Status</label>
          <select name="status" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="not contacted" ${filters.status === 'not contacted' ? 'selected' : ''}>Not Contacted</option>
            <option value="contacted" ${filters.status === 'contacted' ? 'selected' : ''}>Contacted</option>
            <option value="follow-up due" ${filters.status === 'follow-up due' ? 'selected' : ''}>Follow-up Due</option>
            <option value="booked call" ${filters.status === 'booked call' ? 'selected' : ''}>Booked Call</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Recommended Channel</label>
          <select name="recommendedChannel" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="sms" ${filters.recommendedChannel === 'sms' ? 'selected' : ''}>SMS</option>
            <option value="email" ${filters.recommendedChannel === 'email' ? 'selected' : ''}>Email</option>
            <option value="dm" ${filters.recommendedChannel === 'dm' ? 'selected' : ''}>DM</option>
            <option value="call" ${filters.recommendedChannel === 'call' ? 'selected' : ''}>Call</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Town / City</label>
          <input type="text" name="town" value="${escapeHtml(filters.town)}" placeholder="e.g. Melville" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Category</label>
          <input type="text" name="category" value="${escapeHtml(filters.category)}" placeholder="e.g. roofing" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Has Research</label>
          <select name="hasResearch" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="true" ${filters.hasResearch === 'true' ? 'selected' : ''}>Yes</option>
            <option value="false" ${filters.hasResearch === 'false' ? 'selected' : ''}>No</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Has Score</label>
          <select name="hasScore" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="true" ${filters.hasScore === 'true' ? 'selected' : ''}>Yes</option>
            <option value="false" ${filters.hasScore === 'false' ? 'selected' : ''}>No</option>
          </select>
        </div>

        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Has Draft</label>
          <select name="hasOutreachDraft" style="width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; color: white;">
            <option value="">-- All --</option>
            <option value="true" ${filters.hasOutreachDraft === 'true' ? 'selected' : ''}>Yes</option>
            <option value="false" ${filters.hasOutreachDraft === 'false' ? 'selected' : ''}>No</option>
          </select>
        </div>
        
        <div style="display: flex; gap: 0.5rem;">
          <input type="submit" value="Filter" class="btn btn-primary" style="height: 44px; cursor: pointer;">
          ${(filters.priority || filters.status || filters.recommendedChannel || filters.town || filters.category || filters.hasResearch || filters.hasScore || filters.hasOutreachDraft) ? `<a href="/dashboard/cockpit" onclick="appendToken(this)" style="display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); border-radius: 0.5rem; color: var(--text-secondary); text-decoration: none; height: 44px; box-sizing: border-box;">Clear</a>` : ''}
        </div>
      </form>
    </div>

    <!-- Prioritized Prospect Cockpit Table -->
    <div class="panel">
      <h2>🎯 Prioritized Daily Prospecting Cockpit</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
        Sort order: Priority (HIGH &gt; MEDIUM &gt; LOW &gt; UNSCORED) &rarr; Fit Score desc &rarr; Urgency Score desc &rarr; Discovered Date desc.
      </p>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Business Name & Location</th>
              <th>Priority</th>
              <th>Scores</th>
              <th>Target Channel & Offer Angle</th>
              <th>Research</th>
              <th>Outreach Draft</th>
              <th>Contact Status</th>
              <th>Next Follow-up</th>
              <th>Outcome</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Prospecting Cockpit', 'cockpit', content, token));
});

// GET /dashboard/playbook - Operator Playbook
router.get('/playbook', protectDashboard, (req, res) => {
  const token = (req.body && req.body.token);
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  const playbookPath = path.resolve(root, 'openclaw', 'ops', 'OPS1_DAILY_OPERATOR_PLAYBOOK.md');
  let rawContent = '';
  try {
    rawContent = fs.readFileSync(playbookPath, 'utf8');
  } catch (err) {
    rawContent = `### ⚠️ Playbook File Missing\nCould not load playbook from ${playbookPath}: ${err.message}`;
  }

  // Simple Markdown to HTML parser
  function parseMarkdownToHtml(md) {
    if (!md) return '';
    
    // First, escape all raw HTML tags and characters to prevent script injection
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Convert [text](url) links safely, rendering file:// links as plain text
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      const lowerUrl = url.toLowerCase().trim();
      if (lowerUrl.startsWith('file:') || lowerUrl.includes('file://')) {
        // Render file paths as plain text, not links
        return `${text} (${url})`;
      }
      if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) {
        return text; // Strip dangerous scripting
      }
      return `<a href="${url}" onclick="if(this.href.startsWith('/')) appendToken(this)" style="color: var(--accent-blue); text-decoration: underline;">${text}</a>`;
    });

    // 1. GFM Alerts (> [!WARNING] etc)
    html = html.replace(/^&gt;\s*\[!(WARNING|IMPORTANT|NOTE|TIP|CAUTION)\]\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n&gt;|\r?\n[^&gt;]|$)/gm, (match, type, content) => {
      const cleanContent = content.replace(/^&gt;\s?/gm, '').trim();
      let title = type;
      let icon = '⚠️';
      let border = 'rgba(245, 158, 11, 0.4)';
      let bg = 'rgba(245, 158, 11, 0.05)';
      if (type === 'IMPORTANT') {
        icon = '🚨';
        border = 'rgba(16, 185, 129, 0.4)';
        bg = 'rgba(16, 185, 129, 0.05)';
      } else if (type === 'NOTE') {
        icon = 'ℹ️';
        border = 'rgba(59, 130, 246, 0.4)';
        bg = 'rgba(59, 130, 246, 0.05)';
      } else if (type === 'TIP') {
        icon = '💡';
        border = 'rgba(139, 92, 246, 0.4)';
        bg = 'rgba(139, 92, 246, 0.05)';
      } else if (type === 'CAUTION') {
        icon = '🛑';
        border = 'rgba(239, 68, 68, 0.4)';
        bg = 'rgba(239, 68, 68, 0.05)';
      }
      return `
        <div style="border-left: 4px solid ${border}; background: ${bg}; padding: 1rem; margin-bottom: 1.5rem; border-radius: 0 0.5rem 0.5rem 0; display: flex; align-items: start; gap: 1rem;">
          <div style="font-size: 1.5rem;">${icon}</div>
          <div>
            <h4 style="margin: 0; text-transform: uppercase; font-weight: bold; font-size: 0.85rem; letter-spacing: 0.05em; color: white;">${title}</h4>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">${cleanContent}</p>
          </div>
        </div>
      `;
    });

    // 2. Flowchart representation for mermaid
    html = html.replace(/```mermaid([\s\S]*?)```/g, () => {
      return `
        <div style="display: flex; flex-direction: column; gap: 1rem; margin: 1.5rem 0; padding: 1.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 0.5rem;">
          <h4 style="margin: 0 0 1rem 0; font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">🔄 Workflow Pipeline Flowchart</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: center;">
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">1. Morning Check</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">2. Discovery</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">3. Research & Score</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">4. Draft Gen</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600; border-color: var(--accent-blue); color: var(--accent-blue);">5. Manual Contact</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">6. Track Outcome</div>
            <span style="color: var(--text-secondary); font-weight: bold;">&rarr;</span>
            <div style="flex: 1; min-width: 120px; padding: 0.75rem; background: #161131; border: 1px solid var(--border); border-radius: 0.5rem; text-align: center; font-size: 0.85rem; font-weight: 600;">7. Review Log</div>
          </div>
        </div>
      `;
    });

    // 3. Code Blocks
    html = html.replace(/```(.*?)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); padding: 1rem; border-radius: 0.5rem; font-family: monospace; font-size: 0.85rem; color: #cbd5e1; overflow-x: auto; margin: 1rem 0;"><code>${code.trim()}</code></pre>`;
    });

    // 4. Inline Code
    html = html.replace(/`([^`\n]+)`/g, '<code style="background: rgba(255,255,255,0.06); padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.9em; color: var(--accent-blue);">$1</code>');

    // 5. Headings
    html = html.replace(/^# (.*$)/gm, '<h1 style="font-size: 1.8rem; font-weight: 700; color: white; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-top: 2rem; margin-bottom: 1rem;">$1</h1>');
    html = html.replace(/^## (.*$)/gm, '<h2 style="font-size: 1.4rem; font-weight: 600; color: #38bdf8; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-top: 1.8rem; margin-bottom: 0.8rem;">$1</h2>');
    html = html.replace(/^### (.*$)/gm, '<h3 style="font-size: 1.15rem; font-weight: 600; color: white; margin-top: 1.5rem; margin-bottom: 0.6rem;">$1</h3>');

    // 6. Bold & Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: white; font-weight: 600;">$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em style="color: var(--text-secondary);">$1</em>');

    // 7. Unordered Lists
    const lines = html.split('\n');
    let inList = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^[\t ]*\* (.*$)/);
      if (match) {
        let content = match[1];
        if (!inList) {
          lines[i] = '<ul style="margin: 0.5rem 0 1rem 0; padding-left: 1.5rem; line-height: 1.6;">\n<li style="margin-bottom: 0.35rem; color: var(--text-primary);">' + content + '</li>';
          inList = true;
        } else {
          lines[i] = '<li style="margin-bottom: 0.35rem; color: var(--text-primary);">' + content + '</li>';
        }
      } else {
        if (inList) {
          lines[i] = '</ul>\n' + line;
          inList = false;
        }
      }
    }
    html = lines.join('\n');

    // 8. Paragraphs
    html = html.split(/\r?\n\r?\n/).map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li') || trimmed.startsWith('<div') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<table')) {
        return trimmed;
      }
      return `<p style="margin: 0.8rem 0; line-height: 1.6; color: var(--text-primary); font-size: 0.95rem;">${trimmed}</p>`;
    }).join('\n');

    return html;
  }

  const formattedHtml = parseMarkdownToHtml(rawContent);

  const content = `
    <div class="panel" style="margin-bottom: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="margin: 0; font-size: 1.8rem; background: linear-gradient(135deg, #22D3EE 0%, #0284C7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
            📋 Daily Operator Playbook
          </h2>
          <p style="color: var(--text-secondary); margin: 0.25rem 0 0 0; font-size: 0.9rem;">
            Step-by-step guidelines for finding, scoring, and manually contacting B2B prospects.
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center;">
          <span style="font-size: 0.85rem; color: var(--text-secondary); font-family: monospace;">openclaw/ops/OPS1_LIVE_USAGE_METRICS_TEMPLATE.md</span>
          <a href="/dashboard/cockpit" onclick="appendToken(this)" class="btn btn-primary" style="height: 40px; display: inline-flex; align-items: center;">Go to Cockpit</a>
        </div>
      </div>

      <div class="playbook-content" style="max-width: 900px; margin: 0 auto; color: var(--text-primary);">
        ${formattedHtml}
      </div>
    </div>
  `;

  res.send(renderDashboardShell('Daily Operator Playbook', 'playbook', content, token));
});

module.exports = {
  dashboardRouter: router,
  protectDashboard,
  getAdminToken,
  _ipRequestHistory: ipRequestHistory
};

