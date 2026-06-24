/**
 * Hermes Telegram Card Formatters (Phase UX1)
 * Combines cleaner formatting layout with inline action buttons.
 * Returns String objects decorated with reply_markup.
 */

const researchStore = require('../../openclaw/research/prospect-research-store');
const scoreStore = require('../../openclaw/research/prospect-score-store');
const reviewStore = require('../../openclaw/prospects/prospect-outreach-review-store');

/**
 * Formats a prospect details card with appropriate next-action buttons.
 */
function formatProspectCard(prospect) {
  const prospectId = prospect.prospectId;
  const research = researchStore.getResearchForProspect(prospectId);
  const scores = scoreStore.loadScores() || {};
  const score = Object.values(scores).find(s => s.prospectId === prospectId);
  const reviews = reviewStore.loadReviews() || {};
  const review = Object.values(reviews).find(r => r.prospectId === prospectId);

  const hasResearch = !!research;
  const hasScore = !!score;
  const hasOutreachDraft = !!(review && (review.outreachDraftPath || review.smsDraft || review.emailDraft || review.dmDraft));

  let out = `🏢 *PROSPECT DETAILS*\n`;
  out += `-------------------------\n`;
  out += `🏢 *Business:* *${prospect.businessName || prospect.name || 'Unknown Business'}*\n`;
  out += `📍 *Location:* ${prospect.town || 'Unknown'}, ${prospect.region || 'NY'}\n`;
  out += `🏷️ *Category:* \`${prospect.category || 'Unknown'}\`\n`;
  if (prospect.website) out += `🌐 *Website:* ${prospect.website}\n`;
  if (prospect.phoneNumber) out += `📞 *Phone:* ${prospect.phoneNumber}\n`;
  if (prospect.rating !== undefined && prospect.rating !== null) {
    out += `⭐ *Rating:* ${prospect.rating} ⭐ (${prospect.userRatingCount || 0} reviews)\n`;
  }
  if (hasResearch) {
    out += `🔍 *Research ID:* \`${research.researchId}\`\n`;
  }
  out += `-------------------------\n`;

  let nextStep = "Research Website";
  if (hasResearch) nextStep = "Score Fit & Channel";
  if (hasScore) nextStep = "Generate Outreach Draft";
  if (hasOutreachDraft) nextStep = "Review Outreach Drafts";

  out += `💡 *Recommended Action:* ${nextStep}`;

  const buttons = [];
  const actionRow = [];

  if (!hasResearch) {
    actionRow.push({ text: "🧠 Research Website", callback_data: `act:research:${prospectId}` });
  } else if (!hasScore) {
    actionRow.push({ text: "🧠 View Research", callback_data: `act:res_read:${prospectId}` });
    actionRow.push({ text: "⭐ Score Fit", callback_data: `act:score:${prospectId}` });
  } else if (!hasOutreachDraft) {
    actionRow.push({ text: "⭐ View Score", callback_data: `act:scr_read:${prospectId}` });
    actionRow.push({ text: "✍️ Draft Outreach", callback_data: `act:draft:${prospectId}` });
  } else {
    actionRow.push({ text: "📬 View Outreach", callback_data: `act:out_read:${prospectId}` });
  }

  if (actionRow.length > 0) {
    buttons.push(actionRow);
  }

  const bottomRow = [
    { text: "🖥 Open Dashboard", url: `http://localhost:3300/dashboard/prospects?q=${encodeURIComponent(prospect.businessName || '')}` }
  ];
  buttons.push(bottomRow);

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Formats a website research details card.
 */
function formatResearchCard(research, short = true) {
  const prospectId = research.prospectId;

  let out = `🧠 *RESEARCH FINDINGS*\n`;
  out += `-------------------------\n`;
  out += `🏢 *Business:* *${research.businessName || 'Unknown'}*\n`;
  out += `🎯 *Confidence:* ${Math.round((research.confidence || 0.9) * 100)}%\n`;
  out += `🏷️ *Services:* ${(research.servicesDetected || []).slice(0, 3).join(', ') || 'None'}\n`;
  out += `⚠️ *Gaps:* ${(research.leadCaptureIssues || []).slice(0, 3).join(', ') || 'None'}\n`;

  if (!short) {
    out += `-------------------------\n`;
    out += `📝 *Summary:* ${research.websiteSummary || 'No summary.'}\n\n`;
    out += `⭐ *Trust Signals:* ${(research.trustSignals || []).join(', ') || 'None'}\n`;
    out += `💬 *Review Themes:* ${(research.reviewThemes || []).join(', ') || 'None'}\n`;
    out += `💡 *Outreach Angle:* _${research.recommendedOutreachAngle || 'None'}_\n`;
  }
  out += `-------------------------\n`;

  const scores = scoreStore.loadScores() || {};
  const score = Object.values(scores).find(s => s.prospectId === prospectId);
  
  let nextStep = "Score Fit & Channel";
  if (score) nextStep = "Generate Outreach Draft";
  out += `💡 *Recommended Action:* ${nextStep}`;

  const buttons = [];
  const actionRow = [];

  if (short) {
    actionRow.push({ text: "📖 View Details", callback_data: `act:res_details:${prospectId}` });
  }

  if (!score) {
    actionRow.push({ text: "⭐ Score Fit", callback_data: `act:score:${prospectId}` });
  } else {
    actionRow.push({ text: "⭐ View Score", callback_data: `act:scr_read:${prospectId}` });
  }

  if (actionRow.length > 0) {
    buttons.push(actionRow);
  }

  const bottomRow = [
    { text: "📋 View Prospect", callback_data: `act:prop_read:${prospectId}` },
    { text: "🖥 Open Dashboard", url: `http://localhost:3300/dashboard/research/view?researchId=${research.researchId}` }
  ];
  buttons.push(bottomRow);

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Formats a fit score and channel optimizer card.
 */
function formatScoreCard(score, short = true) {
  const prospectId = score.prospectId;

  let out = `⭐ *FIT & CHANNEL EVALUATION (Prospect Score Details)*\n`;
  out += `-------------------------\n`;
  out += `🏢 *Business:* *${score.businessName || 'Unknown'}*\n`;
  out += `🔥 *Fit Score:* \`${score.fitScore}/100\` | *Urgency:* \`${score.urgencyScore}/100\`\n`;
  out += `🚨 *Priority:* *${String(score.priority).toUpperCase()}*\n`;
  out += `📱 *Channel:* \`${String(score.recommendedChannel).toUpperCase()}\`\n`;

  if (!short) {
    out += `-------------------------\n`;
    out += `💡 *Pitch Angle:* _${score.recommendedOfferAngle || 'None'}_\n\n`;
    out += `📝 *Reasoning:* ${score.reasoning || 'No details.'}\n`;
    if (score.redFlags && score.redFlags.length > 0) {
      out += `⚠️ *Red Flags:* ${score.redFlags.join(', ')}\n`;
    }
  }
  out += `-------------------------\n`;

  const reviews = reviewStore.loadReviews() || {};
  const review = Object.values(reviews).find(r => r.prospectId === prospectId);
  const hasDraft = !!(review && (review.outreachDraftPath || review.smsDraft || review.emailDraft || review.dmDraft));

  let nextStep = "Generate Outreach Draft";
  if (hasDraft) nextStep = "Review Outreach Drafts";
  out += `💡 *Recommended Action:* ${nextStep}`;

  const buttons = [];
  const actionRow = [];

  if (short) {
    actionRow.push({ text: "📖 View Details", callback_data: `act:scr_details:${prospectId}` });
  }

  if (!hasDraft) {
    actionRow.push({ text: "✍️ Draft Outreach", callback_data: `act:draft:${prospectId}` });
  } else {
    actionRow.push({ text: "📬 View Outreach", callback_data: `act:out_read:${prospectId}` });
  }

  if (actionRow.length > 0) {
    buttons.push(actionRow);
  }

  const bottomRow = [
    { text: "📋 View Prospect", callback_data: `act:prop_read:${prospectId}` },
    { text: "🖥 Open Dashboard", url: `http://localhost:3300/dashboard/research/view?researchId=${score.researchId || ''}` }
  ];
  buttons.push(bottomRow);

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Formats outreach review drafts and stage card.
 */
function formatOutreachCard(review, short = true) {
  const reviewId = review.reviewId;
  const prospectId = review.prospectId;

  let out = `📬 *OUTREACH REVIEW DRAFTS* (Outreach Review: ${review.businessName || 'Unknown'})\n`;
  out += `-------------------------\n`;
  out += `🏢 *Business:* *${review.businessName || 'Unknown'}*\n`;
  out += `🟢 *Status:* \`${review.status}\`\n`;
  out += `📞 *Manual Contacts:* \`${review.manualContactCount || 0}\`\n`;
  if (review.nextFollowUpAt) {
    out += `📅 *Next Follow-up:* \`${review.nextFollowUpAt.substring(0, 10)}\` (Stage: ${review.followUpStage || 0})\n`;
  }
  
  if (!short) {
    out += `-------------------------\n`;
    if (review.smsDraft) {
      out += `💬 *SMS Draft:*\n\`\`\`\n${review.smsDraft}\n\`\`\`\n\n`;
    }
    if (review.emailDraft) {
      out += `✉️ *Email Draft:*\n\`\`\`\n${review.emailDraft}\n\`\`\`\n\n`;
    }
    if (review.dmDraft) {
      out += `📱 *DM Draft:*\n\`\`\`\n${review.dmDraft}\n\`\`\`\n\n`;
    }
    if (review.discoveryCallAngle) {
      out += `📞 *Discovery Call Angle:*\n\`\`\`\n${review.discoveryCallAngle}\n\`\`\`\n\n`;
    }
    out += `📝 *Notes:* ${review.operatorNotes || '_None_'}\n`;
  }
  out += `-------------------------\n`;
  out += `💡 *Recommended Action:* Review generated drafts and dispatch.`;

  const buttons = [];
  const actionRow = [];

  if (short) {
    actionRow.push({ text: "📖 View Drafts", callback_data: `act:out_details:${reviewId}` });
  }
  actionRow.push({ text: "🚀 Dispatch Job", callback_data: `act:dispatch:${reviewId}` });
  buttons.push(actionRow);

  const contactRow = [
    { text: "📞 Log Contact", callback_data: `act:contact_menu:${reviewId}` },
    { text: "📅 Schedule Follow-up", callback_data: `act:follow_menu:${reviewId}` }
  ];
  buttons.push(contactRow);

  const bottomRow = [
    { text: "📋 View Prospect", callback_data: `act:prop_read:${prospectId}` },
    { text: "🖥 Open Dashboard", url: `http://localhost:3300/dashboard/outreach/view?reviewId=${reviewId}` }
  ];
  buttons.push(bottomRow);

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Formats cockpit overview today summary card.
 */
function formatCockpitToday(items) {
  const todayStr = new Date().toISOString().split('T')[0];

  const top5 = items.slice(0, 5);
  const dueToday = items.filter(item => item.nextFollowUpAt && item.nextFollowUpAt.substring(0, 10) <= todayStr);
  const highNoDraft = items.filter(item => item.priority === 'high' && !item.hasOutreachDraft);
  const bookedCount = items.filter(item => item.outreachStatus === 'booked_call').length;

  let out = `🎯 *Top Prospects Today*\n\n`;
  out += `*Top 5 Scored Prospects:*\n`;
  if (top5.length === 0) {
    out += `- None\n`;
  } else {
    top5.forEach((item, idx) => {
      const scoreText = item.fitScore !== null ? ` (Fit: ${item.fitScore}/100)` : ' (Unscored)';
      out += `${idx + 1}. *${item.businessName}* - ${item.priority.toUpperCase()}${scoreText}\n`;
    });
  }
  out += `\n`;
  out += `• *Follow-ups Due Today:* \`${dueToday.length}\`\n`;
  out += `• *High-Priority Without Drafts:* \`${highNoDraft.length}\`\n`;
  out += `• *Booked Calls Count:* \`${bookedCount}\``;

  const buttons = [
    [
      { text: "🏆 Top 10 Ranked", callback_data: "menu:cockpit_top" },
      { text: "🔁 Follow-ups Due", callback_data: "menu:followups_due" }
    ],
    [
      { text: "📬 Review Drafts", callback_data: "menu:review_drafts" },
      { text: "🖥 Cockpit Dashboard", url: "http://localhost:3300/dashboard/cockpit" }
    ]
  ];

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Formats cockpit top 10 list with prospect navigation buttons.
 */
function formatCockpitTop(items) {
  const top10 = items.slice(0, 10);

  if (top10.length === 0) {
    return `🎯 No prospects found in cockpit.`;
  }

  let out = `🏆 *Top 10 Ranked Prospects*\n\n`;
  top10.forEach((item, idx) => {
    const fitText = item.fitScore !== null ? `${item.fitScore}/100` : 'N/A';
    const draftText = item.hasOutreachDraft ? 'Draft Ready' : 'No Draft';
    out += `${idx + 1}. *${item.businessName}*\n` +
           `   • Priority: *${item.priority.toUpperCase()}* | Fit: \`${fitText}\`\n` +
           `   • Status: \`${item.outreachStatus}\` (${draftText})\n\n`;
  });

  const buttons = [];
  const row1 = [];
  const row2 = [];

  top10.slice(0, 5).forEach((item, idx) => {
    row1.push({ text: `${idx + 1}️⃣`, callback_data: `act:prop_read:${item.prospectId}` });
  });
  if (top10.length > 5) {
    top10.slice(5, 10).forEach((item, idx) => {
      row2.push({ text: `${idx + 6}️⃣`, callback_data: `act:prop_read:${item.prospectId}` });
    });
  }

  if (row1.length > 0) buttons.push(row1);
  if (row2.length > 0) buttons.push(row2);

  buttons.push([
    { text: "🖥 Scores Leaderboard", url: "http://localhost:3300/dashboard/scores" },
    { text: "🖥 Cockpit Dashboard", url: "http://localhost:3300/dashboard/cockpit" }
  ]);

  const response = new String(out.trim());
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

module.exports = {
  formatProspectCard,
  formatResearchCard,
  formatScoreCard,
  formatOutreachCard,
  formatCockpitToday,
  formatCockpitTop
};
