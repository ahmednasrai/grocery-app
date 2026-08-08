import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Store, LayoutDashboard, PackageSearch, Users as UsersIcon, LogOut, Menu, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLowStockProducts } from './LowStockAlert';

export default function Navbar() {
  const navigate = useNavigate();
  const { profile, hasPermission, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const { lowStock } = useLowStockProducts();
  const lowStockCount = lowStock.length;
  const canViewInventory = hasPermission('inventory');

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
          <img src="/favicon.svg" alt="Rushdy Mart" className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg" />
          <span>Rushdy Mart</span>
          {profile && (
            <span className="text-[10px] sm:text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {profile.role === 'admin' ? 'مدير' : 'موظف'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lowStockCount > 0 && (canViewInventory ? (
            <NavLink
              to="/inventory"
              title={`تنبيه: ${lowStockCount} منتج أوشك على النفاد — انقر للذهاب إلى المخزون`}
              className="relative inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100 transition"
            >
              <AlertTriangle size={18} className="animate-pulse" />
              <span className="absolute -top-1.5 -left-1.5 bg-red-600 text-white text-[9px] font-black min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center">
                {lowStockCount}
              </span>
            </NavLink>
          ) : (
            <div
              title={`تنبيه: ${lowStockCount} منتج أوشك على النفاد`}
              className="relative inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-red-600"
            >
              <AlertTriangle size={18} className="animate-pulse" />
              <span className="absolute -top-1.5 -left-1.5 bg-red-600 text-white text-[9px] font-black min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center">
                {lowStockCount}
              </span>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setMenuOpen(prev => !prev)}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-700 sm:hidden"
            aria-label="Open navigation menu"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
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