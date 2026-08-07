import React, { useState, useEffect } from 'react';
import { ShoppingCart, User, CheckCircle, Plus, Minus, Search } from 'lucide-react';
import { createSale, fetchProducts, resolveMediaUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function EmployeePOS() {
  const { profile } = useAuth();
  const [products, setProducts] = useState([]);
  const isAdmin = profile?.role === 'admin';
  const [cashiers, setCashiers] = useState(() => (isAdmin ? ['كاشير عام'] : ['مريم', 'فاطمة', 'عائشة']));
  const [selectedCashier, setSelectedCashier] = useState(() => (isAdmin ? 'كاشير عام' : 'مريم'));
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const data = await fetchProducts();
      const list = Array.isArray(data) ? data : [];
      setProducts(list.map(p => ({
        ...p,
        price: p.price ?? p.unit_price ?? 0,
        stock: p.stock ?? p.stock_qty ?? 0,
      })));
    } catch (error) {
      console.error(error);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty < product.stock) {
        setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
      } else {
        alert('تنبيه: الكمية المطلوبة غير متوفرة بالكامل في المخزون!');
      }
    } else {
      if (product.stock <= 0) {
        alert('هذا المنتج غير متوفر في المخزون');
        return;
      }
      setCart([...cart, { ...product, qty: 1 }]);
    }
  };

  const updateQty = (id, delta) => {
    setCart(cart.map(item => {
      if (item.id === id) {
        const newQty = item.qty + delta;
        return newQty > 0 ? { ...item, qty: newQty } : item;
      }
      return item;
    }));
  };

  const calculateTotal = () => cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setLoading(true);

    try {
      await createSale({
        cashier_name: selectedCashier,
        items: cart.map(item => ({ id: item.id, qty: item.qty, price: item.price })),
      });
      setCart([]);
      setSuccess(true);
      loadProducts();
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error(error);
      alert('تعذر إتمام البيع. يرجى المحاولة مرة أخرى.');
    }
    setLoading(false);
  };

  const filteredProducts = products.filter(p => p.name.includes(search));

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4 sm:gap-6 font-sans text-right dir-rtl">
      <div className="space-y-4 w-full">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 sm:p-4 rounded-2xl shadow-sm">
          <h1 className="text-lg sm:text-xl font-black">Rushdy Mart</h1>
          <p className="text-sm opacity-90">واجهة البيع السريعة والعملية</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <User className="text-blue-600" size={20} />
            <h2 className="font-black text-sm sm:text-base">الموظف الحالي</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cashiers.map(c => (
              <button
                key={c}
                onClick={() => setSelectedCashier(c)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${selectedCashier === c ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="ابحث عن منتج بالاسم..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full p-3 pl-10 border rounded-2xl bg-white shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search size={18} className="absolute top-1/2 -translate-y-1/2 left-3 text-slate-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredProducts.length === 0 ? (
            <div className="col-span-full text-center py-8 text-slate-400 text-sm">لا توجد منتجات مطابقة</div>
          ) : filteredProducts.map(p => (
            <div
              key={p.id}
              onClick={() => addToCart(p)}
              className="p-3 sm:p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md cursor-pointer transition flex flex-col justify-between min-h-[150px]"
            >
              {p.image_url && <img src={resolveMediaUrl(p.image_url)} alt={p.name} className="w-full h-20 object-cover rounded-xl mb-2" />}
              <div>
                <h3 className="font-bold text-slate-800 text-sm">{p.name}</h3>
                <p className={`text-xs mt-1 ${p.stock < 10 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>المتبقي: {p.stock}</p>
              </div>
              <p className="text-base font-black text-blue-600 mt-2">{p.price} ج.م</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-4 sm:p-5 rounded-2xl border shadow-sm flex flex-col justify-between w-full h-auto lg:h-[620px]">
        <div>
          <h2 className="font-black text-base sm:text-lg mb-3 flex items-center gap-2 border-b pb-3">
            <ShoppingCart className="text-blue-600" /> السلة الحالية
          </h2>

          <div className="space-y-3 overflow-y-auto max-h-[320px] sm:max-h-[360px] pl-1">
            {cart.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">السلة فارغة. اختر منتجاً لإضافته.</div>
            ) : cart.map(item => (
              <div key={item.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 bg-slate-50 rounded-xl text-sm">
                <div>
                  <p className="font-bold text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.price} ج.م</p>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button onClick={() => updateQty(item.id, -1)} className="p-1 bg-white border rounded-lg hover:bg-slate-100"><Minus size={14} /></button>
                  <span className="font-bold">{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="p-1 bg-white border rounded-lg hover:bg-slate-100"><Plus size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <div className="flex justify-between items-center text-base sm:text-lg font-black mb-4">
            <span>الإجمالي:</span>
            <span className="text-blue-600">{calculateTotal()} ج.م</span>
          </div>

          {success && (
            <div className="p-3 mb-3 bg-green-100 text-green-700 rounded-xl text-xs font-bold flex items-center gap-2">
              <CheckCircle size={16} /> تم إتمام البيع وتحديث المخزون بنجاح!
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading || cart.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50"
          >
            {loading ? 'جاري التسجيل...' : 'إتمام البيع وإصدار الفاتورة'}
          </button>
        </div>
      </div>
    </div>
  );
}