/**
 * Hermes Telegram Webhook Callback Query Router (Phase UX1)
 */

const permissions = require('../../openclaw/runtime/runtime-permissions');
const tgHandlers = require('./handlers');
const menu = require('./hermes-ux-menu');
const formatters = require('./hermes-card-formatters');
const researchStore = require('../../openclaw/research/prospect-research-store');
const scoreStore = require('../../openclaw/research/prospect-score-store');
const reviewStore = require('../../openclaw/prospects/prospect-outreach-review-store');

/**
 * Maps callback action names to equivalent commands for permission checking.
 */
const CALLBACK_COMMANDS_MAP = {
  'research': '/research_prospect',
  'score': '/score_prospect',
  'draft': '/prospect_outreach',
  'dispatch': '/hermes_dispatch',
  'mark_contacted': '/outreach_mark_contacted',
  'followup': '/outreach_followup'
};

/**
 * Routes and handles incoming callback queries.
 * Returns a response (String object decorated with reply_markup) or null.
 */
async function handleCallback(callbackQuery) {
  const data = callbackQuery.data || '';
  const chatId = callbackQuery.message?.chat?.id;
  const fromId = callbackQuery.from?.id;
  
  if (!chatId || !data) return null;

  const messageContext = {
    chat: { id: String(chatId) },
    from: { id: String(fromId || chatId) }
  };

  // 1. Menu and Cockpit Callback Routes
  if (data.startsWith('menu:')) {
    const action = data.substring(5);
    
    // Check general read_runtime capability for all visibility actions
    const permCheck = permissions.requireCommandPermission('/cockpit_today', messageContext);
    if (!permCheck.allowed) {
      return permissions.formatPermissionDenied('/cockpit_today', permCheck.reason, messageContext);
    }

    if (action === 'start') {
      return menu.handleMenuCommand(messageContext);
    }
    if (action === 'find_prospects') {
      return menu.handleFindProspectsStart(messageContext);
    }
    if (action === 'cockpit_today') {
      return await tgHandlers.handleCommand('/cockpit_today', messageContext);
    }
    if (action === 'cockpit_top') {
      return await tgHandlers.handleCommand('/cockpit_top', messageContext);
    }
    if (action === 'followups_due') {
      return await tgHandlers.handleCommand('/cockpit_due', messageContext);
    }
    if (action === 'review_drafts') {
      return await tgHandlers.handleCommand('/outreach_status', messageContext);
    }
    if (action === 'pipeline_status') {
      return await tgHandlers.handleCommand('/outreach_pipeline', messageContext);
    }
    if (action === 'prospect_latest') {
      return await tgHandlers.handleCommand('/prospect_latest', messageContext);
    }
    
    // Instructions fallbacks
    if (action === 'research_prospect') {
      return `🧠 *Research Prospect Instruction*\n\nTo enrich a prospect, view details of any prospect (e.g. `/prospect_latest`) and click **Research Website**, or type:\n`/research_prospect <prospectId>``;
    }
    if (action === 'score_prospect') {
      return `⭐ *Score Prospect Instruction*\n\nTo score a prospect, view details of any enriched prospect (e.g. `/research_latest`) and click **Score Fit**, or type:\n`/score_prospect <prospectId>``;
    }
    if (action === 'generate_outreach') {
      return `✍️ *Generate Outreach Instruction*\n\nTo draft outreach, view details of any scored prospect (e.g. `/score_latest`) and click **Draft Outreach**, or type:\n`/prospect_outreach <prospectId>``;
    }
    
    return null;
  }

  // 2. Guided Prospecting Workflow Callback Routes
  if (data.startsWith('find:')) {
    const parts = data.split(':');
    const step = parts[1];
    
    const permCheck = permissions.requireCommandPermission('/prospect_search', messageContext);
    if (!permCheck.allowed) {
      return permissions.formatPermissionDenied('/prospect_search', permCheck.reason, messageContext);
    }

    const state = menu.getSessionState(chatId) || { step: 'niche', niche: null, area: null };

    if (step === 'niche') {
      const niche = parts[2];
      if (niche === 'custom') {
        state.step = 'awaiting_custom_niche';
        menu.setSessionState(chatId, state);
        return `✍️ *Custom Niche Input*\n\nPlease type the custom target industry niche (e.g. Landscaping):`;
      } else {
        const canonicalNiche = niche.charAt(0).toUpperCase() + niche.slice(1);
        state.niche = canonicalNiche;
        state.step = 'area';
        menu.setSessionState(chatId, state);
        return menu.handleFindAreaPrompt(chatId, canonicalNiche);
      }
    }

    if (step === 'area') {
      const area = parts[2];
      if (area === 'custom') {
        state.step = 'awaiting_custom_area';
        menu.setSessionState(chatId, state);
        return `✍️ *Custom Area Input*\n\nPlease type the custom target region area (e.g. Queens):`;
      } else {
        let canonicalArea = 'Suffolk County';
        if (area === 'nassau') canonicalArea = 'Nassau County';
        if (area === 'li') canonicalArea = 'Long Island';
        
        return await menu.executeGuidedSearch(chatId, state.niche, canonicalArea, messageContext);
      }
    }

    return null;
  }

  // 3. Action Callback Routes
  if (data.startsWith('act:')) {
    const parts = data.split(':');
    const action = parts[1];
    const targetId = parts[2];
    
    // Authorization pre-check mapping action to command permission
    const requiredCmd = CALLBACK_COMMANDS_MAP[action] || '/prospect_read';
    const permCheck = permissions.requireCommandPermission(requiredCmd, messageContext);
    if (!permCheck.allowed) {
      return permissions.formatPermissionDenied(requiredCmd, permCheck.reason, messageContext);
    }

    // act:prop_read:<prospectId> -> View Prospect Card
    if (action === 'prop_read') {
      return await tgHandlers.handleCommand(`/prospect_read ${targetId}`, messageContext);
    }

    // act:research:<prospectId> -> Run Website Research
    if (action === 'research') {
      return await tgHandlers.handleCommand(`/research_prospect ${targetId}`, messageContext);
    }

    // act:res_read:<prospectId> -> View Research Summary
    if (action === 'res_read') {
      return await tgHandlers.handleCommand(`/research_read ${targetId}`, messageContext);
    }

    // act:res_details:<prospectId> -> View Research Details
    if (action === 'res_details') {
      const research = researchStore.getResearchForProspect(targetId);
      if (!research) return `❌ Research details not found for prospect \`${targetId}\`.`;
      return formatters.formatResearchCard(research, false);
    }

    // act:score:<prospectId> -> Run Score Prospect
    if (action === 'score') {
      return await tgHandlers.handleCommand(`/score_prospect ${targetId}`, messageContext);
    }

    // act:scr_read:<prospectId> -> View Score Summary
    if (action === 'scr_read') {
      return await tgHandlers.handleCommand(`/score_read ${targetId}`, messageContext);
    }

    // act:scr_details:<prospectId> -> View Score Details
    if (action === 'scr_details') {
      const scores = scoreStore.loadScores() || {};
      const score = Object.values(scores).find(s => s.prospectId === targetId);
      if (!score) return `❌ Score details not found for prospect \`${targetId}\`.`;
      return formatters.formatScoreCard(score, false);
    }

    // act:draft:<prospectId> -> Generate Outreach Job
    if (action === 'draft') {
      return await tgHandlers.handleCommand(`/prospect_outreach ${targetId}`, messageContext);
    }

    // act:out_read:<reviewId> -> View Outreach Summary
    if (action === 'out_read') {
      return await tgHandlers.handleCommand(`/outreach_read ${targetId}`, messageContext);
    }

    // act:out_details:<reviewId> -> View Outreach Details (Drafts)
    if (action === 'out_details') {
      const reviews = reviewStore.loadReviews() || {};
      const review = Object.values(reviews).find(r => r.reviewId === targetId);
      if (!review) return `❌ Outreach review details not found for ID \`${targetId}\`.`;
      return formatters.formatOutreachCard(review, false);
    }

    // act:dispatch:<reviewId> -> Run Hermes Dispatch
    if (action === 'dispatch') {
      const reviews = reviewStore.loadReviews() || {};
      const review = Object.values(reviews).find(r => r.reviewId === targetId);
      if (!review || !review.hermesJobId) {
        return `❌ Error: No pending Hermes Job associated with this outreach review.`;
      }
      return await tgHandlers.handleCommand(`/hermes_dispatch ${review.hermesJobId}`, messageContext);
    }

    // act:contact_menu:<reviewId> -> Choose channel submenu
    if (action === 'contact_menu') {
      const out = `📞 *Log Manual Contact*\n\n` +
                  `Select the outreach channel used to contact this prospect:`;
      const buttons = [
        [
          { text: "💬 SMS", callback_data: `act:mark_contacted:${targetId}:sms` },
          { text: "✉️ Email", callback_data: `act:mark_contacted:${targetId}:email` },
          { text: "📱 DM", callback_data: `act:mark_contacted:${targetId}:dm` }
        ],
        [
          { text: "📋 Back to Review", callback_data: `act:out_read:${targetId}` }
        ]
      ];
      const response = new String(out);
      response.reply_markup = { inline_keyboard: buttons };
      return response;
    }

    // act:mark_contacted:<reviewId>:<channel> -> Log Contact
    if (action === 'mark_contacted') {
      const channel = parts[3];
      return await tgHandlers.handleCommand(`/outreach_mark_contacted ${targetId} ${channel}`, messageContext);
    }

    // act:follow_menu:<reviewId> -> Choose follow-up schedule submenu
    if (action === 'follow_menu') {
      const out = `📅 *Schedule Follow-up*\n\n` +
                  `Select the follow-up duration:`;
      const buttons = [
        [
          { text: "Tomorrow", callback_data: `act:followup:${targetId}:tomorrow` },
          { text: "In 3 Days", callback_data: `act:followup:${targetId}:3days` },
          { text: "In 1 Week", callback_data: `act:followup:${targetId}:1week` }
        ],
        [
          { text: "📋 Back to Review", callback_data: `act:out_read:${targetId}` }
        ]
      ];
      const response = new String(out);
      response.reply_markup = { inline_keyboard: buttons };
      return response;
    }

    // act:followup:<reviewId>:<duration> -> Schedule Date
    if (action === 'followup') {
      const duration = parts[3];
      let days = 1;
      if (duration === '3days') days = 3;
      if (duration === '1week') days = 7;
      const dateStr = new Date(Date.now() + days * 24 * 3600000).toISOString().split('T')[0];
      return await tgHandlers.handleCommand(`/outreach_followup ${targetId} ${dateStr}`, messageContext);
    }
  }

  return null;
}

module.exports = {
  handleCallback
};
