import React, { useState, useEffect } from 'react';
import { Users as UsersIcon, UserPlus, ShieldCheck, ToggleLeft, ToggleRight, X, Save } from 'lucide-react';
import { fetchUsers, createUser, updateUser } from '../services/api';

const PERMISSION_LABELS = {
  pos: 'البيع (POS)',
  inventory: 'المخزون',
  reports: 'التقارير',
  users: 'إدارة المستخدمين',
};

const DEFAULT_PERMISSIONS = ['pos'];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editRole, setEditRole] = useState('employee');
  const [editPermissions, setEditPermissions] = useState(DEFAULT_PERMISSIONS);
  const [saving, setSaving] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await fetchUsers();
      setUsers(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(e.message || 'تعذر تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const togglePermission = (perm) => {
    setEditPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setCreating(true);
    setError('');
    try {
      await createUser({ email: email.trim(), password });
      setEmail('');
      setPassword('');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'تعذر إنشاء المستخدم');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user) => {
    setError('');
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'تعذر تغيير حالة المستخدم');
    }
  };

  const openEdit = (user) => {
    setEditing(user);
    setEditRole(user.role === 'admin' ? 'admin' : 'employee');
    setEditPermissions(Array.isArray(user.permissions) ? user.permissions : DEFAULT_PERMISSIONS);
    setError('');
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await updateUser(editing.id, { role: editRole, permissions: editPermissions });
      setEditing(null);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'تعذر حفظ التعديلات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 font-sans text-right dir-rtl" dir="rtl">
      <div className="flex items-center gap-2">
        <UsersIcon className="text-blue-600" size={26} />
        <h1 className="text-xl sm:text-2xl font-black text-slate-800">Rushdy Mart | إدارة المستخدمين</h1>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 font-semibold">
          {error}
        </div>
      )}

      <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-100 shadow-sm">
        <h2 className="font-black text-base mb-4 flex items-center gap-2 border-b pb-3">
          <UserPlus className="text-green-600" size={20} /> إنشاء موظف جديد
        </h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="email"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            type="password"
            placeholder="كلمة المرور (6 أحرف على الأقل)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={creating || !email.trim() || !password}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm py-3 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            <UserPlus size={16} /> {creating ? 'جاري الإنشاء...' : 'إنشاء الموظف'}
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          يتم إنشاء الحساب كموظف (Employee) بصلاحية {PERMISSION_LABELS[DEFAULT_PERMISSIONS[0]]} فقط افتراضياً.
        </p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b bg-slate-50">
          <ShieldCheck className="text-blue-600" size={18} />
          <h2 className="font-black text-sm">قائمة المستخدمين</h2>
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">جاري التحميل...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">لا يوجد مستخدمون بعد</div>
        ) : (
          <div className="w-full overflow-x-auto hidden md:block">
            <table className="w-full min-w-[720px] text-right border-collapse">
              <thead className="bg-slate-50 text-slate-600 text-sm border-b">
                <tr>
                  <th className="p-4">البريد الإلكتروني</th>
                  <th className="p-4">الدور</th>
                  <th className="p-4">الصلاحيات</th>
                  <th className="p-4">الحالة</th>
                  <th className="p-4">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50 transition">
                    <td className="p-4 font-bold text-slate-800">
                      {user.email}
                      {user.is_self && <span className="text-xs text-blue-600 mr-1">(أنت)</span>}
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                        {user.role === 'admin' ? 'مدير' : 'موظف'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {(user.permissions || []).map(perm => (
                          <span key={perm} className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg">
                            {PERMISSION_LABELS[perm] || perm}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {user.is_active ? 'نشط' : 'معطّل'}
                      </span>
                    </td>
                    <td className="p-4 flex items-center gap-2">
                      <button
                        onClick={() => openEdit(user)}
                        className="text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition"
                        title="تعديل الصلاحيات"
                      >
                        <ShieldCheck size={18} />
                      </button>
                      {!user.is_self && (
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={`p-2 rounded-xl transition ${user.is_active ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                          title={user.is_active ? 'تعطيل' : 'تفعيل'}
                        >
                          {user.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-3 p-3 md:hidden">
          {!loading && users.map(user => (
            <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">{user.email} {user.is_self && <span className="text-xs text-blue-600">(أنت)</span>}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                      {user.role === 'admin' ? 'مدير' : 'موظف'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {user.is_active ? 'نشط' : 'معطل'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(user)} className="text-blue-600 p-2 rounded-xl hover:bg-blue-100"><ShieldCheck size={18} /></button>
                  {!user.is_self && (
                    <button onClick={() => handleToggleActive(user)} className={`p-2 rounded-xl ${user.is_active ? 'text-red-500' : 'text-green-600'}`}>
                      {user.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-200">
                <div>
                  <span className="font-semibold text-slate-700">الصلاحيات:</span>{' '}
                  {(user.permissions || []).length === 0
                    ? '—'
                    : user.permissions.map(perm => PERMISSION_LABELS[perm] || perm).join('، ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">تعديل صلاحيات: {editing.email}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">الدور</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditRole('employee')}
                  className={`p-3 rounded-xl text-sm font-bold border transition ${editRole === 'employee' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                >
                  موظف
                </button>
                <button
                  type="button"
                  onClick={() => setEditRole('admin')}
                  className={`p-3 rounded-xl text-sm font-bold border transition ${editRole === 'admin' ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                >
                  مدير
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">الصلاحيات</label>
              <div className="space-y-2">
                {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                  <label key={key} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${editPermissions.includes(key) ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'}`}>
                    <span className="text-sm font-semibold text-slate-700">{label}</span>
                    <input
                      type="checkbox"
                      checked={editPermissions.includes(key)}
                      onChange={() => togglePermission(key)}
                      className="w-5 h-5 accent-blue-600"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save size={18} /> {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}