import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function TenantList() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const res = await apiFetch('/api/admin/tenants');
        if (res.ok) {
          setTenants(await res.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchTenants();
  }, []);

  if (loading) return <div>Loading tenants...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Tenants</h1>
        <Link to="/onboarding" className="btn btn-primary">Add Tenant</Link>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan="3" className="empty-state">No live data available yet.</td>
              </tr>
            ) : (
              tenants.map(tenant => (
                <tr key={tenant.id}>
                  <td><strong>{tenant.name}</strong></td>
                  <td>{new Date(tenant.created_at).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/tenants/${tenant.id}`} className="btn">View Details</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
