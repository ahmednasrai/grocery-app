import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import CameraScanner from '../components/CameraScanner';
import { ShoppingCart, User, CheckCircle, Trash2, Camera, Plus, Minus } from 'lucide-react';

export default function EmployeePOS() {
  const [products, setProducts] = useState([]);
  const [cashiers, setCashiers] = useState(['مريم', 'فاطمة', 'عائشة', 'كاشير عام']);
  const [selectedCashier, setSelectedCashier] = useState('مريم');
  const [cart, setCart] = useState([]);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*');
    if (data) setProducts(data);
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty < product.stock) {
        setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
      } else {
        alert("تنبيه: الكمية المطلوبة غير متوفرة بالكامل في المخزون!");
      }
    } else {
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
    const total = calculateTotal();

    // 1. تسجيل الفاتورة
    const { error: saleError } = await supabase.from('sales').insert([
      { cashier_name: selectedCashier, total_amount: total, created_at: new Date() }
    ]);

    if (!saleError) {
      // 2. تحديث المخزون بتنقيص الكميات
      for (let item of cart) {
        await supabase.from('products').update({ stock: item.stock - item.qty }).eq('id', item.id);
      }
      setCart([]);
      setSuccess(true);
      fetchProducts();
      setTimeout(() => setSuccess(false), 3000);
    }
    setLoading(false);
  };

  const handleAIScanResult = (detectedProducts) => {
    setShowCamera(false);
    if (detectedProducts.length > 0) {
      const detectedName = detectedProducts[0].name;
      const matched = products.find(p => p.name.toLowerCase().includes(detectedName.toLowerCase()));
      if (matched) {
        addToCart(matched);
      } else {
        alert(`تم التعرف على (${detectedName}) ولكن غير مضاف بالمخزن!`);
      }
    }
  };

  const filteredProducts = products.filter(p => p.name.includes(search));

  return (
    <div className="p-4 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 font-sans text-right dir-rtl">
      {/* قسم المنتجات والكاميرا */}
      <div className="md:col-span-2 space-y-4">
        {/* اختيار الموظف والبحث */}
        <div className="bg-white p-4 rounded-2xl border shadow-sm flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="text-blue-600" size={20} />
            <span className="font-bold text-sm">الموظفة الحالية:</span>
            <div className="flex gap-1.5">
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
          </div>

          <button
            onClick={() => setShowCamera(!showCamera)}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
          >
            <Camera size={16} /> {showCamera ? "إغلاق الكاميرا" : "فحص منتج بالذكاء الاصطناعي"}
          </button>
        </div>

        {showCamera && (
          <div className="mb-4">
            <CameraScanner onScanSuccess={handleAIScanResult} />
          </div>
        )}

        <input
          type="text"
          placeholder="إبحث عن منتج بالاسم..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full p-3.5 border rounded-2xl bg-white shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* كروت المنتجات */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {filteredProducts.map(p => (
            <div
              key={p.id}
              onClick={() => addToCart(p)}
              className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md cursor-pointer transition flex flex-col justify-between"
            >
              {p.image_url && <img src={p.image_url} alt={p.name} className="w-full h-24 object-cover rounded-xl mb-2" />}
              <div>
                <h3 className="font-bold text-slate-800 text-sm">{p.name}</h3>
                <p className={`text-xs mt-1 ${p.stock < 10 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>المتبقي: {p.stock}</p>
              </div>
              <p className="text-base font-black text-blue-600 mt-2">{p.price} ج.م</p>
            </div>
          ))}
        </div>
      </div>

      {/* قسم الفاتورة */}
      <div className="bg-white p-5 rounded-2xl border shadow-sm flex flex-col justify-between h-[580px]">
        <div>
          <h2 className="font-black text-lg mb-4 flex items-center gap-2 border-b pb-3">
            <ShoppingCart className="text-blue-600" /> الفاتورة الحالية ({selectedCashier})
          </h2>

          <div className="space-y-3 overflow-y-auto max-h-[360px] pl-1">
            {cart.map(item => (
              <div key={item.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl text-sm">
                <div>
                  <p className="font-bold text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.price} ج.م</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.id, -1)} className="p-1 bg-white border rounded-lg hover:bg-slate-100"><Minus size={14} /></button>
                  <span className="font-bold">{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="p-1 bg-white border rounded-lg hover:bg-slate-100"><Plus size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-between items-center text-lg font-black mb-4">
            <span>الإجمالي:</span>
            <span className="text-blue-600">{calculateTotal()} ج.م</span>
          </div>

          {success && (
            <div className="p-3 mb-3 bg-green-100 text-green-700 rounded-xl text-xs font-bold flex items-center gap-2">
              <CheckCircle size={16} /> تم الدفع وتحديث المخزون بنجاح!
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading || cart.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50"
          >
            {loading ? "جاري التسجيل..." : "إتمام البيع واصدار الفاتورة"}
          </button>
        </div>
      </div>
    </div>
  );
}
