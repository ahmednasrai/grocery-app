import React, { useState, useEffect } from 'react';
import { createProduct, deleteProduct, fetchProducts, resolveMediaUrl, uploadProductImage } from '../services/api';
import { 
  Plus, 
  Trash2, 
  Package, 
  UploadCloud, 
  Image as ImageIcon, 
  CheckCircle2, 
  X,
  RotateCcw
} from 'lucide-react';
import { unitDetailText as unitDetail, availabilityText } from '../utils/units';

const UNIT_OPTIONS = [
  { value: 'piece', label: 'قطعة' },
  { value: 'kg', label: 'كيلو' },
  { value: 'liter', label: 'لتر' },
  { value: 'carton', label: 'كرتونة' },
  { value: 'sack', label: 'شكارة' },
];

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState('');
  const [unitType, setUnitType] = useState('piece');
  const [piecesPerCarton, setPiecesPerCarton] = useState('');
  const [kgPerSack, setKgPerSack] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const normalizeProduct = (product) => ({
    ...product,
    price: product.price ?? product.unit_price ?? 0,
    unit_price: product.unit_price ?? product.price ?? 0,
    stock: product.stock ?? product.stock_qty ?? 0,
    stock_qty: product.stock_qty ?? product.stock ?? 0,
    unit_type: product.unit_type || 'piece',
    unit_label: product.unit_label || 'قطعة',
  });

  const loadProducts = async () => {
    try {
      const res = await fetchProducts();
      const list = Array.isArray(res) ? res : (res?.data || []);
      setProducts(list.map(normalizeProduct).sort((a, b) => a.id - b.id));
    } catch (error) {
      console.error("خطأ في جلب المنتجات:", error);
    }
  };

  const isValidForSubmit = () => {
    if (!name || !price || !stock || loading) return false;
    if (unitType === 'carton' && !piecesPerCarton) return false;
    if (unitType === 'sack' && !kgPerSack) return false;
    return true;
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
        const result = await uploadProductImage(file);
        if (result.url) {
          uploadedImages.push(result.url);
        } else {
          failedImages.push(`${file.name}: لم يتم حفظ الصورة`);
        }
      } catch (error) {
        console.error('Upload error:', error);
        failedImages.push(error.message || file.name);
      }
    }

    return { images: uploadedImages, failedImages };
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!isValidForSubmit()) return;

    setLoading(true);

    try {
      let imageUrl = null;
      let warningMessage = '';

      if (selectedFiles.length > 0) {
        const uploadResult = await uploadImages();
        imageUrl = uploadResult.images[0] || null;
        if (uploadResult.failedImages.length > 0) {
          warningMessage = `تمت إضافة المنتج، لكن الصورة لم تُرسل: ${uploadResult.failedImages.join(' • ')}`;
        }
      }

      const payload = {
        name,
        unit_type: unitType,
        price: parseFloat(price),
        unit_price: parseFloat(price),
        stock: parseInt(stock, 10),
        stock_qty: parseInt(stock, 10),
        image_url: imageUrl,
      };
      if (unitType === 'carton') {
        payload.pieces_per_carton = parseInt(piecesPerCarton, 10);
      }
      if (unitType === 'sack') {
        payload.kg_per_sack = parseFloat(kgPerSack);
      }

      await createProduct(payload);

      setName('');
      setUnitType('piece');
      setPiecesPerCarton('');
      setKgPerSack('');
      setPrice('');
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
    }
  };

  const handleDelete = async (id) => {
    if (!id || deletingId) return;
    if (!window.confirm("هل أنت تأكد من رغبتك في حذف هذا المنتج؟")) return;

    setDeletingId(id);
    try {
      await deleteProduct(id);
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error("خطأ أثناء الحذف:", error);
      alert(`فشل حذف المنتج: ${error.message || 'حاول مرة أخرى'}`);
      await loadProducts();
    } finally {
      setDeletingId(null);
    }
  };

  const unitDetailText = unitDetail;

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-6 font-sans text-right dir-rtl" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> Rushdy Mart | المخزون
      </h1>
      <p className="text-sm text-slate-500">
        يمكنك إضافة صورة للمنتج لتحسين ظهوره في النظام — الصورة اختيارية.
      </p>

      <form onSubmit={handleAddProduct} className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />

          <select
            value={unitType}
            onChange={e => setUnitType(e.target.value)}
            className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            {UNIT_OPTIONS.map(u => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>

          {unitType === 'carton' && (
            <input
              type="number"
              placeholder="عدد القطع داخل الكرتونة *"
              value={piecesPerCarton}
              onChange={e => setPiecesPerCarton(e.target.value)}
              className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          )}
          {unitType === 'sack' && (
            <input
              type="number"
              placeholder="وزن الشكارة بالكيلو *"
              value={kgPerSack}
              onChange={e => setKgPerSack(e.target.value)}
              className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          )}

          <input type="number" step="0.01" placeholder="السعر (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          <input
            type="number"
            placeholder={unitType === 'carton' ? 'الكمية بالقطع داخل الكراتين *' : unitType === 'sack' ? 'الكمية بالكيلو داخل الشكاير *' : 'الكمية بالوحدة الأساسية *'}
            value={stock}
            onChange={e => setStock(e.target.value)}
            className="p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {(unitType === 'carton' || unitType === 'sack') && (
          <p className="text-xs text-blue-600 font-bold bg-blue-50 p-2.5 rounded-xl">
            ملاحظة: تُحفظ الكمية بالوحدة الأساسية ({unitType === 'carton' ? 'قطع' : 'كجم'}) — مثال:
            {unitType === 'carton' ? ` ${piecesPerCarton || '24'} قطعة تعني كرتونة واحدة` : ` ${kgPerSack || '25'} كجم تعني شكارة واحدة`}.
          </p>
        )}

        <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            id="file-upload"
            className="hidden"
          />
          <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-1 text-slate-500 text-center">
            <UploadCloud size={28} className="text-blue-600" />
            <span className="text-sm font-bold text-slate-700">{selectedFiles.length > 0 ? 'تغيير الصورة' : 'رفع صورة المنتج (اختياري)'}</span>
            <span className="text-xs text-slate-400">PNG, JPG, WEBP — صورة واحدة اختيارية</span>
          </label>
        </div>

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
          disabled={!isValidForSubmit()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3.5 rounded-xl flex items-center justify-center gap-2 text-sm transition disabled:opacity-50"
        >
          <Plus size={18} /> {loading ? 'جاري الإضافة...' : 'إضافة المنتج'}
        </button>
      </form>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {/* العرض للشاشات الكبيرة (جدول) */}
        <div className="w-full overflow-x-auto hidden md:block">
          <table className="w-full min-w-[640px] text-right border-collapse">
            <thead className="bg-slate-50 text-slate-600 text-sm border-b">
              <tr>
                <th className="p-4">الصورة</th>
                <th className="p-4">اسم المنتج</th>
                <th className="p-4">الوحدة</th>
                <th className="p-4">الكمية</th>
                <th className="p-4">السعر</th>
                <th className="p-4">تفاصيل الوحدة</th>
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
                        <img src={resolveMediaUrl(p.image_url)} alt="" className="w-12 h-12 object-cover rounded-xl border" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl border border-dashed flex items-center justify-center bg-slate-50">
                          <ImageIcon size={22} className="text-slate-300" />
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-bold text-slate-800">{p.name}</td>
                    <td className="p-4 text-slate-600">{p.unit_label}</td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${(p.stock < 10) ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                        {availabilityText(p)}
                      </span>
                    </td>
                    <td className="p-4 text-blue-600 font-bold">{p.price} ج.م</td>
                    <td className="p-4 text-slate-500">{unitDetailText(p) || '-'}</td>
                    <td className="p-4">
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id}
                        className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition disabled:opacity-50"
                      >
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
                    {p.image_url ? (
                      <img src={resolveMediaUrl(p.image_url)} alt="" className="w-10 h-10 object-cover rounded-lg border" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-dashed flex items-center justify-center bg-white">
                        <ImageIcon size={18} className="text-slate-300" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-bold text-slate-800">{p.name}</h3>
                      <p className="text-sm text-blue-600 font-bold">{p.price} ج.م</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deletingId === p.id}
                    className="text-red-500 hover:bg-red-100 p-2 rounded-xl transition disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">الوحدة</span>
                    <span>{p.unit_label}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-700">الكمية المتوفرة</span>
                    <span className={`font-bold ${(p.stock < 10) ? 'text-red-600' : 'text-green-600'}`}>
                      {availabilityText(p)}
                    </span>
                  </div>
                  {unitDetailText(p) && (
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-700">تفاصيل الوحدة</span>
                      <span>{unitDetailText(p)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}