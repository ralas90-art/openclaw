/**
 * Lead Intelligence Schema
 * Standard structure for AI/Engine scoring outputs.
 */

const intelligenceSchema = {
  score: 0, // 0-100
  grade: 'C', // A, B, C, D, F
  recommendation: '',
  outreach_angle: '',
  flags: [],
  confidence_score: 0
};

module.exports = { intelligenceSchema };
