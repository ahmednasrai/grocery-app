import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import EmployeePOS from './pages/EmployeePOS';
import AdminDash from './pages/AdminDash';
import Inventory from './pages/Inventory';
import { Store, LayoutDashboard, PackageSearch } from 'lucide-react';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100 text-gray-900 font-sans dir-rtl">
        {/* شريط الملاحة العلوي */}
        <nav className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-2 text-xl font-black text-blue-600">
            <Store size={28} /> نظام السوبرماركت الذكي
          </div>
          <div className="flex gap-4">
            <Link to="/" className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-blue-600 p-2 rounded-lg">
              <Store size={18} /> الكاشير (POS)
            </Link>
            <Link to="/inventory" className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-blue-600 p-2 rounded-lg">
              <PackageSearch size={18} /> المخزون
            </Link>
            <Link to="/admin" className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-blue-600 p-2 rounded-lg">
              <LayoutDashboard size={18} /> الداشبورد
            </Link>
          </div>
        </nav>

        {/* مسارات الصفحات */}
        <main className="py-4">
          <Routes>
            <Route path="/" element={<EmployeePOS />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/admin" element={<AdminDash />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
