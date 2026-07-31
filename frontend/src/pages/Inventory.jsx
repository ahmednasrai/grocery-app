import React, { useState, useEffect, useRef } from 'react';
import { createProduct, deleteProduct, fetchProducts, scanImage } from '../services/api';
import { 
  Plus, 
  Trash2, 
  Package, 
  UploadCloud, 
  Image as ImageIcon, 
  CheckCircle2, 
  Camera, 
  X, 
  RotateCcw 
} from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cartonPrice, setCartonPrice] = useState('');
  const [stock, setStock] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  // حالة التحكم بالكاميرا
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  useEffect(() => { 
    loadProducts(); 
    return () => {
      stopCamera();
    };
  }, []);

  const loadProducts = async () => {
    try {
      const res = await fetchProducts();
      // ضمان استقبال البيانات سواء جاءت كمصفوفة مباشرة أو بداخل data
      const list = Array.isArray(res) ? res : (res?.data || []);
      setProducts(list.sort((a, b) => a.id - b.id));
    } catch (error) {
      console.error("خطأ في جلب المنتجات:", error);
    }
  };

  // ---------------- الكاميرا ----------------
  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("خطأ في فتح الكاميرا:", err);
      alert("تعذر الوصول إلى الكاميرا. يرجى التأكد من إعطاء التصريح للمتصفح.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
          setSelectedFiles(prev => [...prev, file]);
        }
      }, 'image/jpeg', 0.85);
    }
  };

  // ---------------- رفع الملفات وإدارة المنتجات ----------------
  const handleFileChange = (e) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeSelectedFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadImages = async () => {
    const uploadedImages = [];
    const failedImages = [];

    for (const file of selectedFiles) {
      try {
        const result = await scanImage(file);
        uploadedImages.push(result.detected_products?.[0]?.label || file.name);
      } catch (error) {
        console.error('Upload error:', error);
        failedImages.push(error.message || 'فشل رفع الصورة');
      }
    }

    return { images: uploadedImages, failedImages };
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!name || !price || !stock || loading) return;
    setLoading(true);

    try {
      let images = [];
      let warningMessage = '';

      if (selectedFiles.length > 0) {
        const scanResult = await uploadImages();
        images = scanResult.images;
        if (scanResult.failedImages.length > 0) {
          warningMessage = `تمت إضافة المنتج، لكن بعض الصور لم تُرسل: ${scanResult.failedImages.join(' • ')}`;
        }
      }

      await createProduct({
        name,
        price: parseFloat(price),
        unit_price: parseFloat(price),
        carton_price: cartonPrice ? parseFloat(cartonPrice) : 0,
        stock: parseInt(stock, 10),
        stock_qty: parseInt(stock, 10),
        image_url: images[0] || null,
        ai_images: images,
      });

      setName('');
      setPrice('');
      setCartonPrice('');
      setStock('');
      setSelectedFiles([]);
      if (warningMessage) {
        alert(warningMessage);
      }
      await loadProducts();
    } catch (error) {
      console.error('Upload error:', error);
      alert(`تعذر إضافة المنتج: ${error.message || 'يرجى المحاولة مرة أخرى'}`);
    } finally {
      setLoading(false);
      stopCamera();
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm("هل أنت تأكد من رغبتك في حذف هذا المنتج؟")) return;

    try {
      await deleteProduct(id);
      // حذف من الـ State فورياً
      setProducts(prev => prev.filter(p => p.id !== id));
      await loadProducts();
    } catch (error) {
      console.error("خطأ أثناء الحذف:", error);
      alert(`فشل حذف المنتج: ${error.message || 'حاول مرة أخرى'}`);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 font-sans text-right dir-rtl" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> Rushdy Mart | المخزون
      </h1>

      <form onSubmit={handleAddProduct} className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" step="0.01" placeholder="سعر القطعة (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" step="0.01" placeholder="سعر الكرتونة (اختياري)" value={cartonPrice} onChange={e => setCartonPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="number" placeholder="الكمية المتوفرة" value={stock} onChange={e => setStock(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 cursor-pointer hover:bg-slate-100 transition relative">
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleFileChange} 
              id="file-upload" 
              className="hidden" 
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-1 text-slate-500 text-center">
              <UploadCloud size={28} className="text-blue-600" />
              <span className="text-sm font-bold text-slate-700">رفع صور من الجهاز</span>
              <span className="text-xs text-slate-400">PNG, JPG, WEBP</span>
            </label>
          </div>

          <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition">
            {!isCameraOpen ? (
              <button 
                type="button" 
                onClick={startCamera} 
                className="flex flex-col items-center gap-1 text-slate-500 w-full"
              >
                <Camera size={28} className="text-purple-600" />
                <span className="text-sm font-bold text-slate-700">فتح الكاميرا والتصوير المباشر</span>
                <span className="text-xs text-slate-400">التقط صوراً متعددة لتدريب الـ AI</span>
              </button>
            ) : (
              <div className="w-full flex flex-col items-center gap-2">
                <div className="relative w-full max-w-xs overflow-hidden rounded-xl bg-black">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-48 object-cover" />
                  <button 
                    type="button" 
                    onClick={stopCamera} 
                    className="absolute top-2 left-2 bg-red-600 text-white p-1 rounded-full hover:bg-red-700"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                  <button 
                    type="button" 
                    onClick={capturePhoto} 
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <Camera size={16} /> التقاط صورة
                  </button>
                  <button 
                    type="button" 
                    onClick={stopCamera} 
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-xl text-xs font-bold"
                  >
                    إغلاق الكاميرا
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {selectedFiles.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <CheckCircle2 size={16} className="text-green-600" />
                الصور الجاهزة للرفع ({selectedFiles.length})
              </span>
              <button 
                type="button" 
                onClick={() => setSelectedFiles([])} 
                className="text-xs text-red-500 hover:underline flex items-center gap-1"
              >
                <RotateCcw size={12} /> مسح الكل
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {selectedFiles.map((file, index) => (
                <div key={index} className="relative group w-16 h-16 rounded-lg overflow-hidden border bg-white shadow-sm">
                  <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                  <button 
                    type="button" 
                    onClick={() => removeSelectedFile(index)} 
                    className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 opacity-90 hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading || !name || !price || !stock}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3.5 rounded-xl flex items-center justify-center gap-2 text-sm transition disabled:opacity-50"
        >
          <Plus size={18} /> {loading ? 'جاري رفع الصور والتحميل...' : 'إضافة المنتج للمخزن وتسجيله'}
        </button>
      </form>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {/* العرض للشاشات الكبيرة (جدول) */}
        <div className="w-full overflow-x-auto hidden md:block">
          <table className="w-full min-w-[620px] text-right border-collapse">
            <thead className="bg-slate-50 text-slate-600 text-sm border-b">
              <tr>
                <th className="p-4">الصورة</th>
                <th className="p-4">اسم المنتج</th>
                <th className="p-4">سعر القطعة</th>
                <th className="p-4">سعر الكرتونة</th>
                <th className="p-4">الكمية</th>
                <th className="p-4">صور التدريب</th>
                <th className="p-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {products.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center p-6 text-slate-400">لا توجد منتجات مسجلة حالياً</td>
                </tr>
              ) : (
                products.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition">
                    <td className="p-4">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-12 h-12 object-cover rounded-xl border" />
                      ) : (
                        <ImageIcon size={28} className="text-slate-300" />
                      )}
                    </td>
                    <td className="p-4 font-bold text-slate-800">{p.name}</td>
                    <td className="p-4 text-blue-600 font-bold">{(p.price ?? p.unit_price ?? 0)} ج.م</td>
                    <td className="p-4 text-slate-500">{p.carton_price ? `${p.carton_price} ج.م` : '-'}</td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${((p.stock ?? p.stock_qty ?? 0) < 10) ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                        {(p.stock ?? p.stock_qty ?? 0)} قطعة
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-semibold bg-purple-50 text-purple-600 px-2.5 py-1 rounded-lg">
                        {p.ai_images ? p.ai_images.length : (p.image_url ? 1 : 0)} صور للمنتج
                      </span>
                    </td>
                    <td className="p-4">
                      <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition">
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* العرض للموبايل (كروت) */}
        <div className="grid gap-3 p-3 md:hidden">
          {products.length === 0 ? (
            <div className="text-center p-6 text-slate-400">لا توجد منتجات مسجلة حالياً</div>
          ) : (
            products.map(p => (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border" />}
                    <div>
                      <h3 className="font-bold text-slate-800">{p.name}</h3>
                      <p className="text-sm text-blue-600 font-bold">{(p.price ?? p.unit_price ?? 0)} ج.م</p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-100 p-2 rounded-xl transition">
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">سعر الكرتونة</span>
                    <span>{p.carton_price ? `${p.carton_price} ج.م` : '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">الكمية المتوفرة</span>
                    <span className={`font-bold ${((p.stock ?? p.stock_qty ?? 0) < 10) ? 'text-red-600' : 'text-green-600'}`}>
                      {(p.stock ?? p.stock_qty ?? 0)} قطعة
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">صور التدريب</span>
                    <span>{p.ai_images ? p.ai_images.length : (p.image_url ? 1 : 0)} صور</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}