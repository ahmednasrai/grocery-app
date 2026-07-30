import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import EmployeePOS from './pages/EmployeePOS';
import AdminDash from './pages/AdminDash';
import Inventory from './pages/Inventory';
import Login from './pages/Login';

const getStoredRole = () => localStorage.getItem('rushdy_mart_role');
const isAuthenticated = () => localStorage.getItem('rushdy_mart_login') === 'true';

const AuthRoute = ({ children }) => {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
};

const EmployeeRoute = ({ children }) => {
  const role = getStoredRole();
  return role === 'employee' ? children : <Navigate to="/inventory" replace />;
};

const AdminRoute = ({ children }) => {
  const role = getStoredRole();
  return role === 'admin' ? children : <Navigate to="/pos" replace />;
};

const PublicRoute = ({ children }) => {
  return isAuthenticated() ? <Navigate to={getStoredRole() === 'admin' ? '/inventory' : '/pos'} replace /> : children;
};

function AppShell() {
  const location = useLocation();
  const hideNavbar = location.pathname === '/login';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans" dir="rtl">
      {!hideNavbar && <Navbar />}
      <main>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/pos" element={<AuthRoute><EmployeePOS /></AuthRoute>} />
          <Route path="/inventory" element={<AuthRoute><AdminRoute><Inventory /></AdminRoute></AuthRoute>} />
          <Route path="/admin" element={<AuthRoute><AdminRoute><AdminDash /></AdminRoute></AuthRoute>} />
          <Route path="/" element={<Navigate to={isAuthenticated() ? (getStoredRole() === 'admin' ? '/inventory' : '/pos') : '/login'} replace />} />
          <Route path="*" element={<Navigate to={isAuthenticated() ? (getStoredRole() === 'admin' ? '/inventory' : '/pos') : '/login'} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppShell />
    </Router>
  );
}