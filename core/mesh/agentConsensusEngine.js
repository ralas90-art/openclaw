const { appEmitter } = require('../../lib/events');
const { supabase } = require('../../lib/supabase');

class ConsensusEngine {
  constructor() {
    this.pendingProposals = new Map();
  }

  async proposeAction(actionId, action, severity, proposerId) {
    const proposal = {
      id: actionId,
      action,
      severity,
      proposer: proposerId,
      votes: new Map([[proposerId, true]]),
      status: 'pending',
      createdAt: new Date()
    };

    this.pendingProposals.set(actionId, proposal);
    
    // Log initial vote
    await this.logVote(actionId, proposerId, true, 'Proposer auto-vote');

    // Broadcast for validation
    appEmitter.emit('mesh.consensus.requested', { actionId, action, severity, proposerId });

    // Informational actions (low severity) are auto-approved
    if (severity === 'low') {
      return await this.finalizeProposal(actionId, 'approved');
    }

    return proposal;
  }

  async recordVote(actionId, agentId, approved, reason = '') {
    const proposal = this.pendingProposals.get(actionId);
    if (!proposal || proposal.status !== 'pending') return;

    proposal.votes.set(agentId, approved);
    await this.logVote(actionId, agentId, approved, reason);

    const approvalCount = Array.from(proposal.votes.values()).filter(v => v).length;

    // Moderate: Majority vote (e.g., 2+ agents)
    if (proposal.severity === 'moderate' && approvalCount >= 2) {
      return await this.finalizeProposal(actionId, 'approved');
    }

    // Critical: Weighted consensus (3+ agents)
    if (proposal.severity === 'critical' && approvalCount >= 3) {
      return await this.finalizeProposal(actionId, 'approved');
    }
  }

  async finalizeProposal(actionId, status) {
    const proposal = this.pendingProposals.get(actionId);
    if (!proposal) return;

    proposal.status = status;
    appEmitter.emit(`mesh.consensus.${status}`, { actionId, action: proposal.action });
    
    console.log(`[Consensus] Proposal ${actionId} ${status.toUpperCase()}`);
    return proposal;
  }

  async logVote(proposalId, agentId, vote, reason) {
    if (!supabase) return;
    try {
      await supabase.from('agent_consensus_votes').insert([{
        proposal_id: proposalId,
        agent_id: agentId,
        vote,
        reason,
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('[Consensus] Failed to log vote:', err.message);
    }
  }
}

module.exports = new ConsensusEngine();
