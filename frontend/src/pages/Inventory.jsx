import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { Plus, Trash2, Package, UploadCloud, Image as ImageIcon, CheckCircle2 } from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cartonPrice, setCartonPrice] = useState('');
  const [stock, setStock] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: true });
    if (data) setProducts(data);
  };

  // التعامل مع اختيار الصور المتعددة
  const handleFileChange = (e) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  // رفع الصور لـ Supabase Storage والحصول على الروابط
  const uploadImages = async () => {
    let imageUrls = [];
    for (let file of selectedFiles) {
      const fileName = `${Date.now()}_${file.name}`;
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

    // حفظ المنتج بالصور (سواء صورة واحدة أو مجموعة صور للـ AI)
    await supabase.from('products').insert([
      { 
        name, 
        price: parseFloat(price), 
        carton_price: cartonPrice ? parseFloat(cartonPrice) : null, 
        stock: parseInt(stock), 
        image_url: images[0] || null, // الصورة الرئيسية
        ai_images: images // كود الصور المتعددة لتدريب الموديل
      }
    ]);

    setName(''); setPrice(''); setCartonPrice(''); setStock(''); setSelectedFiles([]);
    setUploading(false);
    fetchProducts();
  };

  const handleDelete = async (id) => {
    await supabase.from('products').delete().eq('id', id);
    fetchProducts();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans text-right dir-rtl">
      <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> إدارة المخزون ورصد صور التعرف (AI Training)
      </h1>

      {/* نموذج إضافة منتج مع رفع صور متعددة */}
      <form onSubmit={handleAddProduct} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" placeholder="سعر القطعة (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="number" placeholder="سعر الكرتونة (اختياري)" value={cartonPrice} onChange={e => setCartonPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="number" placeholder="الكمية المتوفرة" value={stock} onChange={e => setStock(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>

        {/* خانة رفع صور متعددة */}
        <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
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
            <span className="text-sm font-bold text-slate-700">اضغط لرفع صور المنتج (يمكنك اختيار كذا صورة لتدريب الذكاء الاصطناعي)</span>
            <span className="text-xs text-slate-400">PNG, JPG, WEBP</span>
          </label>
          
          {selectedFiles.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-green-600 font-bold text-xs bg-green-50 px-3 py-1.5 rounded-xl">
              <CheckCircle2 size={16} /> تم اختيار {selectedFiles.length} صورة جاهزة للرفع
            </div>
          )}
        </div>

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
                  {p.image_url ? <img src={p.image_url} alt="" className="w-12 h-12 object-cover rounded-xl border" /> : <ImageIcon size={28} className="text-slate-300" />}
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
                    {p.ai_images ? p.ai_images.length : 1} صور للـ AI
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