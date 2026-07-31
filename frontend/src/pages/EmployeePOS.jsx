import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, User, CheckCircle, Plus, Minus, Camera, X, ScanLine } from 'lucide-react';
import { createSale, fetchProducts, identifyProduct, resolveMediaUrl } from '../services/api';

export default function EmployeePOS() {
  const [products, setProducts] = useState([]);
  const [cashiers, setCashiers] = useState(() => {
    const role = localStorage.getItem('user_role') || 'employee';
    return role === 'admin' ? ['كاشير عام'] : ['مريم', 'فاطمة', 'عائشة'];
  });
  const [selectedCashier, setSelectedCashier] = useState(() => {
    const role = localStorage.getItem('user_role') || 'employee';
    return role === 'admin' ? 'كاشير عام' : 'مريم';
  });
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState('');

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    loadProducts();
    return () => stopCamera();
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

  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      setScanResult(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      alert('تعذر الوصول إلى الكاميرا. يرجى التأكد من إعطاء التصريح للمتصفح.');
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const identifyFromFile = async (file) => {
    setScanLoading(true);
    setScanResult(null);
    try {
      const result = await identifyProduct(file);
      if (result.matched && result.product) {
        const normalized = {
          ...result.product,
          price: result.product.price ?? result.product.unit_price ?? 0,
          stock: result.product.stock ?? result.product.stock_qty ?? 0,
        };
        setScanResult({
          product: normalized,
          confidence: result.confidence,
        });
      } else {
        alert(result.message || 'لم يتم التعرف على المنتج');
      }
    } catch (error) {
      alert(error.message || 'فشل التعرف على المنتج');
    } finally {
      setScanLoading(false);
    }
  };

  const captureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current || scanLoading) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!blob) return;

    const file = new File([blob], `pos_scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
    await identifyFromFile(file);
  };

  const handleScanFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await identifyFromFile(file);
    event.target.value = '';
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
      setScanResult(null);
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
            <ScanLine className="text-purple-600" size={20} />
            <h2 className="font-black text-sm sm:text-base">التعرف الذكي بالصورة</h2>
          </div>
          <p className="text-xs text-slate-500">
            صوّر المنتج في يدك أو ارفع صورته — النظام يطابقها مع صور التدريب ويعرض التفاصيل.
          </p>

          {!isCameraOpen ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={startCamera}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm"
              >
                <Camera size={18} /> فتح الكاميرا والتصوير
              </button>
              <label className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm cursor-pointer">
                <ScanLine size={18} /> رفع صورة من الجهاز
                <input type="file" accept="image/*" className="hidden" onChange={handleScanFileUpload} />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative w-full max-w-sm mx-auto overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} autoPlay playsInline className="w-full h-52 object-cover" />
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute top-2 left-2 bg-red-600 text-white p-1.5 rounded-full"
                >
                  <X size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={captureAndIdentify}
                disabled={scanLoading}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
              >
                {scanLoading ? 'جاري التعرف...' : 'التقاط والتعرف على المنتج'}
              </button>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          {scanResult && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex items-center gap-3">
                {scanResult.product.image_url && (
                  <img
                    src={resolveMediaUrl(scanResult.product.image_url)}
                    alt={scanResult.product.name}
                    className="w-16 h-16 rounded-xl object-cover border"
                  />
                )}
                <div>
                  <p className="font-black text-slate-800">{scanResult.product.name}</p>
                  <p className="text-blue-600 font-bold">{scanResult.product.price} ج.م</p>
                  <p className="text-xs text-slate-500">
                    متبقي: {scanResult.product.stock} • ثقة التعرف: {Math.round(scanResult.confidence * 100)}%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => addToCart(scanResult.product)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm whitespace-nowrap"
              >
                إضافة للسلة
              </button>
            </div>
          )}
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border shadow-sm w-full">
          <div className="flex flex-col gap-3 mb-3">
            <div className="flex items-center gap-2">
              <User className="text-blue-600" size={18} />
              <span className="font-bold text-sm">الموظف الحالي:</span>
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
          </div>

          <input
            type="text"
            placeholder="أو ابحث يدوياً عن منتج..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full p-3 border rounded-2xl bg-white shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredProducts.map(p => (
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
              <div className="text-center py-8 text-slate-400 text-sm">السلة فارغة. صوّر منتجاً أو اختره من القائمة.</div>
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
