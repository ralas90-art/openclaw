import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function TenantDetail() {
  const { tenantId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const fetchTenant = async () => {
      try {
        const res = await apiFetch(`/api/admin/tenants/${tenantId}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchTenant();
  }, [tenantId]);

  const handleTestSync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/test-sync`, {
        method: 'POST'
      });
      const result = await res.json();
      alert(`Sync result: ${JSON.stringify(result.preflight)}`);
    } catch (err) {
      alert("Test sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!data) return <div className="empty-state">No live data available yet.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{data.tenant.name} <span className="badge muted">{data.tenant.id}</span></h1>
        <button className="btn btn-primary" onClick={handleTestSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Test Sync'}
        </button>
      </div>

      <div className="card-grid">
        {data.integrations.map((int, i) => (
          <div className="card" key={i}>
            <h3>Provider: {int.provider}</h3>
            <div>Status: <span className={`badge ${int.status === 'connected' ? 'success' : 'muted'}`}>{int.status}</span></div>
            <div style={{ marginTop: '10px' }}>Credentials: {int.credential_status}</div>
            {int.credential_preview && <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{int.credential_preview}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
