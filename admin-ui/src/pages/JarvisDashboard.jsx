import React, { useEffect, useState } from 'react';
import { Sparkles, Mail, Database, CheckCircle2, XCircle, Ban, History, ShieldAlert, ArrowRight, RefreshCw, Smartphone, ListTodo, Lock } from 'lucide-react';
import { apiFetch } from '../api/client';

export default function JarvisDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Data States
  const [stats, setStats] = useState(null);
  const [brief, setBrief] = useState(null);
  const [priorities, setPriorities] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [mobileUploads, setMobileUploads] = useState([]);
  const [projects, setProjects] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);

  // Selection States
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [selectedPriority, setSelectedPriority] = useState(null);
  const [activeTab, setActiveTab] = useState('brief'); // brief | priorities | approvals | connectors | mobile | projects
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  const handleLogout = async () => {
    try {
      await apiFetch('/api/jarvis/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
    setIsAuthenticated(false);
  };

  const fetchAllData = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const [statsRes, briefRes, prioritiesRes, approvalsRes, connectorsRes, mobileRes, projectsRes, sessionsRes] = await Promise.all([
        apiFetch('/api/jarvis/approval-stats'),
        apiFetch('/api/jarvis/daily-brief'),
        apiFetch('/api/jarvis/priorities'),
        apiFetch('/api/jarvis/approvals'),
        apiFetch('/api/jarvis/connectors'),
        apiFetch('/api/jarvis/mobile-uploads'),
        apiFetch('/api/jarvis/projects'),
        apiFetch('/api/jarvis/work-sessions')
      ]);

      if (statsRes.status === 401 || briefRes.status === 401) {
        setIsAuthenticated(false);
        setError('Session expired or unauthorized.');
        return;
      }

      setIsAuthenticated(true);
      if (statsRes.ok) setStats(await statsRes.json());
      if (briefRes.ok) setBrief(await briefRes.json());
      if (prioritiesRes.ok) setPriorities(await prioritiesRes.json());
      if (approvalsRes.ok) setApprovals(await approvalsRes.json());
      if (connectorsRes.ok) setConnectors(await connectorsRes.json());
      if (mobileRes.ok) setMobileUploads(await mobileRes.json());
      if (projectsRes.ok) setProjects(await projectsRes.json());
      if (sessionsRes.ok) setWorkSessions(await sessionsRes.json());

    } catch (err) {
      console.error(err);
      setError('Connection failure loading Jarvis data.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleConnect = async (connectorId) => {
    try {
      const res = await apiFetch('/api/jarvis/google/connect-ticket', {
        method: 'POST',
        body: JSON.stringify({ connector: connectorId })
      });
      const data = await res.json();
      if (data.success && data.ticket) {
        window.location.assign(`/api/jarvis/google/connect?ticket=${encodeURIComponent(data.ticket)}&force=true`);
      } else {
        setError(data.error || 'Failed to issue Google connect ticket.');
      }
    } catch (err) {
      console.error('[GoogleConnect Error]', err);
      setError('Network failure generating connect ticket.');
    }
  };

  useEffect(() => {
    let isMounted = true;
    const params = new URLSearchParams(window.location.search);
    const urlTicket = params.get('ticket');

    const initDashboard = async () => {
      if (urlTicket) {
        try {
          const res = await apiFetch('/api/jarvis/auth/exchange-ticket', {
            method: 'POST',
            body: JSON.stringify({ ticket: urlTicket.trim() })
          });
          const data = await res.json();
          if (data.success && isMounted) {
            setIsAuthenticated(true);
            await fetchAllData();
          } else if (isMounted) {
            setError(data.error || 'Failed to exchange single-use ticket.');
          }
        } catch (err) {
          console.error('[Dashboard] Ticket exchange error:', err);
          if (isMounted) setError('Failed to exchange auth ticket.');
        } finally {
          params.delete('ticket');
          const newSearch = params.toString();
          const newPath = window.location.pathname + (newSearch ? '?' + newSearch : '');
          window.history.replaceState({}, document.title, newPath);
        }
      } else {
        await fetchAllData();
      }
    };

    initDashboard();
    return () => {
      isMounted = false;
    };
  }, []);

  // Approval Mutation Handlers
  const handleApprove = async (id) => {
    setSubmitting(true);
    setModalError('');
    try {
      const res = await apiFetch(`/api/jarvis/approvals/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✅ Success: ${data.message || 'Action executed'}`);
        setSelectedApproval(null);
        fetchAllData();
      } else {
        setModalError(data.error || 'Approval failed');
      }
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (id) => {
    setSubmitting(true);
    setModalError('');
    try {
      const res = await apiFetch(`/api/jarvis/approvals/${id}/reject`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage(`🛑 Proposal rejected.`);
        setSelectedApproval(null);
        fetchAllData();
      } else {
        setModalError(data.error || 'Rejection failed');
      }
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    setSubmitting(true);
    setModalError('');
    try {
      const res = await apiFetch(`/api/jarvis/approvals/${id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage(`🚫 Proposal cancelled.`);
        setSelectedApproval(null);
        fetchAllData();
      } else {
        setModalError(data.error || 'Cancellation failed');
      }
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Priority Action Propose Handler
  const handlePropose = async (priorityId) => {
    setSubmitting(true);
    setModalError('');
    try {
      const res = await apiFetch(`/api/jarvis/priorities/${priorityId}/propose`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage(`📝 Action proposed successfully! ID: ${data.proposal?.id}`);
        setSelectedPriority(null);
        fetchAllData();
      } else {
        setModalError(data.error || 'Proposal creation failed');
      }
    } catch (err) {
      setModalError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFetchApprovalDetails = async (id) => {
    setModalError('');
    try {
      const res = await apiFetch(`/api/jarvis/approvals/${id}`);
      if (res.ok) {
        setSelectedApproval(await res.json());
      }
    } catch (err) {
      setError('Failed to fetch approval details: ' + err.message);
    }
  };

  // Gated Authentication Rendering
  if (!isAuthenticated) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
      }}>
        <div style={{
          background: 'rgba(22, 27, 34, 0.6)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #30363d',
          padding: '40px',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '380px',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px'
          }}>
            <Lock size={28} color="#fff" />
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: '1.5rem', color: '#fff' }}>Jarvis Portal Auth</h2>
          <p style={{ margin: '0 0 25px', color: '#8b949e', fontSize: '0.9rem' }}>Access to the Jarvis Dashboard requires an active session cookie. Please generate a single-use ticket in Telegram using <code>/jarvis_dashboard</code>.</p>
          
          {error && <div style={{ color: '#f85149', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '15px' }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Dashboard Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '15px' }}>
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.8rem', color: '#fff' }}>
            <Sparkles color="#a78bfa" /> Jarvis Command Center
          </h1>
          <p style={{ margin: '5px 0 0', color: '#8b949e', fontSize: '0.9rem' }}>
            Read-first assistant panel. Live operations require explicit authorization.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={fetchAllData} className="btn" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <RefreshCw size={14} className={loading ? 'spin-anim' : ''} /> Refresh
          </button>
          <button onClick={handleLogout} className="btn btn-danger">Lock Portal</button>
        </div>
      </div>

      {/* Messaging / Alert Bar */}
      {message && <div style={{ color: '#58a6ff', background: 'rgba(88, 166, 255, 0.1)', border: '1px solid rgba(88, 166, 255, 0.2)', padding: '12px', borderRadius: '6px', fontSize: '0.9rem' }}>{message}</div>}
      {error && <div style={{ color: '#f85149', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.2)', padding: '12px', borderRadius: '6px', fontSize: '0.9rem' }}>{error}</div>}

      {/* Stats Summary Panel */}
      {stats && (
        <div className="card-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Pending</h3>
            <div className="value" style={{ color: '#58a6ff' }}>{stats.status_counts.pending}</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Executed</h3>
            <div className="value" style={{ color: '#238636' }}>{stats.status_counts.executed}</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Rejected</h3>
            <div className="value" style={{ color: '#f85149' }}>{stats.status_counts.rejected}</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Cancelled</h3>
            <div className="value" style={{ color: '#8b949e' }}>{stats.status_counts.cancelled}</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3>Expired</h3>
            <div className="value" style={{ color: '#d29922' }}>{stats.status_counts.expired}</div>
          </div>
        </div>
      )}

      {/* Dashboard Sub Navigation Tabs */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '1px solid #30363d', paddingBottom: '10px' }}>
        {[
          { id: 'brief', label: 'Morning Brief', icon: <Mail size={16} /> },
          { id: 'priorities', label: 'Priorities', icon: <Sparkles size={16} /> },
          { id: 'approvals', label: 'Approvals Queue', icon: <ListTodo size={16} /> },
          { id: 'connectors', label: 'Cloud Connectors', icon: <Database size={16} /> },
          { id: 'mobile', label: 'Mobile Inbox', icon: <Smartphone size={16} /> },
          { id: 'projects', label: 'Projects', icon: <History size={16} /> },
          { id: 'sessions', label: 'Work Sessions', icon: <History size={16} /> }
        ].map(t => (
          <button
            key={t.id}
            id={`tab-btn-${t.id}`}
            onClick={() => setActiveTab(t.id)}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: activeTab === t.id ? '#30363d' : 'transparent',
              borderColor: activeTab === t.id ? '#58a6ff' : 'transparent',
              color: activeTab === t.id ? '#fff' : '#8b949e'
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      <div className="panel" style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '20px' }}>
        
        {/* Tab 1: Morning Brief */}
        {activeTab === 'brief' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>🌅 Morning Brief Summary</h2>
            {brief ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ background: '#0d1117', border: '1px solid #30363d', padding: '15px', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 10px', color: '#8b949e' }}>Speech Synthesis Preview (Siri Summary)</h4>
                  <p style={{ margin: 0, fontStyle: 'italic', fontSize: '1rem', color: '#c9d1d9', lineHeight: '1.5' }}>
                    "{brief.siri_summary}"
                  </p>
                </div>
                <div style={{ background: '#0d1117', border: '1px solid #30363d', padding: '20px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.9rem', color: '#c9d1d9', overflowX: 'auto', maxHeight: '500px' }}>
                  {brief.raw_brief_markdown}
                </div>
              </div>
            ) : (
              <div className="empty-state">No daily brief compiled yet.</div>
            )}
          </div>
        )}

        {/* Tab 2: Priorities List */}
        {activeTab === 'priorities' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>💡 Ranked Priority Intelligence</h2>
            {priorities && priorities.rankedItems && priorities.rankedItems.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
                {priorities.rankedItems.map(p => (
                  <div key={p.priority_id} id={`priority-item-${p.priority_id}`} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d1117' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                        <span className={`badge ${p.score >= 60 ? 'danger' : p.score >= 30 ? 'warning' : 'success'}`}>Score: {p.score}</span>
                        <span className="badge muted">{p.type}</span>
                        <span style={{ fontSize: '0.85rem', color: '#8b949e' }}>Project: {p.project_slug || 'system'}</span>
                      </div>
                      <h4 style={{ margin: '5px 0 0', color: '#fff', fontSize: '1rem' }}>{p.heading}</h4>
                      {p.reasons && p.reasons.length > 0 && (
                        <p style={{ margin: '5px 0 0', color: '#8b949e', fontSize: '0.85rem' }}>Tags: {p.reasons.join(', ')}</p>
                      )}
                    </div>
                    <div>
                      <button onClick={() => setSelectedPriority(p)} className="btn btn-primary">Select Action</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No priorities registered.</div>
            )}

            {/* Selected Priority Action Proposal Modal */}
            {selectedPriority && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ width: '500px' }}>
                  <h3 style={{ margin: '0 0 15px', color: '#fff' }}>Propose Action</h3>
                  
                  {modalError && (
                    <div style={{ color: '#f85149', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '15px' }}>
                      ⚠️ {modalError}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    <p><strong>Heading:</strong> {selectedPriority.heading}</p>
                    <p><strong>Type:</strong> {selectedPriority.type}</p>
                    <p><strong>Priority ID:</strong> <code>{selectedPriority.priority_id}</code></p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button 
                      onClick={() => handlePropose(selectedPriority.priority_id)} 
                      className="btn btn-primary"
                      disabled={submitting}
                    >
                      {submitting ? 'Proposing...' : 'Confirm Proposal'}
                    </button>
                    <button 
                      onClick={() => { setSelectedPriority(null); setModalError(''); }} 
                      className="btn"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Approvals Queue */}
        {activeTab === 'approvals' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>📥 Action Approval Requests</h2>
            {approvals.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
                {approvals.map(app => (
                  <div key={app.id} id={`approval-item-${app.id}`} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d1117' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                        <span className={`badge ${app.risk_level === 'high' ? 'danger' : app.risk_level === 'medium' ? 'warning' : 'success'}`}>{app.risk_level} risk</span>
                        <span className={`badge ${app.status === 'executed' ? 'success' : app.status === 'pending' ? 'warning' : 'muted'}`}>{app.status}</span>
                        <span style={{ fontSize: '0.85rem', color: '#8b949e' }}>Project: {app.project_slug || 'system'}</span>
                      </div>
                      <h4 style={{ margin: '5px 0 0', color: '#fff', fontSize: '1.05rem' }}>{app.requested_action}</h4>
                      <p style={{ margin: '5px 0 0', color: '#8b949e', fontSize: '0.85rem' }}>Proposed: {new Date(app.created_at || app.proposed_at).toLocaleString()}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleFetchApprovalDetails(app.id)} className="btn">Details</button>
                      {app.status === 'pending' && (
                        <>
                          <button onClick={() => handleApprove(app.id)} className="btn btn-primary">Approve</button>
                          <button onClick={() => handleReject(app.id)} className="btn btn-danger">Reject</button>
                          <button onClick={() => handleCancel(app.id)} className="btn">Cancel</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No approval requests created.</div>
            )}

            {/* Selected Approval Details Modal (with audit trail) */}
            {selectedApproval && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ width: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
                  <h3 style={{ margin: '0 0 15px', color: '#fff' }}>Approval Details</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.9rem', color: '#c9d1d9', marginBottom: '20px' }}>
                    <p><strong>ID:</strong> <code>{selectedApproval.id}</code></p>
                    <p><strong>Action:</strong> {selectedApproval.requested_action}</p>
                    <p><strong>Risk Level:</strong> <span className={`badge ${selectedApproval.risk_level === 'high' ? 'danger' : 'warning'}`}>{selectedApproval.risk_level.toUpperCase()}</span></p>
                    <p><strong>Status:</strong> <code>{selectedApproval.status}</code></p>
                    {selectedApproval.proposed_payload && (
                      <div>
                        <strong>Payload Preview:</strong>
                        <pre style={{ background: '#0d1117', border: '1px solid #30363d', padding: '10px', borderRadius: '4px', overflowX: 'auto', fontSize: '0.8rem' }}>
                          {JSON.stringify(selectedApproval.proposed_payload, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedApproval.action_result_summary && (
                      <p><strong>Result:</strong> {selectedApproval.action_result_summary}</p>
                    )}
                    {selectedApproval.execution_error_summary && (
                      <p style={{ color: '#f85149' }}><strong>Error:</strong> {selectedApproval.execution_error_summary}</p>
                    )}
                    
                    {/* Audit Trail List */}
                    {selectedApproval.audit_events && selectedApproval.audit_events.length > 0 && (
                      <div>
                        <h4 style={{ margin: '15px 0 5px', color: '#fff' }}>📋 Audit Event Trail</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {selectedApproval.audit_events.map(ev => (
                            <div key={ev.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #30363d', padding: '8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                              <span style={{ color: '#8b949e' }}>[{new Date(ev.created_at).toLocaleTimeString()}]</span> <strong>{ev.event_type.toUpperCase()}</strong> by {ev.actor || 'system'}
                              <div style={{ fontStyle: 'italic', color: '#8b949e', marginTop: '2px' }}>{ev.safe_summary}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {modalError && (
                    <div style={{ color: '#f85149', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.2)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '15px', width: '100%', boxSizing: 'border-box' }}>
                      ⚠️ {modalError}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    {selectedApproval.status === 'pending' && (
                      <>
                        <button 
                          onClick={() => { handleApprove(selectedApproval.id); }} 
                          className="btn btn-primary"
                          disabled={submitting}
                        >
                          {submitting ? 'Executing...' : 'Approve & Execute'}
                        </button>
                        <button 
                          onClick={() => { handleReject(selectedApproval.id); }} 
                          className="btn btn-danger"
                          disabled={submitting}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <button 
                      onClick={() => { setSelectedApproval(null); setModalError(''); }} 
                      className="btn"
                      disabled={submitting}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Cloud Connectors */}
        {activeTab === 'connectors' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>🔌 Cloud Google Connectors</h2>
            <div className="card-grid">
              {connectors.map(c => (
                <div key={c.connector_id} id={`connector-${c.connector_id}`} className="card" style={{ background: '#0d1117' }}>
                  <h3>{c.name}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '15px 0' }}>
                    <span className={`badge ${c.status === 'Active' ? 'success' : c.status === 'Revoked' ? 'danger' : 'warning'}`}>
                      {c.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#8b949e', lineHeight: '1.6' }}>
                    <p style={{ margin: '5px 0' }}><strong>Permissions:</strong> {c.read_permissions.join(', ')}</p>
                    {c.last_used_at && <p style={{ margin: '5px 0' }}><strong>Last Used:</strong> {new Date(c.last_used_at).toLocaleString()}</p>}
                  </div>
                  <div style={{ marginTop: '20px' }}>
                    <button
                      onClick={() => handleGoogleConnect(c.connector_id)}
                      className="btn btn-primary"
                      style={{ display: 'inline-block', fontSize: '0.85rem' }}
                    >
                      Authorize Connector
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 5: Mobile Inbox */}
        {activeTab === 'mobile' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>📱 Mobile Upload Inbox</h2>
            {mobileUploads.length > 0 ? (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Intake</th>
                      <th>Type</th>
                      <th>Content</th>
                      <th>Caption</th>
                      <th>Lang</th>
                      <th>Created</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mobileUploads.map(upload => (
                      <tr key={upload.id}>
                        <td><code>{upload.intake_source}</code></td>
                        <td><span className="badge muted">{upload.task_type}</span></td>
                        <td>
                          {upload.text_content ? (
                            <div style={{ maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {upload.text_content}
                            </div>
                          ) : (
                            upload.media_url && <a href={upload.media_url} target="_blank" rel="noopener noreferrer">View Media</a>
                          )}
                        </td>
                        <td>{upload.caption || '-'}</td>
                        <td><code>{upload.language || '-'}</code></td>
                        <td>{new Date(upload.created_at).toLocaleString()}</td>
                        <td>
                          <span className={`badge ${upload.processed ? 'success' : 'warning'}`}>
                            {upload.processed ? 'processed' : 'unprocessed'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No mobile uploads recorded in the inbox.</div>
            )}
          </div>
        )}

        {/* Tab 6: Projects List */}
        {activeTab === 'projects' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>📂 Project States</h2>
            {projects.length > 0 ? (
              <div className="card-grid">
                {projects.map(p => (
                  <div key={p.slug} className="card" style={{ background: '#0d1117' }}>
                    <h3>{p.name}</h3>
                    <div style={{ margin: '10px 0' }}>
                      <span className={`badge ${p.status === 'active' ? 'success' : 'muted'}`}>
                        {p.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: '#8b949e', margin: '5px 0' }}>
                      Slug: <code>{p.slug}</code>
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#8b949e', margin: '5px 0' }}>
                      Registered: {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No projects loaded.</div>
            )}
          </div>
        )}

        {/* Tab 7: Work Sessions */}
        {activeTab === 'sessions' && (
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.2rem', margin: '0 0 15px' }}>🧠 Current Project Context & Work Sessions</h2>
            
            {/* Active Session Card */}
            <div style={{ background: '#0d1117', border: '1px solid #30363d', padding: '20px', borderRadius: '6px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 15px', color: '#58a6ff', fontSize: '1.1rem' }}>Active Work Context</h3>
              {workSessions.find(s => s.status === 'active' || s.status === 'updated') ? (() => {
                const active = workSessions.find(s => s.status === 'active' || s.status === 'updated');
                return (
                  <div>
                    <p style={{ margin: '5px 0' }}><strong>Active Project:</strong> <span className="badge success">{active.project_slug.toUpperCase()}</span></p>
                    <p style={{ margin: '5px 0' }}><strong>Status:</strong> <code>{active.status}</code></p>
                    <p style={{ margin: '5px 0' }}><strong>Started At:</strong> {new Date(active.started_at).toLocaleString()}</p>
                    <p style={{ margin: '10px 0 5px' }}><strong>Summary:</strong></p>
                    <pre style={{ background: '#161b22', padding: '10px', borderRadius: '4px', border: '1px solid #30363d', whiteSpace: 'pre-wrap', color: '#c9d1d9', fontSize: '0.85rem' }}>{active.summary || 'No summary'}</pre>
                    {active.blockers && <p style={{ margin: '5px 0', color: '#f85149' }}><strong>Blocker:</strong> {active.blockers}</p>}
                    {active.next_actions && <p style={{ margin: '5px 0', color: '#58a6ff' }}><strong>Next Action:</strong> {active.next_actions}</p>}
                  </div>
                );
              })() : (
                <p style={{ color: '#8b949e', margin: 0 }}>No active work session currently.</p>
              )}
            </div>

            {/* Consolidated Open Blockers & Next Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div style={{ background: '#0d1117', border: '1px solid #30363d', padding: '20px', borderRadius: '6px' }}>
                <h3 style={{ margin: '0 0 15px', color: '#f85149', fontSize: '1.1rem' }}>Open Blockers</h3>
                {workSessions.filter(s => s.blockers && s.blockers.trim() !== '' && s.blockers !== 'None').length > 0 ? (
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    {workSessions.filter(s => s.blockers && s.blockers.trim() !== '' && s.blockers !== 'None').map(s => (
                      <li key={s.id} style={{ margin: '8px 0', color: '#c9d1d9' }}>
                        <strong>[{s.project_slug.toUpperCase()}]:</strong> {s.blockers}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: '#8b949e', margin: 0 }}>No active session blockers.</p>
                )}
              </div>
              <div style={{ background: '#0d1117', border: '1px solid #30363d', padding: '20px', borderRadius: '6px' }}>
                <h3 style={{ margin: '0 0 15px', color: '#58a6ff', fontSize: '1.1rem' }}>Next Actions</h3>
                {workSessions.filter(s => s.next_actions && s.next_actions.trim() !== '' && s.next_actions !== 'None').length > 0 ? (
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    {workSessions.filter(s => s.next_actions && s.next_actions.trim() !== '' && s.next_actions !== 'None').map(s => (
                      <li key={s.id} style={{ margin: '8px 0', color: '#c9d1d9' }}>
                        <strong>[{s.project_slug.toUpperCase()}]:</strong> {s.next_actions}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: '#8b949e', margin: 0 }}>No pending session actions.</p>
                )}
              </div>
            </div>

            {/* Sessions History List */}
            <h3 style={{ margin: '20px 0 10px', color: '#fff', fontSize: '1.1rem' }}>History of Antigravity Work Sessions</h3>
            {workSessions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {workSessions.map(session => (
                  <div key={session.id} className="card" style={{ background: '#0d1117' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="badge success">{session.project_slug.toUpperCase()}</span>
                        <span className={`badge ${session.status === 'completed' ? 'muted' : 'warning'}`}>{session.status}</span>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#8b949e' }}>Source: {session.source} | Started: {new Date(session.started_at || session.created_at).toLocaleDateString()}</span>
                    </div>
                    <p style={{ margin: '5px 0', color: '#c9d1d9', fontSize: '0.9rem' }}>{session.summary || 'No summary'}</p>
                    {session.changed_files_summary && (
                      <p style={{ margin: '5px 0 0', color: '#8b949e', fontSize: '0.8rem' }}><strong>Changed Files:</strong> {session.changed_files_summary}</p>
                    )}
                    {session.tests_run_summary && (
                      <p style={{ margin: '2px 0 0', color: '#8b949e', fontSize: '0.8rem' }}><strong>Tests:</strong> {session.tests_run_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No work sessions recorded.</div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
