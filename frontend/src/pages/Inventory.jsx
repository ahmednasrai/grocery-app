import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { Plus, Trash2, Package, Image as ImageIcon } from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cartonPrice, setCartonPrice] = useState('');
  const [stock, setStock] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: true });
    if (data) setProducts(data);
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!name || !price || !stock) return;

    await supabase.from('products').insert([
      { name, price: parseFloat(price), carton_price: cartonPrice ? parseFloat(cartonPrice) : null, stock: parseInt(stock), image_url: imageUrl }
    ]);

    setName(''); setPrice(''); setCartonPrice(''); setStock(''); setImageUrl('');
    fetchProducts();
  };

  const handleDelete = async (id) => {
    await supabase.from('products').delete().eq('id', id);
    fetchProducts();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans text-right dir-rtl">
      <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> إدارة المخزون وصور المنتجات
      </h1>

      {/* إضافة منتج مع رابط صورة */}
      <form onSubmit={handleAddProduct} className="bg-white p-5 rounded-2xl border shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
        <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none" required />
        <input type="number" placeholder="سعر القطعة (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none" required />
        <input type="number" placeholder="سعر الكرتونة (اختياري)" value={cartonPrice} onChange={e => setCartonPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none" />
        <input type="number" placeholder="الكمية المتوفرة" value={stock} onChange={e => setStock(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none" required />
        <input type="url" placeholder="رابط صورة المنتج (اختياري)" value={imageUrl} onChange={e => setImageUrl(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none" />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-xl flex items-center justify-center gap-2 text-sm transition">
          <Plus size={18} /> إضافة للمخزن
        </button>
      </form>

      {/* جدول المنتجات */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-right border-collapse">
          <thead className="bg-slate-50 text-slate-600 text-sm border-b">
            <tr>
              <th className="p-4">الصورة</th>
              <th className="p-4">اسم المنتج</th>
              <th className="p-4">سعر القطعة</th>
              <th className="p-4">الكمية</th>
              <th className="p-4">حذف</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="p-4">
                  {p.image_url ? <img src={p.image_url} className="w-10 h-10 object-cover rounded-lg" /> : <ImageIcon size={24} className="text-slate-300" />}
                </td>
                <td className="p-4 font-bold text-slate-800">{p.name}</td>
                <td className="p-4 text-blue-600 font-bold">{p.price} ج.م</td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${p.stock < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                    {p.stock} قطعة
                  </span>
                </td>
                <td className="p-4">
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg">
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