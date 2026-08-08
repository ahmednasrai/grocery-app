import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import { AuthProvider, useAuth } from './context/AuthContext';

// Lazy-loaded pages: يتم تحميل كل صفحة فقط عند فتحها (chunk أصغر للتحميل الأولي)
const EmployeePOS = lazy(() => import('./pages/EmployeePOS'));
const AdminDash = lazy(() => import('./pages/AdminDash'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Users = lazy(() => import('./pages/Users'));
const Login = lazy(() => import('./pages/Login'));

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
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/pos" element={<RequireAuth><RequirePermission permission="pos"><EmployeePOS /></RequirePermission></RequireAuth>} />
          <Route path="/inventory" element={<RequireAuth><RequirePermission permission="inventory"><Inventory /></RequirePermission></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><RequirePermission permission="reports"><AdminDash /></RequirePermission></RequireAuth>} />
          <Route path="/users" element={<RequireAuth><RequirePermission permission="users"><Users /></RequirePermission></RequireAuth>} />
          <Route path="/" element={loading ? <LoadingScreen /> : <Navigate to={profile ? homePath(profile) : '/login'} replace />} />
          <Route path="*" element={loading ? <LoadingScreen /> : <Navigate to={profile ? homePath(profile) : '/login'} replace />} />
        </Routes>
        </Suspense>
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