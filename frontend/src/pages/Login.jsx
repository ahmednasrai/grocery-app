import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, UserCheck, Store } from 'lucide-react';

export default function Login() {
  const [role, setRole] = useState('cashier');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const savedRole = localStorage.getItem('rushdy_mart_role');
    const savedPassword = localStorage.getItem('rushdy_mart_password');

    if (savedRole && savedPassword) {
      localStorage.setItem('rushdy_mart_login', 'true');
      localStorage.setItem('user_role', savedRole);
      navigate(savedRole === 'admin' ? '/inventory' : '/pos', { replace: true });
    }
  }, [navigate]);

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!password.trim()) {
      setError('يرجى إدخال كلمة المرور');
      setLoading(false);
      return;
    }

    const finalRole = role === 'admin' ? 'admin' : 'employee';

    localStorage.setItem('rushdy_mart_login', 'true');
    localStorage.setItem('rushdy_mart_role', finalRole);
    localStorage.setItem('rushdy_mart_password', password);
    localStorage.setItem('user_role', finalRole);

    navigate(finalRole === 'admin' ? '/inventory' : '/pos', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-right dir-rtl">
      <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-4 bg-blue-100 text-blue-600 rounded-2xl mb-2">
            <Store size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800">Rushdy Mart</h1>
          <p className="text-slate-500 text-sm">اختر نوع الحساب لتسجيل الدخول</p>
        </div>

        <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 rounded-2xl">
          <button
            type="button"
            onClick={() => setRole('cashier')}
            className={`py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${role === 'cashier' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            <UserCheck size={18} /> موظف / كاشير
          </button>
          <button
            type="button"
            onClick={() => setRole('admin')}
            className={`py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${role === 'admin' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            <ShieldCheck size={18} /> مدير المحل
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">كلمة المرور:</label>
            <input
              type="password"
              placeholder="أدخل كلمة المرور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-center font-bold"
              required
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition shadow-lg shadow-blue-200 disabled:opacity-50">
            {loading ? 'جاري الدخول...' : 'الدخول للنظام'}
          </button>
        </form>
      </div>
    </div>
  );
}