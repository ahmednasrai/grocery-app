import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
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
  const [uploading, setUploading] = useState(false);

  // حالة التحكم بالكاميرا
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  useEffect(() => { 
    fetchProducts(); 
    return () => {
      stopCamera(); // إغلاق الكاميرا عند الخروج من الصفحة
    };
  }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: true });
    if (data) setProducts(data);
  };

  // ---------------- الكاميرا ----------------
  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // استخدام الكاميرا الخلفية في الهواتف
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
    let imageUrls = [];
    for (let file of selectedFiles) {
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const { data, error } = await supabase.storage.from('product-images').upload(fileName, file);
      
      if (!error && data) {
        const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
        imageUrls.push(publicUrlData.publicUrl);
      }
    }
    return imageUrls;
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!name || !price || !stock) return;
    setUploading(true);

    let images = [];
    if (selectedFiles.length > 0) {
      images = await uploadImages();
    }

    await supabase.from('products').insert([
      { 
        name, 
        price: parseFloat(price), 
        carton_price: cartonPrice ? parseFloat(cartonPrice) : null, 
        stock: parseInt(stock), 
        image_url: images[0] || null,
        ai_images: images
      }
    ]);

    setName(''); 
    setPrice(''); 
    setCartonPrice(''); 
    setStock(''); 
    setSelectedFiles([]);
    setUploading(false);
    stopCamera();
    fetchProducts();
  };

  const handleDelete = async (id) => {
    await supabase.from('products').delete().eq('id', id);
    fetchProducts();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans text-right dir-rtl" dir="rtl">
      <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> Rushdy Mart | إدارة المخزون
      </h1>

      {/* نموذج إضافة منتج */}
      <form onSubmit={handleAddProduct} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" placeholder="سعر القطعة (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" placeholder="سعر الكرتونة (اختياري)" value={cartonPrice} onChange={e => setCartonPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="number" placeholder="الكمية المتوفرة" value={stock} onChange={e => setStock(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>

        {/* خيارات رفع/التقاط الصور */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* خيار اختيار ملفات من الجهاز */}
          <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 cursor-pointer hover:bg-slate-100 transition relative">
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleFileChange} 
              id="file-upload" 
              className="hidden" 
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-1 text-slate-500">
              <UploadCloud size={32} className="text-blue-600" />
              <span className="text-sm font-bold text-slate-700">رفع صور من الجهاز</span>
              <span className="text-xs text-slate-400">PNG, JPG, WEBP</span>
            </label>
          </div>

          {/* خيار فتح الكاميرا والتصوير */}
          <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition">
            {!isCameraOpen ? (
              <button 
                type="button" 
                onClick={startCamera} 
                className="flex flex-col items-center gap-1 text-slate-500 w-full"
              >
                <Camera size={32} className="text-purple-600" />
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

                <div className="flex gap-2">
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

        {/* Canvas خفي للتقاط الصورة */}
        <canvas ref={canvasRef} className="hidden" />

        {/* معاينة الصور المختارة والملتقطة */}
        {selectedFiles.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
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
                  <img 
                    src={URL.createObjectURL(file)} 
                    alt="Preview" 
                    className="w-full h-full object-cover" 
                  />
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
          disabled={uploading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3.5 rounded-xl flex items-center justify-center gap-2 text-sm transition disabled:opacity-50"
        >
          <Plus size={18} /> {uploading ? "جاري رفع الصور والتحميل..." : "إضافة المنتج للمخزن وتسجيله"}
        </button>
      </form>

      {/* جدول المنتجات */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-right border-collapse">
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
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="p-4">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-12 h-12 object-cover rounded-xl border" />
                  ) : (
                    <ImageIcon size={28} className="text-slate-300" />
                  )}
                </td>
                <td className="p-4 font-bold text-slate-800">{p.name}</td>
                <td className="p-4 text-blue-600 font-bold">{p.price} ج.م</td>
                <td className="p-4 text-slate-500">{p.carton_price ? `${p.carton_price} ج.م` : '-'}</td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${p.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                    {p.stock} قطعة
                  </span>
                </td>
                <td className="p-4">
                  <span className="text-xs font-semibold bg-purple-50 text-purple-600 px-2.5 py-1 rounded-lg">
                    {p.ai_images ? p.ai_images.length : (p.image_url ? 1 : 0)} صور للمنتج
                  </span>
                </td>
                <td className="p-4">
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-xl">
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}