import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, User, CheckCircle, Plus, Minus, Search, AlertCircle, Image as ImageIcon, XCircle } from 'lucide-react';
import { createSale, fetchProducts, resolveMediaUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { unitLabel, unitDetailText, sellOptions, availabilityText, priceFor, lineSubtotal, stockStatusBadge, containerCapacity, toBaseQty } from '../utils/units';
import LowStockAlert from '../components/LowStockAlert';

export default function EmployeePOS() {
  const { profile } = useAuth();
  const [products, setProducts] = useState([]);
  const isAdmin = profile?.role === 'admin';
  const [cashiers, setCashiers] = useState(() => (isAdmin ? ['كاشير عام'] : ['مريم', 'فاطمة', 'عائشة']));
  const [selectedCashier, setSelectedCashier] = useState(() => (isAdmin ? 'كاشير عام' : 'مريم'));
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [unitModal, setUnitModal] = useState(null); // { product, unit, qty }
  const checkoutKeyRef = useRef(null);
  const submittingRef = useRef(false);

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
        unit_price: p.unit_price ?? p.price ?? 0,
        stock: p.stock ?? p.stock_qty ?? 0,
        stock_qty: p.stock_qty ?? p.stock ?? 0,
        unit_type: p.unit_type || 'piece',
      })));
    } catch (error) {
      console.error(error);
    }
  };

  // Multi-unit products (carton/sack) and weight/liquid products (kg/liter,
  // sold also in grams/ml) open a unit picker; piece products add directly.
  const handleProductClick = (product) => {
    if (product.unit_type !== 'piece') {
      setUnitModal({ product, unit: product.unit_type, qty: 1 });
    } else {
      addToCart(product);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (product.stock > 0) {
        setCart(cart.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
      } else {
        alert('هذا المنتج غير متوفر في المخزون');
      }
    } else {
      if (product.stock <= 0) {
        alert('هذا المنتج غير متوفر في المخزون');
        return;
      }
      setCart([...cart, { ...product, qty: 1, selling_unit: product.unit_type }]);
    }
  };

  const addFromModal = () => {
    const { product, unit, qty } = unitModal;
    const capacity = containerCapacity(product, unit);
    if (qty <= 0) {
      setErrorMsg('الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    if (qty * capacity > product.stock) {
      setErrorMsg('تنبيه: الكمية المطلوبة غير متوفرة بالكامل في المخزون!');
      return;
    }
    setErrorMsg('');
    const existing = cart.find(item => item.id === product.id && item.selling_unit === unit);
    if (existing) {
      setCart(cart.map(item => item.id === product.id && item.selling_unit === unit ? { ...item, qty: item.qty + qty } : item));
    } else {
      setCart([...cart, { ...product, qty, selling_unit: unit }]);
    }
    setUnitModal(null);
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

  const calculateTotal = () => cart.reduce((sum, item) => sum + lineSubtotal(item, item.qty, item.selling_unit), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (submittingRef.current) return;      // guard against double submission
    submittingRef.current = true;
    setLoading(true);
    setErrorMsg('');
    setSuccess(false);

    // Idempotency key: one per checkout attempt. If the first request actually
    // persisted before a network error, retrying with the same key returns the
    // SAME sale instead of creating a second invoice / deducting twice.
    if (!checkoutKeyRef.current) checkoutKeyRef.current = crypto.randomUUID();

    try {
      const sale = await createSale({
        cashier_name: selectedCashier,
        client_request_id: checkoutKeyRef.current,
        items: cart.map(item => ({ id: item.id, qty: item.qty, selling_unit: item.selling_unit })),
      });
      setCart([]);
      setSuccess(true);
      checkoutKeyRef.current = null;
      // تحديث محلي للمخزون بدلاً من إعادة جلب القائمة كاملة — بدون انتظار الشبكة
      const sold = sale?.items || [];
      setProducts(prev => prev.map(p => {
        const line = sold.find(it => it.id === p.id);
        if (!line) return p;
        const base = toBaseQty(p, line.selling_unit, Number(line.qty));
        return {
          ...p,
          stock: Math.max(0, (p.stock ?? 0) - base),
          stock_qty: Math.max(0, (p.stock_qty ?? p.stock ?? 0) - base),
        };
      }));
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || 'حدث خطأ أثناء تسجيل البيع، ولم يتم خصم أي كمية.');
      // Cart is intentionally NOT cleared on failure.
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => (p.is_active !== false) && p.name.includes(search));

  return (
    <div className="p-3 sm:p-4 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4 sm:gap-6 font-sans text-right dir-rtl">
      <div className="space-y-4 w-full">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 sm:p-4 rounded-2xl shadow-sm">
          <h1 className="text-lg sm:text-xl font-black">Rushdy Mart</h1>
          <p className="text-sm opacity-90">واجهة البيع السريعة والعملية</p>
        </div>

        <LowStockAlert defaultExpanded={false} />

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
              onClick={() => handleProductClick(p)}
              className="p-3 sm:p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md cursor-pointer transition flex flex-col justify-between min-h-[150px]"
            >
              {p.image_url ? (
                <img src={resolveMediaUrl(p.image_url)} alt={p.name} loading="lazy" className="w-full h-20 object-cover rounded-xl mb-2" />
              ) : (
                <div className="w-full h-20 mb-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center">
                  <ImageIcon size={26} className="text-slate-300" />
                </div>
              )}
              <div>
                <h3 className="font-bold text-slate-800 text-sm">{p.name}</h3>
                {unitDetailText(p) && (
                  <p className="text-xs text-slate-400 mt-0.5">{unitDetailText(p)}</p>
                )}
                <p className={`text-xs mt-1 ${p.stock_status === 'out' ? 'text-red-600 font-black' : p.stock_status === 'low' ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                  المتاح: {availabilityText(p)}
                </p>
                {(p.stock_status === 'low' || p.stock_status === 'out') && (
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-black ${p.stock_status === 'out' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    {stockStatusBadge(p.stock_status)}
                  </span>
                )}
              </div>
              <p className="text-base font-black text-blue-600 mt-2">
                {p.price} ج.م / {unitLabel(p.unit_type)}
              </p>
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
              <div key={`${item.id}-${item.selling_unit}`} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 bg-slate-50 rounded-xl text-sm">
                <div>
                  <p className="font-bold text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {unitLabel(item.selling_unit)} — {priceFor(item, item.selling_unit)} ج.م
                  </p>
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
              <CheckCircle size={16} /> تم تسجيل البيع بنجاح وتحديث المخزون
            </div>
          )}

          {errorMsg && (
            <div className="p-3 mb-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} /> {errorMsg}
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

      {unitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setUnitModal(null)}>
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-base">{unitModal.product.name}</h3>
              <button onClick={() => setUnitModal(null)} className="text-slate-400 hover:text-slate-600"><XCircle size={20} /></button>
            </div>

            <h4 className="text-xs font-bold text-slate-500 mb-2">اختر وحدة البيع:</h4>
            <div className="space-y-2 mb-4">
              {sellOptions(unitModal.product).map(opt => (
                <button
                  key={opt.unit}
                  onClick={() => setUnitModal({ ...unitModal, unit: opt.unit })}
                  className={`w-full flex justify-between items-center p-3 rounded-xl border text-sm font-bold transition ${unitModal.unit === opt.unit ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-slate-50 border-slate-200'}`}
                >
                  <span>{opt.label}</span>
                  <span className={unitModal.unit === opt.unit ? 'text-blue-600' : 'text-slate-500'}>{opt.price} ج.م</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-slate-500">الكمية:</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const step = unitModal.unit === 'kg' || unitModal.unit === 'liter' ? 0.25 : 1;
                    setUnitModal(m => ({ ...m, qty: Math.max(step, Math.round((m.qty - step) * 100) / 100) }));
                  }}
                  className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200"
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  min="0"
                  step={unitModal.unit === 'kg' || unitModal.unit === 'liter' ? '0.01' : '1'}
                  value={unitModal.qty}
                  onChange={e => setUnitModal(m => ({ ...m, qty: parseFloat(e.target.value) || 0 }))}
                  className="font-black w-20 text-center border rounded-xl py-1.5 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    const step = unitModal.unit === 'kg' || unitModal.unit === 'liter' ? 0.25 : 1;
                    setUnitModal(m => ({ ...m, qty: Math.round((m.qty + step) * 100) / 100 }));
                  }}
                  className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 mb-4 bg-slate-50 rounded-xl p-2.5">
              <span>
                = {lineSubtotal(unitModal.product, unitModal.qty, unitModal.unit)} ج.م
              </span>
              <span>
                {unitModal.unit === 'g' || unitModal.unit === 'ml'
                  ? `${unitModal.qty} ${unitLabel(unitModal.unit)} ≈ ${toBaseQty(unitModal.product, unitModal.unit, unitModal.qty)} ${unitLabel(unitModal.product.unit_type)}`
                  : null}
                {' '}المتوفر: {availabilityText(unitModal.product)}
              </span>
            </div>

            <button onClick={addFromModal} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition">
              إضافة {unitModal.qty} {unitLabel(unitModal.unit)} إلى السلة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}