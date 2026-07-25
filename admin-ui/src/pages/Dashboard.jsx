import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [statusRes, incidentsRes] = await Promise.all([
          apiFetch('/api/admin/runtime/status'),
          apiFetch('/api/admin/incidents')
        ]);
        
        if (statusRes.ok) setStatus(await statusRes.json());
        if (incidentsRes.ok) setIncidents(await incidentsRes.json());
      } catch (err) {
        console.error("Failed to load dashboard", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) return <div>Loading dashboard...</div>;
  if (!status) return <div className="empty-state">No live data available yet.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Runtime Overview</h1>
        <span className={`badge ${status.status === 'ACTIVE' ? 'success' : 'danger'}`}>
          System: {status.status}
        </span>
      </div>

      <div className="card-grid">
        <div className="card">
          <h3>Health Score</h3>
          <div className="value">{status.health_score || 0}/100</div>
        </div>
        <div className="card">
          <h3>Safe Mode</h3>
          <div className="value">
            <span className={`badge ${status.safe_mode ? 'warning' : 'success'}`}>
              {status.safe_mode ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>
        </div>
        <div className="card">
          <h3>Database Status</h3>
          <div className="value">
            <span className={`badge ${status.database === 'Connected' ? 'success' : 'danger'}`}>
              {status.database}
            </span>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Active Incidents</th>
              <th>Severity</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {incidents.length === 0 ? (
              <tr>
                <td colSpan="5" className="empty-state">No active incidents detected.</td>
              </tr>
            ) : (
              incidents.map(inc => (
                <tr key={inc.id}>
                  <td>{inc.message}</td>
                  <td><span className={`badge ${inc.severity === 'critical' ? 'danger' : 'warning'}`}>{inc.severity}</span></td>
                  <td>{inc.provider}</td>
                  <td>{inc.status}</td>
                  <td>{new Date(inc.created_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
