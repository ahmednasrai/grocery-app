import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Store, LayoutDashboard, PackageSearch, Users as UsersIcon, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const navigate = useNavigate();
  const { profile, hasPermission, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    `flex items-center justify-center gap-1.5 text-[11px] sm:text-sm font-bold px-2.5 sm:px-3 py-2 rounded-xl transition ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-700 hover:text-blue-600 hover:bg-slate-50'
    }`;

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="bg-white border-b px-3 sm:px-6 py-3 shadow-sm font-sans dir-rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-lg sm:text-xl font-black text-blue-600">
          <Store size={22} className="sm:w-[26px] sm:h-[26px]" />
          <span>Rushdy Mart</span>
          {profile && (
            <span className="text-[10px] sm:text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {profile.role === 'admin' ? 'مدير' : 'موظف'}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen(prev => !prev)}
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-700 sm:hidden"
          aria-label="Open navigation menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <div className={`${menuOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row sm:items-center gap-2 mt-3 sm:mt-0`}>
        <NavLink to="/pos" className={linkClass} onClick={closeMenu}>
          <Store size={16} /> الكاشير (POS)
        </NavLink>

        {hasPermission('inventory') && (
          <NavLink to="/inventory" className={linkClass} onClick={closeMenu}>
            <PackageSearch size={16} /> المخزون
          </NavLink>
        )}

        {hasPermission('reports') && (
          <NavLink to="/admin" className={linkClass} onClick={closeMenu}>
            <LayoutDashboard size={16} /> الداشبورد والتقرير
          </NavLink>
        )}

        {hasPermission('users') && (
          <NavLink to="/users" className={linkClass} onClick={closeMenu}>
            <UsersIcon size={16} /> المستخدمون
          </NavLink>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-1.5 text-[11px] sm:text-sm font-bold text-red-500 hover:bg-red-50 px-2.5 sm:px-3 py-2 rounded-xl transition"
          title="تسجيل الخروج"
        >
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </div>
    </nav>
  );
}