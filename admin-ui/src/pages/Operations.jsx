import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client';

export default function Operations() {
  const [failed, setFailed] = useState([]);
  const [deadLetters, setDeadLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replayEventId, setReplayEventId] = useState(null);
  const [replayReason, setReplayReason] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [fRes, dRes] = await Promise.all([
        apiFetch('/api/admin/operations/failed-syncs'),
        apiFetch('/api/admin/operations/deadletters')
      ]);
      if (fRes.ok) setFailed(await fRes.json());
      if (dRes.ok) setDeadLetters(await dRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadOps = async () => {
      if (isMounted) {
        await fetchData();
      }
    };
    loadOps();
    return () => {
      isMounted = false;
    };
  }, [fetchData]);

  const handleReplay = async () => {
    if (!replayEventId) return;
    try {
      const res = await apiFetch('/api/admin/replay', {
        method: 'POST',
        body: JSON.stringify({ event_id: replayEventId, reason: replayReason, confirm: true })
      });
      const result = await res.json();
      if (result.success) {
        alert("Replay initiated.");
        setReplayEventId(null);
        setReplayReason('');
        await fetchData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (err) {
      console.error(err);
      alert("Replay failed");
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Operations</h1>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Failed Syncs</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Tenant</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {failed.length === 0 ? (
                <tr><td colSpan="4" className="empty-state">No live data available yet.</td></tr>
              ) : (
                failed.map(f => (
                  <tr key={f.id}>
                    <td>{f.idempotency_key}</td>
                    <td>{f.tenant_id}</td>
                    <td><span className="badge danger">{f.status}</span></td>
                    <td>
                      <button className="btn" onClick={() => setReplayEventId(f.idempotency_key)}>Replay</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2>Dead Letters</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Tenant</th>
                <th>Attempts</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {deadLetters.length === 0 ? (
                <tr><td colSpan="4" className="empty-state">No live data available yet.</td></tr>
              ) : (
                deadLetters.map(d => (
                  <tr key={d.id}>
                    <td>{d.event_type}</td>
                    <td>{d.tenant_id}</td>
                    <td>{d.attempts}</td>
                    <td style={{ color: 'var(--danger)' }}>{d.error_message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {replayEventId && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Confirm Replay</h3>
            <p>Replaying event <strong>{replayEventId}</strong></p>
            <div className="form-group">
              <label>Reason for replay</label>
              <input value={replayReason} onChange={e => setReplayReason(e.target.value)} placeholder="Required by runtime governance..." />
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button className="btn btn-primary" onClick={handleReplay}>Confirm Replay</button>
              <button className="btn" onClick={() => setReplayEventId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
