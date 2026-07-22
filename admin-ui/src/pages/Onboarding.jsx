import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Onboarding() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    provider: 'ghl',
    location_id: '',
    access_token: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 
          'Authorization': 'Bearer ' + (sessionStorage.getItem('adminToken') || ''),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(form)
      });
      const result = await res.json();
      if (result.success) {
        alert("Tenant onboarded successfully!");
        navigate(`/tenants/${result.tenant_id}`);
      } else {
        alert("Failed: " + result.error);
      }
    } catch (err) {
      alert("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Tenant Onboarding</h1>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Tenant Name</label>
            <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Company Name" />
          </div>
          
          <h3 style={{ marginTop: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>GHL Connection</h3>
          
          <div className="form-group">
            <label>Provider</label>
            <select value={form.provider} onChange={e => setForm({...form, provider: e.target.value})}>
              <option value="ghl">GoHighLevel</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Location ID</label>
            <input required value={form.location_id} onChange={e => setForm({...form, location_id: e.target.value})} placeholder="GHL Location ID" />
          </div>
          
          <div className="form-group">
            <label>API Key / Access Token</label>
            <input type="password" required value={form.access_token} onChange={e => setForm({...form, access_token: e.target.value})} placeholder="••••••••" />
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Create & Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
