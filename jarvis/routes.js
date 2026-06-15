/**
 * Jarvis Routes
 * Defines API routing for Jarvis Personal Assistant
 */

const express = require('express');
const router = express.Router();
const { authenticateMobileToken, handleMobileIntake } = require('./mobile-intake');
const { getDailyBrief } = require('./controller');

// POST /api/jarvis/mobile-intake
router.post('/mobile-intake', authenticateMobileToken, handleMobileIntake);

// GET /api/jarvis/daily-brief
router.get('/daily-brief', authenticateMobileToken, async (req, res) => {
  try {
    const isRefresh = req.query.refresh === 'true';
    const format = (req.query.format || 'json').trim().toLowerCase();
    
    // Call controller getDailyBrief with refresh flag
    const briefResult = await getDailyBrief(isRefresh);
    
    const todayStr = new Date().toISOString().substring(0, 10);
    
    if (format === 'siri') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(briefResult.siri_summary);
    } else if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(briefResult.raw_brief_markdown);
    } else {
      // Default: json
      return res.status(200).json({
        success: true,
        brief_date: todayStr,
        raw_brief_markdown: briefResult.raw_brief_markdown,
        siri_summary: briefResult.siri_summary
      });
    }
  } catch (err) {
    console.error('[DailyBrief API Error]', err.message);
    // Secure error response: do not leak token hashes, internal DB errors, or stack traces
    return res.status(500).json({ error: 'Internal server error fetching daily brief' });
  }
});

module.exports = router;
