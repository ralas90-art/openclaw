/**
 * Jarvis Routes
 * Defines API routing for Jarvis Personal Assistant
 */

const express = require('express');
const router = express.Router();
const { authenticateMobileToken, handleMobileIntake } = require('./mobile-intake');

// POST /api/jarvis/mobile-intake
router.post('/mobile-intake', authenticateMobileToken, handleMobileIntake);

module.exports = router;
