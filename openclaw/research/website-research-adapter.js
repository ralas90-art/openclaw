/**
 * OpenClaw Website Research Adapter (Read-only Website Context Extractor)
 * 
 * Safety Gating & Compliance:
 * Research performs read-only public-source lookups and saves local enrichment records only.
 * It does not perform external writes.
 */

const axios = require('axios');
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const modelAdapter = require('../runtime/model-adapter');

function isPrivateIPv4(ipStr) {
  const parts = ipStr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  const [a, b, c, d] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true;  // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true; // unspecified
  return false;
}

function isPrivateIPv6(ipStr) {
  const normalized = ipStr.toLowerCase().trim();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) return true;
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.substring(7);
    return isPrivateIPv4(ipv4Part);
  }
  return false;
}

function validateUrlString(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch (err) {
    throw new Error(`Access Denied: Invalid URL: ${urlStr} (blocked for scraper)`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Access Denied: Unsupported protocol '${protocol}'. Only HTTP and HTTPS are allowed for scrapers.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject localhost, 127.0.0.1, 0.0.0.0, metadata IPs directly
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '169.254.169.254'
  ) {
    throw new Error(`Access Denied: Local or metadata host detected: ${hostname} (blocked for scraper)`);
  }

  // Reject internal hostnames (e.g. no dots, or ending in .local, .internal, etc.)
  if (!hostname.includes('.')) {
    throw new Error(`Access Denied: Internal hostnames are not allowed: ${hostname} (blocked for scraper)`);
  }
  if (
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.localdomain')
  ) {
    throw new Error(`Access Denied: Internal domain suffix detected: ${hostname} (blocked for scraper)`);
  }

  // Reject LinkedIn, Facebook, X/Twitter domains
  const blockedDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'x.com'];
  if (blockedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
    throw new Error(`Access Denied: Social media domain '${hostname}' is restricted for scrapers`);
  }

  // Reject URLs containing login/signin/auth/admin in the path or query
  if (/login|signin|auth|admin/i.test(urlStr)) {
    throw new Error(`Access Denied: URL contains restricted keywords (login/signin/auth/admin) (blocked for scraper): ${urlStr}`);
  }

  return parsed;
}

async function validateHostnameIP(hostname) {
  try {
    const dnsLookup = promisify(dns.lookup);
    const { address } = await dnsLookup(hostname);
    if (address) {
      if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
        throw new Error(`Access Denied: Resolved host IP '${address}' is a private or local address (blocked for scraper)`);
      }
    }
  } catch (err) {
    if (err.message.includes('Access Denied:')) {
      throw err;
    }
    throw new Error(`Access Denied: Hostname '${hostname}' could not be resolved (blocked for scraper)`);
  }
}

function cleanHtml(html) {
  if (!html) return '';
  let clean = html;

  // 1. Strip script tags and content
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 2. Strip style tags and content
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // 3. Strip form tags and content
  clean = clean.replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');

  // 4. Strip hidden fields (input type="hidden")
  clean = clean.replace(/<input[^>]*type=["']hidden["'][^>]*>/gi, '');
  clean = clean.replace(/<input[^>]*type=hidden[^>]*>/gi, '');

  // 5. Strip tracking pixels (images/iframes)
  clean = clean.replace(/<img[^>]*>/gi, '');
  clean = clean.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');

  // 6. Convert remaining tags to space to preserve word boundaries
  clean = clean.replace(/<[^>]+>/g, ' ');

  // 7. Clean whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  return clean.substring(0, 5000); // limit payload size
}

function sanitizeUrlForLogging(urlStr) {
  try {
    const parsed = new URL(urlStr);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (err) {
    return 'invalid-url';
  }
}

function getAuditLogPath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.resolve(__dirname, '../..');
  return path.join(root, 'openclaw/research/data/research_audit.json');
}

function writeAuditLog(attempt) {
  try {
    const logPath = getAuditLogPath();
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let logs = [];
    if (fs.existsSync(logPath)) {
      try {
        logs = JSON.parse(fs.readFileSync(logPath, 'utf8')) || [];
      } catch (e) {
        logs = [];
      }
    }
    logs.push(attempt);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error(`[WebsiteResearchAdapter] Failed to write audit log: ${err.message}`);
  }
}

async function researchWebsite(prospectId, websiteUrl, businessName, options = {}) {
  if (!websiteUrl || typeof websiteUrl !== 'string' || websiteUrl.trim() === '') {
    throw new Error('Valid website URL is required for website research enrichment');
  }

  // Set up safety parameters from env with defaults
  const isMock = process.env.OPENCLAW_RESEARCH_MOCK !== 'false'; // Defaults to true
  const isLiveFetchEnabled = process.env.OPENCLAW_RESEARCH_LIVE_FETCH_ENABLED === 'true'; // Defaults to false
  const maxBytes = parseInt(process.env.OPENCLAW_RESEARCH_MAX_BYTES, 10) || 250000;
  const timeoutMs = parseInt(process.env.OPENCLAW_RESEARCH_TIMEOUT_MS, 10) || 8000;
  const maxRedirects = parseInt(process.env.OPENCLAW_RESEARCH_MAX_REDIRECTS, 10) || 2;
  const isLlmSummaryEnabled = process.env.OPENCLAW_RESEARCH_LLM_SUMMARY_ENABLED === 'true'; // Defaults to false

  const hash = crypto.createHash('md5').update(businessName + websiteUrl).digest('hex');
  const researchId = `res_${hash.substring(0, 16)}`;
  const sanitizedUrl = sanitizeUrlForLogging(websiteUrl);

  const logAttempt = (status, blockReason) => {
    writeAuditLog({
      researchId,
      prospectId,
      sourceType: 'website',
      status,
      blockReason: blockReason || null,
      timestamp: new Date().toISOString(),
      sanitizedUrl
    });
  };

  // 1. Initial URL and Host checks
  try {
    const parsed = validateUrlString(websiteUrl);
    if (!isMock) {
      await validateHostnameIP(parsed.hostname);
    }
  } catch (err) {
    logAttempt('blocked', err.message);
    throw err;
  }

  if (isMock) {
    console.log(`[WebsiteResearchAdapter] Mock enrichment active for: "${businessName}" (${websiteUrl})`);
    logAttempt('allowed', null);

    return {
      researchId,
      prospectId,
      businessName,
      website: websiteUrl,
      googleMapsUri: options.googleMapsUri || null,
      sourceType: 'website',
      sourceUrls: [websiteUrl],
      websiteSummary: `A local business site for ${businessName} showing clear descriptions of their core service offerings.`,
      servicesDetected: ['Standard repairs', 'Consultation', 'Installation services'],
      leadCaptureIssues: [
        'No immediate text callback option',
        'Contact form requires too many steps',
        'Lacks online scheduling tools'
      ],
      trustSignals: [
        'Licensed and insured badges visible',
        'Features customer reviews'
      ],
      reviewThemes: [
        'Professional service feedback',
        'Prompt arrival times'
      ],
      recommendedOutreachAngle: `Pitch Cresca OS instant lead response widgets to resolve the lack of fast SMS callback capabilities on their home page.`,
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  // If live scraping is requested but disabled, block and throw
  if (!isLiveFetchEnabled) {
    const msg = 'Live website research fetching is disabled by environment configuration';
    logAttempt('blocked', msg);
    throw new Error(`Access Denied: ${msg} (blocked for scraper)`);
  }

  // Live scraping path
  console.log(`[WebsiteResearchAdapter] Scrapes live URL: "${websiteUrl}"`);
  try {
    let currentUrl = websiteUrl;
    let redirects = 0;
    let finalContent = '';

    while (true) {
      const parsedUrl = validateUrlString(currentUrl);
      await validateHostnameIP(parsedUrl.hostname);

      const response = await axios.request({
        url: currentUrl,
        method: 'GET',
        timeout: timeoutMs,
        maxRedirects: 0,
        validateStatus: (status) => (status >= 200 && status < 400),
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) {
          throw new Error(`Received redirect status ${response.status} but no Location header was returned`);
        }
        redirects++;
        if (redirects > maxRedirects) {
          throw new Error(`Access Denied: Redirect limit of ${maxRedirects} exceeded (blocked for scraper)`);
        }
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      // Check Content-Type
      const contentType = response.headers['content-type'] || '';
      const isHtml = contentType.toLowerCase().includes('text/html');
      const isText = contentType.toLowerCase().includes('text/plain');
      if (!isHtml && !isText) {
        throw new Error(`Access Denied: Unsupported Content-Type '${contentType}'. Only text/html and text/plain are allowed (blocked for scraper).`);
      }

      // Check Content-Length if present
      const contentLength = response.headers['content-length'];
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > maxBytes) {
          throw new Error(`Access Denied: Content size (${size} bytes) exceeds maximum limit of ${maxBytes} bytes (blocked for scraper)`);
        }
      }

      // Stream content
      finalContent = await new Promise((resolve, reject) => {
        let data = '';
        let bytesRead = 0;
        response.data.on('data', (chunk) => {
          bytesRead += chunk.length;
          if (bytesRead > maxBytes) {
            response.data.destroy();
            reject(new Error(`Access Denied: Content size exceeded maximum limit of ${maxBytes} bytes during download (blocked for scraper)`));
            return;
          }
          data += chunk.toString('utf8');
        });
        response.data.on('end', () => {
          resolve(data);
        });
        response.data.on('error', (err) => {
          reject(err);
        });
      });

      break;
    }

    const bodyText = cleanHtml(finalContent);
    
    // Compile summary and findings
    let websiteSummary = `HTML scraped from ${currentUrl}.`;
    let servicesDetected = ['General services'];
    let leadCaptureIssues = ['No automated chat/SMS option detected'];
    let trustSignals = ['Local address listed'];
    let reviewThemes = ['Positive local presence'];
    let recommendedOutreachAngle = `Pitch Cresca OS local outreach automation to improve customer intake speed.`;
    
    if (isLlmSummaryEnabled) {
      const systemPrompt = `You are a professional B2B lead researcher. Extract structured details from the website text. Return a JSON structure or plain markers:
SUMMARY: A one-sentence summary of the business.
SERVICES: Comma-separated list of services offered.
ISSUES: Comma-separated list of lead-conversion issues (e.g. no chat widget, slow forms, no pricing).
TRUST: Comma-separated list of trust signals.
THEMES: Customer review/feedback themes.
ANGLE: Best personalized outreach pitch angle for Cresca OS services.`;

      const userPrompt = `Business Name: ${businessName}\nWebsite Content:\n${bodyText}`;

      try {
        const llmResult = await modelAdapter.generateResponse(systemPrompt, userPrompt);
        const text = llmResult.content || llmResult.rawResponse || '';
        
        // Simple line parser
        const summaryMatch = text.match(/SUMMARY:\s*(.*)/i);
        if (summaryMatch) websiteSummary = summaryMatch[1].trim();

        const servicesMatch = text.match(/SERVICES:\s*(.*)/i);
        if (servicesMatch) servicesDetected = servicesMatch[1].split(',').map(s => s.trim()).filter(Boolean);

        const issuesMatch = text.match(/ISSUES:\s*(.*)/i);
        if (issuesMatch) leadCaptureIssues = issuesMatch[1].split(',').map(s => s.trim()).filter(Boolean);

        const trustMatch = text.match(/TRUST:\s*(.*)/i);
        if (trustMatch) trustSignals = trustMatch[1].split(',').map(s => s.trim()).filter(Boolean);

        const themesMatch = text.match(/THEMES:\s*(.*)/i);
        if (themesMatch) reviewThemes = themesMatch[1].split(',').map(s => s.trim()).filter(Boolean);

        const angleMatch = text.match(/ANGLE:\s*(.*)/i);
        if (angleMatch) recommendedOutreachAngle = angleMatch[1].trim();
      } catch (err) {
        console.error(`[WebsiteResearchAdapter] LLM parsing failed, falling back to heuristics: ${err.message}`);
      }
    }

    logAttempt('allowed', null);

    return {
      researchId,
      prospectId,
      businessName,
      website: websiteUrl,
      googleMapsUri: options.googleMapsUri || null,
      sourceType: 'website',
      sourceUrls: [websiteUrl],
      websiteSummary,
      servicesDetected,
      leadCaptureIssues,
      trustSignals,
      reviewThemes,
      recommendedOutreachAngle,
      confidence: 0.85,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    logAttempt('blocked', err.message);
    throw err;
  }
}

module.exports = {
  researchWebsite,
  validateUrlString,
  validateHostnameIP,
  isPrivateIPv4,
  isPrivateIPv6,
  cleanHtml
};
