import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { Plus, Trash2, Package, RefreshCw } from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [cartonPrice, setCartonPrice] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('id', { ascending: true });
    if (data) setProducts(data);
    setLoading(false);
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!name || !unitPrice || !stockQty) return;

    await supabase.from('products').insert([
      {
        name,
        unit_price: parseFloat(unitPrice),
        carton_price: cartonPrice ? parseFloat(cartonPrice) : null,
        stock_qty: parseInt(stockQty, 10),
      }
    ]);

    setName(''); setUnitPrice(''); setCartonPrice(''); setStockQty('');
    fetchProducts();
  };

  const handleDelete = async (id) => {
    await supabase.from('products').delete().eq('id', id);
    fetchProducts();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 font-sans">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Package className="text-blue-600" /> إدارة المخزون والمنتجات
        </h1>
        <button onClick={fetchProducts} className="p-2 border rounded-xl hover:bg-gray-50 flex items-center gap-1 text-sm">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> تحديث
        </button>
      </div>

      {/* نموذج إضافة منتج */}
      <form onSubmit={handleAddProduct} className="bg-white p-6 rounded-2xl border shadow-sm grid grid-cols-1 md:grid-cols-5 gap-4">
        <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-gray-50 text-sm focus:outline-none" required />
        <input type="number" placeholder="سعر القطعة (ج.م)" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} className="p-3 border rounded-xl bg-gray-50 text-sm focus:outline-none" required />
        <input type="number" placeholder="سعر الكرتونة (اختياري)" value={cartonPrice} onChange={e => setCartonPrice(e.target.value)} className="p-3 border rounded-xl bg-gray-50 text-sm focus:outline-none" />
        <input type="number" placeholder="الكمية المتوفرة" value={stockQty} onChange={e => setStockQty(e.target.value)} className="p-3 border rounded-xl bg-gray-50 text-sm focus:outline-none" required />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-xl flex items-center justify-center gap-2 text-sm transition">
          <Plus size={18} /> إضافة للمخزن
        </button>
      </form>

      {/* جدول المنتجات */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-right border-collapse">
          <thead className="bg-gray-50 text-gray-600 text-sm border-b">
            <tr>
              <th className="p-4">المنتج</th>
              <th className="p-4">سعر القطعة</th>
              <th className="p-4">سعر الكرتونة</th>
              <th className="p-4">الكمية</th>
              <th className="p-4">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="p-4 font-semibold text-gray-800">{p.name}</td>
                <td className="p-4 text-blue-600 font-bold">{p.unit_price} ج.م</td>
                <td className="p-4 text-gray-500">{p.carton_price ? `${p.carton_price} ج.م` : '-'}</td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${p.stock_qty < 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                    {p.stock_qty} قطعة
                  </span>
                </td>
                <td className="p-4">
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 p-2">
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
