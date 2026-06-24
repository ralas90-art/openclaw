/**
 * OpenClaw Prospect Priority Cockpit Business Logic (Phase R4)
 */

const prospectStore = require('./prospect-store');
const reviewStore = require('./prospect-outreach-review-store');
const scoreStore = require('../research/prospect-score-store');
const researchStore = require('../research/prospect-research-store');

/**
 * Aggregates, filters, and ranks all cataloged prospects.
 * @param {object} [filters] Query filters from operator command or HTTP request.
 * @returns {object[]} Ranked and prioritized prospect cockpit items.
 */
function getCockpitData(filters = {}) {
  const prospects = prospectStore.loadProspects();
  const scores = scoreStore.loadScores() || {};
  const researchList = researchStore.loadResearch() || {};
  const reviews = reviewStore.loadReviews() || {};

  const researchMap = new Map();
  Object.values(researchList).forEach(r => {
    researchMap.set(r.prospectId, r);
  });

  const scoreMap = new Map();
  Object.values(scores).forEach(s => {
    scoreMap.set(s.prospectId, s);
  });

  const reviewMap = new Map();
  Object.values(reviews).forEach(r => {
    reviewMap.set(r.prospectId, r);
  });

  const todayStr = new Date().toISOString().split('T')[0];

  let items = prospects.map(p => {
    const res = researchMap.get(p.prospectId) || null;
    const scr = scoreMap.get(p.prospectId) || null;
    const rev = reviewMap.get(p.prospectId) || null;

    const hasOutreachDraft = !!(rev && (rev.outreachDraftPath || rev.smsDraft || rev.emailDraft || rev.dmDraft));

    return {
      prospectId: p.prospectId,
      businessName: p.businessName || p.name || 'Unknown Business',
      town: p.town || 'Unknown',
      category: p.category || 'Unknown',
      website: p.website || null,
      phoneNumber: p.phoneNumber || null,
      rating: p.rating !== undefined ? p.rating : null,
      userRatingCount: p.userRatingCount || 0,
      discoveredAt: p.discoveredAt,

      hasScore: !!scr,
      scoreId: scr ? scr.scoreId : null,
      fitScore: scr ? scr.fitScore : null,
      urgencyScore: scr ? scr.urgencyScore : null,
      websiteGapScore: scr ? scr.websiteGapScore : null,
      followUpPotentialScore: scr ? scr.followUpPotentialScore : null,
      priority: scr ? scr.priority : 'unscored',
      recommendedChannel: scr ? scr.recommendedChannel : 'unknown',
      recommendedOfferAngle: scr ? scr.recommendedOfferAngle : 'None',
      redFlags: scr ? scr.redFlags : [],
      reasoning: scr ? scr.reasoning : '',

      hasResearch: !!res,
      researchId: res ? res.researchId : null,
      researchStatus: res ? 'completed' : 'none',

      hasOutreachDraft,
      reviewId: rev ? rev.reviewId : null,
      outreachStatus: rev ? rev.status : 'not_started',
      manualContactCount: rev ? rev.manualContactCount : 0,
      lastManualContactChannel: rev ? rev.lastManualContactChannel : null,
      nextFollowUpAt: rev ? rev.nextFollowUpAt : null,
      outcome: rev ? rev.outcome : null,
      bookingNotes: rev ? rev.bookingNotes : null
    };
  });

  // Apply filters
  if (filters.priority) {
    items = items.filter(item => item.priority === filters.priority);
  }
  if (filters.status) {
    if (filters.status === 'not contacted') {
      items = items.filter(item => item.manualContactCount === 0);
    } else if (filters.status === 'contacted') {
      items = items.filter(item => item.manualContactCount > 0);
    } else if (filters.status === 'follow-up due') {
      items = items.filter(item => item.nextFollowUpAt && item.nextFollowUpAt.substring(0, 10) <= todayStr);
    } else if (filters.status === 'booked call') {
      items = items.filter(item => item.outreachStatus === 'booked_call');
    }
  }
  if (filters.town) {
    const t = filters.town.trim().toLowerCase();
    items = items.filter(item => item.town.toLowerCase().includes(t));
  }
  if (filters.category) {
    const c = filters.category.trim().toLowerCase();
    items = items.filter(item => item.category.toLowerCase().includes(c));
  }
  if (filters.recommendedChannel) {
    items = items.filter(item => item.recommendedChannel === filters.recommendedChannel);
  }
  if (filters.hasResearch) {
    const hasRes = filters.hasResearch === 'true';
    items = items.filter(item => item.hasResearch === hasRes);
  }
  if (filters.hasScore) {
    const hasScr = filters.hasScore === 'true';
    items = items.filter(item => item.hasScore === hasScr);
  }
  if (filters.hasOutreachDraft) {
    const hasDr = filters.hasOutreachDraft === 'true';
    items = items.filter(item => item.hasOutreachDraft === hasDr);
  }

  // Sort: Priority (high > medium > low > unscored), then fitScore desc, then urgencyScore desc, then discoveredAt desc
  const priorityWeight = { high: 4, medium: 3, low: 2, unscored: 1 };
  items.sort((a, b) => {
    const wA = priorityWeight[a.priority] || 1;
    const wB = priorityWeight[b.priority] || 1;
    if (wA !== wB) {
      return wB - wA;
    }
    const fA = a.fitScore !== null ? a.fitScore : -1;
    const fB = b.fitScore !== null ? b.fitScore : -1;
    if (fA !== fB) {
      return fB - fA;
    }
    const uA = a.urgencyScore !== null ? a.urgencyScore : -1;
    const uB = b.urgencyScore !== null ? b.urgencyScore : -1;
    if (uA !== uB) {
      return uB - uA;
    }
    return new Date(b.discoveredAt || 0) - new Date(a.discoveredAt || 0);
  });

  return items;
}

module.exports = {
  getCockpitData
};
