/**
 * OpenClaw Prospect Angle Optimizer Rules Engine (Phase R3)
 */

const crypto = require('crypto');
const scoreStore = require('./prospect-score-store');

const TARGET_KEYWORDS = [
  'roofing', 'roof', 'solar', 'cleaning', 'clean', 'maid', 'janitorial',
  'home service', 'contractor', 'plumber', 'electric', 'carpentry', 'carpenter'
];

const ENTERPRISE_KEYWORDS = [
  'franchise', 'inc', 'corp', 'corporation', 'national', 'group', 'association'
];

/**
 * Calculates scores, channel recommendations, and offer angles deterministically.
 * @param {object} prospect
 * @param {object|null} research
 * @returns {object} Calculated scores and properties
 */
function calculateProspectScore(prospect, research) {
  if (!prospect) {
    throw new Error('Prospect is required for scoring');
  }

  const redFlags = [];
  let fitScore = 50;
  let urgencyScore = 50;
  let websiteGapScore = 0;
  let followUpPotentialScore = 50;

  const businessNameLower = (prospect.businessName || '').toLowerCase();
  const categoryLower = (prospect.category || '').toLowerCase();
  const queryLower = (prospect.query || '').toLowerCase();

  // 1. fitScore Calculation
  if (prospect.website && prospect.website.trim() !== '') {
    fitScore += 20;
  } else {
    fitScore -= 25;
    redFlags.push('Missing website');
  }

  if (prospect.phoneNumber && prospect.phoneNumber.trim() !== '') {
    fitScore += 10;
  } else {
    fitScore -= 20;
    redFlags.push('No phone number available');
  }

  // Check target niches
  let categoryMatchesTarget = false;
  for (const kw of TARGET_KEYWORDS) {
    if (categoryLower.includes(kw) || queryLower.includes(kw)) {
      categoryMatchesTarget = true;
      break;
    }
  }

  if (categoryMatchesTarget) {
    fitScore += 20;
  } else if (!prospect.category || categoryLower === 'basic' || categoryLower === '') {
    fitScore -= 15;
  }

  // Franchise check
  let isEnterprise = false;
  for (const kw of ENTERPRISE_KEYWORDS) {
    if (businessNameLower.includes(kw)) {
      isEnterprise = true;
      break;
    }
  }

  if (isEnterprise) {
    fitScore -= 20;
    redFlags.push('Potential large franchise/enterprise');
  }

  // Research indicators for fit
  if (research) {
    const summaryLower = (research.websiteSummary || '').toLowerCase();
    const hasAdvancedFlow = 
      (research.leadCaptureIssues || []).length === 0 ||
      summaryLower.includes('calendly') ||
      summaryLower.includes('hubspot') ||
      summaryLower.includes('sophisticated') ||
      summaryLower.includes('advanced booking') ||
      summaryLower.includes('modern portal');

    if (hasAdvancedFlow) {
      fitScore -= 20;
      redFlags.push('Advanced booking flow/CRM already detected');
    }

    if (Array.isArray(research.servicesDetected) && research.servicesDetected.length > 0) {
      fitScore += 10;
    }

    if (Array.isArray(research.trustSignals) && research.trustSignals.length > 0) {
      fitScore += 10;
    }
  }

  // Clamp fitScore
  fitScore = Math.max(0, Math.min(100, fitScore));

  // 2. urgencyScore Calculation
  if (prospect.rating !== undefined && prospect.rating !== null) {
    if (prospect.rating < 4.2) {
      urgencyScore += 15;
    } else if (prospect.rating >= 4.7 && (prospect.userRatingCount || 0) < 10) {
      urgencyScore += 15;
    }
  }

  if (research) {
    const issues = research.leadCaptureIssues || [];
    if (issues.length >= 2) {
      urgencyScore += 20;
    }
    const hasSlowForm = issues.some(iss => {
      const lower = iss.toLowerCase();
      return lower.includes('slow') || lower.includes('broken') || lower.includes('static contact page');
    });
    if (hasSlowForm) {
      urgencyScore += 15;
    }
  }

  // Clamp urgencyScore
  urgencyScore = Math.max(0, Math.min(100, urgencyScore));

  // 3. websiteGapScore Calculation
  if (prospect.website && prospect.website.trim() !== '') {
    websiteGapScore += 20;
    if (research) {
      let issuesWeight = 0;
      const issues = research.leadCaptureIssues || [];
      for (const iss of issues) {
        const lower = iss.toLowerCase();
        if (
          lower.includes('no instant sms') ||
          lower.includes('slow form') ||
          lower.includes('no chat') ||
          lower.includes('no booking') ||
          lower.includes('widget') ||
          lower.includes('lacks online scheduling')
        ) {
          issuesWeight += 20;
        }
      }
      websiteGapScore += Math.min(60, issuesWeight);

      const summaryLower = (research.websiteSummary || '').toLowerCase();
      if (summaryLower.includes('slow speed') || summaryLower.includes('outdated') || summaryLower.includes('basic site')) {
        websiteGapScore += 20;
      }
    }
  } else {
    websiteGapScore += 30; // moderate gap since they lack website
  }

  // Clamp websiteGapScore
  websiteGapScore = Math.max(0, Math.min(100, websiteGapScore));

  // 4. followUpPotentialScore Calculation
  if (research) {
    if (Array.isArray(research.reviewThemes) && research.reviewThemes.length >= 2) {
      followUpPotentialScore += 15;
    }
    if (Array.isArray(research.servicesDetected) && research.servicesDetected.length >= 3) {
      followUpPotentialScore += 15;
    }
  }
  if (categoryMatchesTarget) {
    followUpPotentialScore += 10;
  }

  // Clamp followUpPotentialScore
  followUpPotentialScore = Math.max(0, Math.min(100, followUpPotentialScore));

  // 5. priority Assignment
  let priority = 'low';
  if (fitScore >= 75 && urgencyScore >= 60) {
    priority = 'high';
  } else if (fitScore >= 50) {
    priority = 'medium';
  }

  // 6. recommendedChannel Assignment
  let recommendedChannel = 'email';
  if (prospect.phoneNumber && (categoryLower.includes('roof') || queryLower.includes('roof') || categoryLower.includes('service') || categoryLower.includes('clean'))) {
    recommendedChannel = 'sms';
  } else if (!prospect.website || prospect.website.trim() === '') {
    if (prospect.phoneNumber) {
      recommendedChannel = 'call';
    } else {
      recommendedChannel = 'unknown';
    }
  } else if (research && Array.isArray(research.reviewThemes) && research.reviewThemes.some(t => t.toLowerCase().includes('social') || t.toLowerCase().includes('recommend'))) {
    recommendedChannel = 'dm';
  }

  // 7. recommendedOfferAngle Assignment
  let recommendedOfferAngle = 'Pitch Cresca OS lead conversion and CRM automation package.';
  if (research) {
    const issues = research.leadCaptureIssues || [];
    const hasSmsGap = issues.some(iss => {
      const lower = iss.toLowerCase();
      return lower.includes('no instant sms') || lower.includes('lacks fast sms') || lower.includes('callback');
    });
    const hasSchedulingGap = issues.some(iss => {
      const lower = iss.toLowerCase();
      return lower.includes('booking') || lower.includes('scheduling') || lower.includes('calendar');
    });

    if (hasSmsGap) {
      recommendedOfferAngle = 'Pitch Cresca OS Instant SMS Callback Widget to convert mobile traffic.';
    } else if (prospect.rating !== undefined && prospect.rating >= 4.5 && (prospect.userRatingCount || 0) < 15) {
      recommendedOfferAngle = 'Pitch Cresca OS automated review acquisition tool to build social proof.';
    } else if (hasSchedulingGap) {
      recommendedOfferAngle = 'Pitch Cresca OS online scheduling and calendar sync integration.';
    }
  }

  // 8. reasoning Formulation
  let reasoning = `${prospect.businessName || 'This prospect'} is evaluated with a fit score of ${fitScore}/100 and urgency of ${urgencyScore}/100. `;
  if (!prospect.website) {
    reasoning += 'They are missing a website, indicating a fundamental digital setup opportunity.';
  } else {
    reasoning += `They have a website, but we detected conversion gaps (${(research ? research.leadCaptureIssues || [] : []).join(', ') || 'none'}). `;
    if (categoryMatchesTarget) {
      reasoning += `Matches our target service industry niche (${prospect.category || 'home services'}), making them a high B2B outreach priority.`;
    }
  }

  return {
    fitScore,
    urgencyScore,
    websiteGapScore,
    followUpPotentialScore,
    recommendedChannel,
    recommendedOfferAngle,
    reasoning,
    redFlags,
    priority
  };
}

/**
 * Optimizes a prospect by loading its records, calculating scores, and saving the record.
 * @param {string} prospectId
 * @returns {object} The saved score record
 */
function optimizeProspect(prospectId) {
  const prospectStore = require('../prospects/prospect-store');
  const researchStore = require('./prospect-research-store');

  const prospects = prospectStore.loadProspects();
  const prospect = prospects.find(p => p.prospectId === prospectId);

  if (!prospect) {
    throw new Error(`Prospect with ID '${prospectId}' not found.`);
  }

  const research = researchStore.getResearchForProspect(prospectId);

  const scores = calculateProspectScore(prospect, research);

  const hash = crypto.createHash('md5').update(prospectId + (research ? research.researchId : '')).digest('hex');
  const scoreId = `scr_${hash.substring(0, 16)}`;

  const scoreRecord = {
    scoreId,
    prospectId,
    researchId: research ? research.researchId : 'none',
    businessName: prospect.businessName || prospect.name || 'Unknown Business',
    ...scores,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  scoreStore.saveScoreRecord(scoreRecord);
  return scoreRecord;
}

module.exports = {
  calculateProspectScore,
  optimizeProspect
};
