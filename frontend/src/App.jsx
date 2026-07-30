import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import EmployeePOS from './pages/EmployeePOS';
import AdminDash from './pages/AdminDash';
import Inventory from './pages/Inventory';
import Login from './pages/Login';

const AdminRoute = ({ children }) => {
  const role = localStorage.getItem('user_role');
  return role === 'admin' ? children : <Navigate to="/" />;
};

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        <Navbar />
        <main>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<EmployeePOS />} />
            <Route path="/inventory" element={<AdminRoute><Inventory /></AdminRoute>} />
            <Route path="/admin" element={<AdminRoute><AdminDash /></AdminRoute>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}