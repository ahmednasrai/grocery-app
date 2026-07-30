import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Store, LayoutDashboard, PackageSearch, LogOut } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const role = localStorage.getItem('user_role') || 'cashier';

  const handleLogout = () => {
    localStorage.removeItem('rushdy_mart_login');
    localStorage.removeItem('rushdy_mart_role');
    localStorage.removeItem('rushdy_mart_password');
    localStorage.removeItem('user_role');
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-1.5 text-sm font-bold px-3 py-2 rounded-xl transition ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
    }`;

  return (
    <nav className="bg-white border-b px-6 py-3.5 flex justify-between items-center shadow-sm font-sans dir-rtl">
      <div className="flex items-center gap-2 text-xl font-black text-blue-600">
        <Store size={26} /> Rushdy Mart
      </div>

      <div className="flex items-center gap-2">
        <NavLink to="/pos" className={linkClass}>
          <Store size={18} /> الكاشير (POS)
        </NavLink>

        {role === 'admin' && (
          <>
            <NavLink to="/inventory" className={linkClass}>
              <PackageSearch size={18} /> المخزون
            </NavLink>
            <NavLink to="/admin" className={linkClass}>
              <LayoutDashboard size={18} /> الداشبورد والتقرير
            </NavLink>
          </>
        )}

        <button onClick={handleLogout} className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition mr-2" title="تسجيل الخروج">
          <LogOut size={20} />
        </button>
      </div>
    </nav>
  );
}
