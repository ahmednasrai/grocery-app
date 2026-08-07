import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import EmployeePOS from './pages/EmployeePOS';
import AdminDash from './pages/AdminDash';
import Inventory from './pages/Inventory';
import Users from './pages/Users';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './context/AuthContext';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 font-bold">
      جاري التحميل...
    </div>
  );
}

const RequireAuth = ({ children }) => {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return profile ? children : <Navigate to="/login" replace />;
};

const RequirePermission = ({ permission, children }) => {
  const { profile, hasPermission, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!profile) return <Navigate to="/login" replace />;
  return hasPermission(permission) ? children : <Navigate to="/pos" replace />;
};

const PublicRoute = ({ children }) => {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (profile) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/pos'} replace />;
  }
  return children;
};

const homePath = (profile) => (profile?.role === 'admin' ? '/admin' : '/pos');

function AppShell() {
  const location = useLocation();
  const { profile, loading } = useAuth();
  const hideNavbar = location.pathname === '/login';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans" dir="rtl">
      {!hideNavbar && <Navbar />}
      <main>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/pos" element={<RequireAuth><RequirePermission permission="pos"><EmployeePOS /></RequirePermission></RequireAuth>} />
          <Route path="/inventory" element={<RequireAuth><RequirePermission permission="inventory"><Inventory /></RequirePermission></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><RequirePermission permission="reports"><AdminDash /></RequirePermission></RequireAuth>} />
          <Route path="/users" element={<RequireAuth><RequirePermission permission="users"><Users /></RequirePermission></RequireAuth>} />
          <Route path="/" element={loading ? <LoadingScreen /> : <Navigate to={profile ? homePath(profile) : '/login'} replace />} />
          <Route path="*" element={loading ? <LoadingScreen /> : <Navigate to={profile ? homePath(profile) : '/login'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppShell />
      </Router>
    </AuthProvider>
  );
}