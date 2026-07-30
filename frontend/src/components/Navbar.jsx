import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Store, LayoutDashboard, PackageSearch, LogOut } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const role = localStorage.getItem('user_role') || 'cashier';

  const handleLogout = () => {
    localStorage.removeItem('user_role');
    navigate('/login');
  };

  return (
    <nav className="bg-white border-b px-6 py-3.5 flex justify-between items-center shadow-sm font-sans dir-rtl">
      <div className="flex items-center gap-2 text-xl font-black text-blue-600">
        <Store size={26} /> سوبرماركت الذكاء الاصطناعي
      </div>

      <div className="flex items-center gap-2">
        <Link to="/" className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 px-3 py-2 rounded-xl hover:bg-slate-50">
          <Store size={18} /> الكاشير (POS)
        </Link>

        {/* الميزات دي بتظهر فقط للـ Admin */}
        {role === 'admin' && (
          <>
            <Link to="/inventory" className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 px-3 py-2 rounded-xl hover:bg-slate-50">
              <PackageSearch size={18} /> المخزون والصور
            </Link>
            <Link to="/admin" className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 px-3 py-2 rounded-xl hover:bg-slate-50">
              <LayoutDashboard size={18} /> الداشبورد والتقرير
            </Link>
          </>
        )}

        <button onClick={handleLogout} className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition mr-2" title="تسجيل الخروج">
          <LogOut size={20} />
        </button>
      </div>
    </nav>
  );
}
