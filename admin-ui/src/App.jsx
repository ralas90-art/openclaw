import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TenantList from './pages/TenantList';
import TenantDetail from './pages/TenantDetail';
import Operations from './pages/Operations';
import Onboarding from './pages/Onboarding';
import JarvisDashboard from './pages/JarvisDashboard';
import { LayoutDashboard, Users, Activity, Settings, Sparkles } from 'lucide-react';
import './App.css';

function App() {
  return (
    <Router basename="/admin">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="sidebar-brand">
            <h2>Cresca OS</h2>
            <span className="badge">Admin</span>
          </div>
          <nav className="sidebar-nav">
            <Link to="/"><LayoutDashboard size={18}/> Dashboard</Link>
            <Link to="/tenants"><Users size={18}/> Tenants</Link>
            <Link to="/operations"><Activity size={18}/> Operations</Link>
            <Link to="/onboarding"><Settings size={18}/> Onboarding</Link>
            <Link to="/jarvis"><Sparkles size={18}/> Jarvis</Link>
          </nav>
        </aside>
        <main className="admin-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tenants" element={<TenantList />} />
            <Route path="/tenants/:tenantId" element={<TenantDetail />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/jarvis" element={<JarvisDashboard />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

