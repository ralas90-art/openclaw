/**
 * OpenClaw Hermes Daily Brief Automation
 */

const fs = require('fs');
const path = require('path');
const queueStore = require('./hermes-queue-store');
const { sanitizeHermesObservableJob } = require('./hermes-observability');
const usageLedger = require('../usage/llm-usage-ledger');

/**
 * Builds the complete structured daily brief for a given date YYYY-MM-DD.
 * @param {string} [date] Target date string. Defaults to today.
 * @param {object} [options] Future expansion options.
 * @returns {object} Structured brief payload.
 */
function buildHermesDailyBrief(date, options = {}) {
  const targetDate = date || new Date().toISOString().substring(0, 10);

  // Check safety configuration
  let realExecutionEnabled = false;
  let connectorMode = 'dry-run-only';
  try {
    const { listConnectors } = require('../runtime/connector-registry');
    const connectors = listConnectors();
    realExecutionEnabled = connectors.some(c => c.realExecutionEnabled === true);
  } catch (err) {}

  const brief = {
    date: targetDate,
    queueSummary: buildDailyQueueSummary(targetDate),
    failureSummary: buildDailyFailureSummary(targetDate),
    approvalSummary: buildDailyApprovalSummary(targetDate),
    usageSummary: buildDailyUsageSummary(targetDate),
    recommendedActions: buildDailyRecommendedActions(targetDate),
    prospectingSummary: buildProspectingSummary(),
    topProspectsToday: buildTopProspectsToday(),
    safetyConfirmation: {
      runtimeFrozen: true,
      realExecutionEnabled,
      connectorMode
    },
    generatedAt: new Date().toISOString()
  };

  return brief;
}

/**
 * Counts total jobs, successes, failures, and lists outputs and top bots.
 * @param {string} date
 * @returns {object}
 */
function buildDailyQueueSummary(date) {
  const queue = queueStore.loadQueue();
  const jobs = Object.values(queue).filter(j => j.createdAt && j.createdAt.startsWith(date));

  const total = jobs.length;
  const completed = jobs.filter(j => j.status === 'completed').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const blocked = jobs.filter(j => j.status === 'blocked').length;
  const awaiting = jobs.filter(j => j.status === 'awaiting_approval').length;
  
  const activeStatuses = ['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running'];
  const active = jobs.filter(j => activeStatuses.includes(j.status)).length;

  const botCounts = {};
  jobs.forEach(j => {
    const b = j.botId || 'unknown';
    botCounts[b] = (botCounts[b] || 0) + 1;
  });

  const topBots = Object.entries(botCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([botId, count]) => ({ botId, count }));

  const latestOutputs = jobs
    .filter(j => j.status === 'completed')
    .map(j => {
      const sanitized = sanitizeHermesObservableJob(j);
      return {
        hermesJobId: sanitized.hermesJobId,
        outputPath: sanitized.outputPath || null,
        driveLink: sanitized.driveLink || null
      };
    });

  return {
    total,
    completed,
    failed,
    blocked,
    awaiting,
    active,
    topBots,
    latestOutputs
  };
}

/**
 * Builds safe sanitizations of failure reasons for jobs created today.
 * @param {string} date
 * @returns {object[]}
 */
function buildDailyFailureSummary(date) {
  const queue = queueStore.loadQueue();
  const failedJobs = Object.values(queue)
    .filter(j => j.createdAt && j.createdAt.startsWith(date))
    .filter(j => j.status === 'failed' || j.status === 'blocked');

  return failedJobs.map(j => {
    const sanitized = sanitizeHermesObservableJob(j);
    return {
      hermesJobId: sanitized.hermesJobId,
      botId: sanitized.botId,
      status: sanitized.status,
      errorCategory: sanitized.errorCategory || 'unknown',
      safeMessage: sanitized.safeMessage || 'No error message details available.',
      updatedAt: sanitized.updatedAt
    };
  });
}

/**
 * Lists all pending approvals outstanding in the queue.
 * @param {string} date
 * @returns {object[]}
 */
function buildDailyApprovalSummary(date) {
  const queue = queueStore.loadQueue();
  const pending = Object.values(queue).filter(j => j.status === 'awaiting_approval');

  return pending.map(j => {
    const sanitized = sanitizeHermesObservableJob(j);
    return {
      hermesJobId: sanitized.hermesJobId,
      botId: sanitized.botId,
      approvalId: sanitized.approvalId,
      requestedBy: sanitized.requestedBy || 'system',
      createdAt: sanitized.createdAt
    };
  });
}

/**
 * Aggregates LLM usage stats and costs for the target date.
 * @param {string} date
 * @returns {object}
 */
function buildDailyUsageSummary(date) {
  const entries = usageLedger.listUsageEntries().filter(e => e.createdAt && e.createdAt.startsWith(date));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  const byBot = {};
  const byModel = {};

  for (const entry of entries) {
    totalInputTokens += entry.inputTokens || 0;
    totalOutputTokens += entry.outputTokens || 0;
    totalTokens += entry.totalTokens || 0;
    totalCostUsd += entry.estimatedCostUsd || 0;

    const bot = entry.botId || 'unknown';
    if (!byBot[bot]) {
      byBot[bot] = { count: 0, costUsd: 0, totalTokens: 0 };
    }
    byBot[bot].count++;
    byBot[bot].costUsd += entry.estimatedCostUsd || 0;
    byBot[bot].totalTokens += entry.totalTokens || 0;

    const model = entry.model || 'unknown';
    if (!byModel[model]) {
      byModel[model] = { count: 0, costUsd: 0, totalTokens: 0 };
    }
    byModel[model].count++;
    byModel[model].costUsd += entry.estimatedCostUsd || 0;
    byModel[model].totalTokens += entry.totalTokens || 0;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCostUsd,
    byBot,
    byModel
  };
}

/**
 * Generates recommended commands for approvals and failure logs.
 * @param {string} date
 * @returns {object[]}
 */
function buildDailyRecommendedActions(date) {
  const actions = [];
  const queue = queueStore.loadQueue();
  
  // Outstanding approvals currently pending
  const pending = Object.values(queue).filter(j => j.status === 'awaiting_approval');
  for (const j of pending) {
    actions.push({
      type: 'approval',
      message: `Approval Pending: Hermes Job ${j.hermesJobId} requires authorization.`,
      command: `/hermes_approve ${j.approvalId}`
    });
  }

  // Failed jobs created today
  const failed = Object.values(queue)
    .filter(j => j.createdAt && j.createdAt.startsWith(date))
    .filter(j => j.status === 'failed');
  for (const j of failed) {
    actions.push({
      type: 'failure',
      message: `Failed Job Audit: Hermes Job ${j.hermesJobId} encountered a runtime error.`,
      command: `/hermes_read ${j.hermesJobId}`
    });
  }

  return actions;
}

/**
 * Aggregates prospecting metrics for the daily brief.
 * @returns {object|null}
 */
function buildProspectingSummary() {
  try {
    const reviewStore = require('../prospects/prospect-outreach-review-store');
    const analytics = reviewStore.getPipelineAnalytics();
    return {
      totalReviews: analytics.total,
      notStarted: analytics.not_started,
      draftGenerated: analytics.draft_generated,
      reviewed: analytics.reviewed,
      contactedManually: analytics.contacted_manually,
      followUpNeeded: analytics.follow_up_needed,
      bookedCall: analytics.booked_call,
      notInterested: analytics.not_interested,
      dueToday: analytics.due_today
    };
  } catch (err) {
    return null;
  }
}

/**
 * Builds the top prospects today summary (top scored, follow-ups due, high-priority without drafts).
 * @returns {object|null}
 */
function buildTopProspectsToday() {
  try {
    const cockpit = require('../prospects/prospect-priority-cockpit');
    const items = cockpit.getCockpitData();
    const todayStr = new Date().toISOString().split('T')[0];

    // top 5 scored prospects
    const topScored = items.slice(0, 5).map(item => ({
      prospectId: item.prospectId,
      businessName: item.businessName,
      priority: item.priority,
      fitScore: item.fitScore
    }));

    // follow-ups due today
    const dueToday = items
      .filter(item => item.nextFollowUpAt && item.nextFollowUpAt.substring(0, 10) <= todayStr)
      .map(item => ({
        prospectId: item.prospectId,
        businessName: item.businessName,
        nextFollowUpAt: item.nextFollowUpAt
      }));

    // high-priority prospects without outreach drafts
    const highNoDraft = items
      .filter(item => item.priority === 'high' && !item.hasOutreachDraft)
      .map(item => ({
        prospectId: item.prospectId,
        businessName: item.businessName
      }));

    // booked calls count
    const bookedCallsCount = items.filter(item => item.outreachStatus === 'booked_call').length;

    return {
      topScored,
      dueToday,
      highNoDraft,
      bookedCallsCount
    };
  } catch (err) {
    return null;
  }
}

/**
 * Converts a structured brief JSON object into visual, clean Markdown.
 * @param {object} brief
 * @returns {string} Markdown document.
 */
function renderDailyBriefMarkdown(brief) {
  const qs = brief.queueSummary;
  const fs = brief.failureSummary;
  const ap = brief.approvalSummary;
  const us = brief.usageSummary;
  const ra = brief.recommendedActions;
  const sc = brief.safetyConfirmation;

  let md = `# 📆 OpenClaw Hermes Daily Brief - ${brief.date}\n\n`;

  md += `## 🛰️ Queue Activity Summary\n`;
  md += `*   **Total Jobs Today:** ${qs.total}\n`;
  md += `*   **Completed Today:** ${qs.completed}\n`;
  md += `*   **Failed Today:** ${qs.failed}\n`;
  md += `*   **Blocked Today:** ${qs.blocked}\n`;
  md += `*   **Awaiting Approval:** ${qs.awaiting}\n`;
  md += `*   **Active in Queue:** ${qs.active}\n\n`;

  md += `### 🤖 Top Bots Used Today\n`;
  if (qs.topBots.length === 0) {
    md += `No bot activity logged today.\n\n`;
  } else {
    qs.topBots.forEach((b, i) => {
      md += `${i + 1}. \`${b.botId}\`: ${b.count} run(s)\n`;
    });
    md += `\n`;
  }

  md += `### 📂 Latest Outputs Generated\n`;
  if (qs.latestOutputs.length === 0) {
    md += `No outputs generated today.\n\n`;
  } else {
    qs.latestOutputs.forEach(o => {
      const link = o.driveLink ? `[Drive Link](${o.driveLink})` : `Local outbox only`;
      md += `*   \`${o.hermesJobId}\`: \`${o.outputPath}\` (${link})\n`;
    });
    md += `\n`;
  }

  if (brief.prospectingSummary) {
    const ps = brief.prospectingSummary;
    md += `## 🎯 Prospecting Pipeline Summary\n`;
    md += `*   **Total Prospects Cataloged:** ${ps.totalReviews}\n`;
    md += `*   **Drafts Pending Review:** ${ps.draftGenerated}\n`;
    md += `*   **Contacted Manually:** ${ps.contactedManually}\n`;
    md += `*   **Follow-ups Scheduled:** ${ps.followUpNeeded}\n`;
    md += `*   **Booked Calls:** ${ps.bookedCall}\n`;
    md += `*   **Follow-ups Due Today:** ${ps.dueToday}\n\n`;
  }

  if (brief.topProspectsToday) {
    const tp = brief.topProspectsToday;
    md += `## 🎯 Top Prospects Today\n`;
    md += `### Top 5 Scored Prospects:\n`;
    if (tp.topScored.length === 0) {
      md += `No scored prospects found.\n\n`;
    } else {
      tp.topScored.forEach((p, idx) => {
        const scoreText = p.fitScore !== null ? ` (Fit Score: ${p.fitScore}/100)` : ' (Unscored)';
        md += `${idx + 1}. *${p.businessName}* - ${p.priority.toUpperCase()}${scoreText}\n`;
      });
      md += `\n`;
    }

    md += `### Follow-ups Due Today: ${tp.dueToday.length}\n`;
    if (tp.dueToday.length === 0) {
      md += `No follow-ups due today.\n\n`;
    } else {
      tp.dueToday.forEach(p => {
        md += `*   *${p.businessName}* (Due: ${p.nextFollowUpAt})\n`;
      });
      md += `\n`;
    }

    md += `### High-Priority Without Outreach Drafts: ${tp.highNoDraft.length}\n`;
    if (tp.highNoDraft.length === 0) {
      md += `All high-priority prospects have outreach drafts.\n\n`;
    } else {
      tp.highNoDraft.forEach(p => {
        md += `*   *${p.businessName}*\n`;
      });
      md += `\n`;
    }

    md += `### Booked Calls Count: ${tp.bookedCallsCount}\n\n`;
  }

  md += `## 💸 LLM Usage & Cost Summary\n`;
  md += `*   **Total Consumed Cost:** $${us.totalCostUsd.toFixed(5)} USD\n`;
  md += `*   **Total Tokens:** ${us.totalTokens.toLocaleString()}\n`;
  md += `*   **Input Tokens:** ${us.totalInputTokens.toLocaleString()}\n`;
  md += `*   **Output Tokens:** ${us.totalOutputTokens.toLocaleString()}\n\n`;

  md += `### Cost Breakdown by Bot\n`;
  if (Object.keys(us.byBot).length === 0) {
    md += `No LLM activity logged.\n\n`;
  } else {
    Object.entries(us.byBot).forEach(([bot, data]) => {
      md += `*   \`${bot}\`: ${data.count} run(s), ${data.totalTokens.toLocaleString()} tokens, $${data.costUsd.toFixed(5)} USD\n`;
    });
    md += `\n`;
  }

  md += `## ❌ Failures & Blocked Jobs\n`;
  if (fs.length === 0) {
    md += `No failed or blocked jobs today.\n\n`;
  } else {
    fs.forEach(f => {
      md += `### Job \`${f.hermesJobId}\` (${f.botId})\n`;
      md += `*   **Status:** ${f.status.toUpperCase()}\n`;
      md += `*   **Category:** ${f.errorCategory}\n`;
      md += `*   **Message:** ${f.safeMessage}\n\n`;
    });
  }

  md += `## 🔑 Outstanding Approvals\n`;
  if (ap.length === 0) {
    md += `No approvals pending currently.\n\n`;
  } else {
    ap.forEach(p => {
      md += `*   \`${p.hermesJobId}\` (Bot: \`${p.botId}\`) requested by \`${p.requestedBy}\` (Approval ID: \`${p.approvalId}\`)\n`;
    });
    md += `\n`;
  }

  md += `## 💡 Recommended Operator Actions\n`;
  if (ra.length === 0) {
    md += `✅ All systems quiet. No actions recommended.\n\n`;
  } else {
    ra.forEach(a => {
      md += `*   **${a.message}**\n`;
      if (a.command) {
        md += `    Run command: \`${a.command}\`\n`;
      }
    });
    md += `\n`;
  }

  md += `## 🛡️ Safety Confirmation\n`;
  md += `*   **Runtime frozen:** ${sc.runtimeFrozen ? 'Confirmed' : 'WARNING'}\n`;
  md += `*   **realExecutionEnabled:** ${sc.realExecutionEnabled ? 'WARNING: ENABLED' : 'Disabled (Confirmed)'}\n`;
  md += `*   **Connector mode:** \`${sc.connectorMode}\`\n`;

  return md;
}

/**
 * Saves both JSON and markdown files under openclaw/hermes/briefs/.
 * @param {object} brief
 * @returns {object} Paths of saved files.
 */
function saveDailyBrief(brief) {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  const briefsDir = path.resolve(root, 'openclaw', 'hermes', 'briefs');
  
  if (!fs.existsSync(briefsDir)) {
    fs.mkdirSync(briefsDir, { recursive: true });
  }

  const jsonFile = path.join(briefsDir, `daily-brief-${brief.date}.json`);
  const mdFile = path.join(briefsDir, `daily-brief-${brief.date}.md`);

  fs.writeFileSync(jsonFile, JSON.stringify(brief, null, 2), 'utf8');
  
  const mdContent = renderDailyBriefMarkdown(brief);
  fs.writeFileSync(mdFile, mdContent, 'utf8');

  return {
    jsonPath: jsonFile,
    markdownPath: mdFile
  };
}

module.exports = {
  buildHermesDailyBrief,
  buildDailyQueueSummary,
  buildDailyFailureSummary,
  buildDailyApprovalSummary,
  buildDailyUsageSummary,
  buildDailyRecommendedActions,
  buildTopProspectsToday,
  renderDailyBriefMarkdown,
  saveDailyBrief
};
