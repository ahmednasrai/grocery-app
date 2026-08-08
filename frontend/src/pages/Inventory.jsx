import React, { useState, useEffect } from 'react';
import {
  createProduct, deleteProduct, fetchProducts, resolveMediaUrl, uploadProductImage,
  updateProduct, receiveStock, adjustStock,
} from '../services/api';
import {
  Plus, Trash2, Package, UploadCloud, Image as ImageIcon, CheckCircle2, X, RotateCcw,
  Pencil, PackagePlus, SlidersHorizontal, Archive, ArchiveRestore,
} from 'lucide-react';
import {
  unitDetailText as unitDetail, availabilityText, unitLabel, sellOptions,
  stockStatusBadge, stockStatusTone, baseUnitLabel,
} from '../utils/units';

const UNIT_OPTIONS = [
  { value: 'piece', label: 'قطعة' },
  { value: 'kg', label: 'كيلو' },
  { value: 'liter', label: 'لتر' },
  { value: 'carton', label: 'كرتونة' },
  { value: 'sack', label: 'شكارة' },
];

const MODAL_CLASS = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 overflow-y-auto';
const PANEL_CLASS = 'bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 my-8';
const INPUT_CLASS = 'p-3 border rounded-xl bg-slate-50 text-sm outline-none focus:ring-2 focus:ring-blue-500 w-full';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [unitType, setUnitType] = useState('piece');
  const [piecesPerCarton, setPiecesPerCarton] = useState('');
  const [kgPerSack, setKgPerSack] = useState('');
  const [containers, setContainers] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minimumStock, setMinimumStock] = useState('10');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [adding, setAdding] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [receiveTarget, setReceiveTarget] = useState(null);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [modalError, setModalError] = useState('');
  const [modalBusy, setModalBusy] = useState(false);

  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchProducts();
      const list = Array.isArray(res) ? res : (res?.data || []);
      setProducts(list.sort((a, b) => a.id - b.id));
    } catch (err) {
      setError(err.message || 'تعذر تحميل المنتجات');
      console.error('خطأ في جلب المنتجات:', err);
    } finally {
      setLoading(false);
    }
  };

  const resetAddForm = () => {
    setName('');
    setUnitType('piece');
    setPiecesPerCarton('');
    setKgPerSack('');
    setContainers('');
    setPrice('');
    setStock('');
    setMinimumStock('10');
    setSelectedFiles([]);
  };

  // ---------------- إضافة منتج ----------------
  const computedBaseStock = () => {
    if (unitType === 'carton') {
      const c = parseFloat(containers);
      const p = parseFloat(piecesPerCarton);
      if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0) return null;
      return Math.round(c * p);
    }
    if (unitType === 'sack') {
      const c = parseFloat(containers);
      const k = parseFloat(kgPerSack);
      if (!Number.isFinite(c) || !Number.isFinite(k) || c <= 0 || k <= 0) return null;
      return Math.round(c * k);
    }
    const s = parseFloat(stock);
    return Number.isFinite(s) ? Math.round(s) : null;
  };

  const isValidForSubmit = () => {
    if (!name || (!price && price !== 0) || adding) return false;
    if (unitType === 'carton' && (!piecesPerCarton || parseFloat(piecesPerCarton) <= 0)) return false;
    if (unitType === 'sack' && (!kgPerSack || parseFloat(kgPerSack) <= 0)) return false;
    const computed = computedBaseStock();
    if (computed === null || computed < 0) return false;
    return true;
  };

  const handleFileChange = (e) => {
    if (e.target.files) setSelectedFiles(Array.from(e.target.files));
  };

  const addPayload = (imageUrl) => {
    const baseStock = computedBaseStock();
    return {
      name,
      unit_type: unitType,
      price: parseFloat(price),
      unit_price: parseFloat(price),
      stock: baseStock,
      stock_qty: baseStock,
      minimum_stock: minimumStock === '' ? 10 : parseInt(minimumStock, 10),
      image_url: imageUrl,
      ...(unitType === 'carton' ? { pieces_per_carton: parseInt(piecesPerCarton, 10) } : {}),
      ...(unitType === 'sack' ? { kg_per_sack: parseFloat(kgPerSack) } : {}),
    };
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!isValidForSubmit()) return;
    setAdding(true);
    try {
      let imageUrl = null;
      if (selectedFiles.length > 0) {
        const result = await uploadProductImage(selectedFiles[0]);
        imageUrl = result.url || null;
      }
      const created = await createProduct(addPayload(imageUrl));
      resetAddForm();
      setSelectedFiles([]);
      if (created && created.id) {
        setProducts(prev => [...prev, created].sort((a, b) => a.id - b.id));
      } else {
        await loadProducts();
      }
    } catch (err) {
      alert(`تعذر إضافة المنتج: ${err.message || 'يرجى المحاولة مرة أخرى'}`);
    } finally {
      setAdding(false);
    }
  };

  // ---------------- حذف / أرشفة ----------------
  const handleDelete = async (p) => {
    if (!p || deletingId) return;
    if (p.has_sales) {
      const ok = window.confirm('لا يمكن حذف هذا المنتج لأنه له مبيعات مسجلة سابقًا.\nيمكنك أرشفته (إخفاؤه) بدلاً من ذلك.');
      if (!ok) return;
      setDeletingId(p.id);
      try {
        await updateProduct(p.id, { is_active: false });
        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: false } : x));
        alert('تمت أرشفة المنتج وإخفاؤه من نقاط البيع. سيظل ظاهرًا في الفواتير والتقارير القديمة.');
      } catch (err) {
        alert(`فشلت الأرشفة: ${err.message || 'حاول مرة أخرى'}`);
      } finally {
        setDeletingId(null);
      }
      return;
    }
    if (!window.confirm('هل أنت متأكد من رغبتك في حذف هذا المنتج نهائيًا؟')) return;
    setDeletingId(p.id);
    try {
      await deleteProduct(p.id);
      setProducts(prev => prev.filter(x => x.id !== p.id));
    } catch (err) {
      alert(`فشل حذف المنتج: ${err.message || 'حاول مرة أخرى'}`);
      await loadProducts();
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestore = async (p) => {
    if (!p || deletingId) return;
    setDeletingId(p.id);
    try {
      await updateProduct(p.id, { is_active: true });
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: true } : x));
    } catch (err) {
      alert(`فشلت إعادة التفعيل: ${err.message || 'حاول مرة أخرى'}`);
      await loadProducts();
    } finally {
      setDeletingId(null);
    }
  };

  // ---------------- تعديل منتج ----------------
  const openEdit = (p) => {
    setModalError('');
    setEditTarget({ ...p, _name: p.name, _price: String(p.price ?? ''), _min: String(p.minimum_stock ?? 10) });
  };

  const runEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setModalBusy(true);
    try {
      const fields = {
        name: editTarget._name,
        price: parseFloat(editTarget._price),
        unit_price: parseFloat(editTarget._price),
        minimum_stock: parseInt(editTarget._min, 10) || 10,
      };
      const updated = await updateProduct(editTarget.id, fields);
      setEditTarget(null);
      setModalBusy(false);
      if (updated && updated.id) {
        setProducts(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
      } else {
        await loadProducts();
      }
      setModalError('');
    } catch (err) {
      setModalBusy(false);
      setModalError(err.message || 'تعذر تعديل المنتج');
    }
  };

  // ---------------- توريد مخزون ----------------
  const openReceive = (p) => {
    setModalError('');
    setReceiveTarget({ ...p, _qty: '', _unit: p.unit_type });
  };

  const runReceive = async (e) => {
    e.preventDefault();
    if (!receiveTarget) return;
    setModalBusy(true);
    try {
      const updated = await receiveStock(receiveTarget.id, {
        qty: parseFloat(receiveTarget._qty),
        unit: receiveTarget._unit,
      });
      setReceiveTarget(null);
      setModalBusy(false);
      if (updated && updated.id) {
        setProducts(prev => prev.map(x => x.id === updated.id ? {
          ...x,
          stock: updated.stock,
          stock_qty: updated.stock_qty ?? updated.stock,
        } : x));
      } else {
        await loadProducts();
      }
      setModalError('');
    } catch (err) {
      setModalBusy(false);
      setModalError(err.message || 'فشل التوريد');
    }
  };

  // ---------------- تعديل المخزون ----------------
  const openAdjust = (p) => {
    setModalError('');
    setAdjustTarget({ ...p, _op: 'add', _qty: '', _unit: p.unit_type });
  };

  const runAdjust = async (e) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setModalBusy(true);
    try {
      const body = { operation: adjustTarget._op, qty: parseFloat(adjustTarget._qty) };
      if (adjustTarget._op !== 'set') body.unit = adjustTarget._unit;
      const updated = await adjustStock(adjustTarget.id, body);
      setAdjustTarget(null);
      setModalBusy(false);
      if (updated && updated.id) {
        setProducts(prev => prev.map(x => x.id === updated.id ? {
          ...x,
          stock: updated.stock,
          stock_qty: updated.stock_qty ?? updated.stock,
        } : x));
      } else {
        await loadProducts();
      }
      setModalError('');
    } catch (err) {
      setModalBusy(false);
      setModalError(err.message || 'فشل تعديل المخزون');
    }
  };

  const renderModalError = () =>
    modalError ? <p className="text-xs text-red-600 bg-red-50 p-2 rounded-xl">{modalError}</p> : null;

  const closeAll = () => {
    setEditTarget(null);
    setReceiveTarget(null);
    setAdjustTarget(null);
    setModalError('');
  };

  const isArchived = (p) => p.is_active === false;

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 font-sans text-right dir-rtl" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
        <Package className="text-blue-600" /> Rushdy Mart | إدارة المخزون
      </h1>

      {/* ---------------- إضافة منتج ---------------- */}
      <form onSubmit={handleAddProduct} className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <h2 className="font-black text-slate-700 flex items-center gap-2 text-sm">+ إضافة منتج جديد</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input type="text" placeholder="اسم المنتج" value={name} onChange={e => setName(e.target.value)} className={INPUT_CLASS} required />
          <select value={unitType} onChange={e => setUnitType(e.target.value)} className={INPUT_CLASS}>
            {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          {unitType === 'carton' && (
            <input type="number" min="1" placeholder="عدد الكراتين المتوفرة (مثال: 5)" value={containers}
              onChange={e => setContainers(e.target.value)} className={INPUT_CLASS} required />
          )}
          {unitType === 'sack' && (
            <input type="number" min="1" placeholder="عدد الشكاير المتوفرة (مثال: 3)" value={containers}
              onChange={e => setContainers(e.target.value)} className={INPUT_CLASS} required />
          )}
          {unitType === 'carton' && (
            <input type="number" min="1" placeholder="عدد القطع داخل الكرتونة الواحدة (مثال: 24)" value={piecesPerCarton}
              onChange={e => setPiecesPerCarton(e.target.value)} className={INPUT_CLASS} required />
          )}
          {unitType === 'sack' && (
            <input type="number" min="1" step="1" placeholder="وزن الشكارة الواحدة بالكيلو (مثال: 25)" value={kgPerSack}
              onChange={e => setKgPerSack(e.target.value)} className={INPUT_CLASS} required />
          )}
          <input type="number" step="0.01" min="0" placeholder="السعر الأساسي (ج.م)" value={price} onChange={e => setPrice(e.target.value)} className={INPUT_CLASS} required />
          {unitType !== 'carton' && unitType !== 'sack' ? (
            <input
              type="number"
              min="0"
              placeholder="الكمية الأساسية (قطعة/كجم/لتر) *"
              value={stock}
              onChange={e => setStock(e.target.value)}
              className={INPUT_CLASS}
              required
            />
          ) : null}
          <input type="number" min="0" placeholder="الحد الأدنى للتنبيه (وحدة أساسية) — الافتراضي 10" value={minimumStock} onChange={e => setMinimumStock(e.target.value)} className={INPUT_CLASS} />
        </div>
        {(unitType === 'carton' || unitType === 'sack') && (
          <p className="text-xs text-blue-600 font-bold bg-blue-50 p-2.5 rounded-xl">
            يُحسب إجمالي المخزون تلقائيًا: {containers || '0'} × {unitType === 'carton' ? (piecesPerCarton || '0') : (kgPerSack || '0')} ={' '}
            {computedBaseStock() ?? '—'} {unitType === 'carton' ? 'قطعة' : 'كجم'} (يُحفظ بوحدة أساسية واحدة)
          </p>
        )}
        <div className="border-2 border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
          <input type="file" accept="image/*" onChange={handleFileChange} id="file-upload" className="hidden" />
          <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-1 text-slate-500 text-center">
            <UploadCloud size={28} className="text-blue-600" />
            <span className="text-sm font-bold text-slate-700">{selectedFiles.length > 0 ? 'تغيير الصورة' : 'رفع صورة المنتج (اختياري)'}</span>
          </label>
        </div>
        {selectedFiles.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <CheckCircle2 size={16} className="text-green-600" /> الصور الجاهزة للرفع ({selectedFiles.length})
              </span>
              <button type="button" onClick={() => setSelectedFiles([])} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                <RotateCcw size={12} /> مسح الكل
              </button>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {selectedFiles.map((file, index) => (
                <div key={index} className="relative group w-16 h-16 rounded-lg overflow-hidden border bg-white shadow-sm">
                  <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== index))}
                    className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <button type="submit" disabled={!isValidForSubmit()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3.5 rounded-xl flex items-center justify-center gap-2 text-sm transition disabled:opacity-50">
          <Plus size={18} /> {adding ? 'جاري الإضافة...' : 'إضافة المنتج'}
        </button>
      </form>

      {/* ---------------- الجدول ---------------- */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center p-8 text-slate-400 text-sm">جاري تحميل المنتجات...</div>
        ) : error ? (
          <div className="text-center p-8 text-red-500 text-sm">{error}</div>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[860px] text-right border-collapse">
                <thead className="bg-slate-50 text-slate-600 text-sm border-b">
                  <tr>
                    <th className="p-4">الصورة</th>
                    <th className="p-4">اسم المنتج</th>
                    <th className="p-4">الوحدة</th>
                    <th className="p-4">المخزون (وحدة أساسية)</th>
                    <th className="p-4">الحد الأدنى للتنبيه</th>
                    <th className="p-4">السعر</th>
                    <th className="p-4">الحالة</th>
                    <th className="p-4">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {products.length === 0 ? (
                    <tr><td colSpan="8" className="text-center p-6 text-slate-400">لا توجد منتجات مسجلة حالياً</td></tr>
                  ) : products.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition">
                      <td className="p-4">
                        {p.image_url ? (
                          <img src={resolveMediaUrl(p.image_url)} alt="" loading="lazy" className="w-12 h-12 object-cover rounded-xl border" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl border border-dashed flex items-center justify-center bg-slate-50">
                            <ImageIcon size={22} className="text-slate-300" />
                          </div>
                        )}
                      </td>
                      <td className="p-4 font-bold text-slate-800">
                        {p.name}
                        {isArchived(p) && <span className="mr-2 px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold">مؤرشف</span>}
                      </td>
                      <td className="p-4 text-slate-600">{p.unit_label}{unitDetail(p) ? ` (${unitDetail(p)})` : ''}</td>
                      <td className="p-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-slate-800">{availabilityText(p)}</span>
                          <span className="text-[11px] text-slate-400">بـ{baseUnitLabel(p.unit_type)}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-600">{p.minimum_stock} {baseUnitLabel(p.unit_type)}</td>
                      <td className="p-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-blue-600 font-bold">{p.price} ج/{baseUnitLabel(p.unit_type)}</span>
                          {p.unit_type === 'carton' && p.carton_price != null && (
                            <span className="text-[11px] text-slate-500">{p.carton_price} ج/كرتونة</span>
                          )}
                          {p.unit_type === 'sack' && p.sack_price != null && (
                            <span className="text-[11px] text-slate-500">{p.sack_price} ج/شكارة</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${stockStatusTone(p.stock_status)}`}>
                          {stockStatusBadge(p.stock_status)}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          {isArchived(p) ? (
                            <button onClick={() => handleRestore(p)} disabled={deletingId === p.id} title="إعادة التفعيل"
                              className="text-emerald-600 hover:bg-emerald-50 p-2 rounded-xl transition disabled:opacity-50"><ArchiveRestore size={17} /></button>
                          ) : (
                            <>
                              <button onClick={() => openEdit(p)} title="تعديل المنتج"
                                className="text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition"><Pencil size={17} /></button>
                              <button onClick={() => openReceive(p)} title="إضافة مخزون (توريد)"
                                className="text-emerald-600 hover:bg-emerald-50 p-2 rounded-xl transition"><PackagePlus size={17} /></button>
                              <button onClick={() => openAdjust(p)} title="تعديل المخزون"
                                className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-xl transition"><SlidersHorizontal size={17} /></button>
                              <button onClick={() => handleDelete(p)} disabled={deletingId === p.id} title={p.has_sales ? 'أرشفة (مبيعات سابقة)' : 'حذف نهائي'}
                                className="text-red-500 hover:bg-red-50 p-2 rounded-xl transition disabled:opacity-50">
                                {p.has_sales ? <Archive size={17} /> : <Trash2 size={17} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-3 md:hidden">
              {products.length === 0 ? (
                <div className="text-center p-6 text-slate-400">لا توجد منتجات مسجلة حالياً</div>
              ) : products.map(p => (
                <div key={p.id} className={`rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm ${isArchived(p) ? 'opacity-80' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {p.image_url
                        ? <img src={resolveMediaUrl(p.image_url)} alt="" loading="lazy" className="w-10 h-10 object-cover rounded-lg border" />
                        : <div className="w-10 h-10 rounded-lg border border-dashed flex items-center justify-center bg-white"><ImageIcon size={18} className="text-slate-300" /></div>}
                      <div>
                        <h3 className="font-bold text-slate-800">{p.name}</h3>
                        <p className="text-sm text-blue-600 font-bold">{p.price} ج/{baseUnitLabel(p.unit_type)}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${stockStatusTone(p.stock_status)}`}>
                      {stockStatusBadge(p.stock_status)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-200">
                    <div className="flex justify-between"><span className="font-semibold text-slate-700">المخزون</span><span className="font-bold">{availabilityText(p)}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-slate-700">الحد الأدنى للتنبيه</span><span>{p.minimum_stock} {baseUnitLabel(p.unit_type)}</span></div>
                    {unitDetail(p) && <div className="flex justify-between"><span className="font-semibold text-slate-700">تفاصيل الوحدة</span><span>{unitDetail(p)}</span></div>}
                    <div className="flex justify-end gap-1 pt-1">
                      {isArchived(p) ? (
                        <button onClick={() => handleRestore(p)} disabled={deletingId === p.id} className="text-emerald-600 hover:bg-emerald-100 p-2 rounded-xl" title="إعادة التفعيل"><ArchiveRestore size={16} /></button>
                      ) : (
                        <>
                          <button onClick={() => openEdit(p)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-xl"><Pencil size={16} /></button>
                          <button onClick={() => openReceive(p)} className="text-emerald-600 hover:bg-emerald-100 p-2 rounded-xl"><PackagePlus size={16} /></button>
                          <button onClick={() => openAdjust(p)} className="text-indigo-600 hover:bg-indigo-100 p-2 rounded-xl"><SlidersHorizontal size={16} /></button>
                          <button onClick={() => handleDelete(p)} disabled={deletingId === p.id} className="text-red-500 hover:bg-red-100 p-2 rounded-xl" title={p.has_sales ? 'أرشفة' : 'حذف'}>
                            {p.has_sales ? <Archive size={16} /> : <Trash2 size={16} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---------------- تعديل منتج ---------------- */}
      {editTarget && (
        <div className={MODAL_CLASS} onClick={closeAll} dir="rtl">
          <div className={PANEL_CLASS} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">تعديل المنتج — {editTarget.name}</h3>
              <button onClick={closeAll} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={runEdit} className="space-y-3">
              <label className="block text-xs font-bold text-slate-600">الاسم
                <input className={INPUT_CLASS + ' mt-1'} value={editTarget._name} onChange={e => setEditTarget({ ...editTarget, _name: e.target.value })} required />
              </label>
              <label className="block text-xs font-bold text-slate-600">السعر الأساسي ({baseUnitLabel(editTarget.unit_type)}) ج.م
                <input type="number" step="0.01" min="0" className={INPUT_CLASS + ' mt-1'} value={editTarget._price} onChange={e => setEditTarget({ ...editTarget, _price: e.target.value })} required />
              </label>
              {editTarget.unit_type === 'carton' && editTarget.carton_price != null && (
                <p className="text-[11px] text-slate-500">سعر الكرتونة المحسوب: {parseFloat(editTarget._price) * (editTarget.pieces_per_carton || 1)} ج.م</p>
              )}
              {editTarget.unit_type === 'sack' && editTarget.sack_price != null && (
                <p className="text-[11px] text-slate-500">سعر الشكارة المحسوب: {parseFloat(editTarget._price) * (editTarget.kg_per_sack || 1)} ج.م</p>
              )}
              <label className="block text-xs font-bold text-slate-600">الحد الأدنى للتنبيه ({baseUnitLabel(editTarget.unit_type)})
                <input type="number" min="0" className={INPUT_CLASS + ' mt-1'} value={editTarget._min} onChange={e => setEditTarget({ ...editTarget, _min: e.target.value })} />
              </label>
              {editTarget.capacity_locked ? (
                <div className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl font-bold">
                  لا يمكن تغيير سعة الكرتونة/الشكارة لمنتج لديه مخزون أو مبيعات سابقة.
                </div>
              ) : (
                editTarget.unit_type === 'carton' && (
                  <label className="block text-xs font-bold text-slate-600">قطع داخل الكرتونة (متاح — لا يوجد مخزون/مبيعات)
                    <input type="number" min="1" className={INPUT_CLASS + ' mt-1'} value={editTarget.pieces_per_carton} disabled />
                  </label>
                )
              )}
              {renderModalError()}
              <button type="submit" disabled={modalBusy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-xl text-sm disabled:opacity-50">
                {modalBusy ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- توريد مخزون ---------------- */}
      {receiveTarget && (
        <div className={MODAL_CLASS} onClick={closeAll} dir="rtl">
          <div className={PANEL_CLASS} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">إضافة مخزون — {receiveTarget.name}</h3>
              <button onClick={closeAll} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500">
              المتاح الآن: <b className="text-slate-800">{availabilityText(receiveTarget)}</b>
            </p>
            <form onSubmit={runReceive} className="space-y-3">
              <label className="block text-xs font-bold text-slate-600">الكمية
                <input type="number" min="0.01" step="0.01" required className={INPUT_CLASS + ' mt-1'}
                  value={receiveTarget._qty} onChange={e => setReceiveTarget({ ...receiveTarget, _qty: e.target.value })} />
              </label>
              <label className="block text-xs font-bold text-slate-600">وحدة الإضافة
                <select className={INPUT_CLASS + ' mt-1'} value={receiveTarget._unit}
                  onChange={e => setReceiveTarget({ ...receiveTarget, _unit: e.target.value })}>
                  {sellOptions(receiveTarget).map(opt => (
                    <option key={opt.unit} value={opt.unit}>{opt.label} ({opt.price} ج.م)</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-blue-600 bg-blue-50 p-2.5 rounded-xl font-bold">
                الحساب يتم في الخادم: {receiveTarget._unit === 'carton' ? `كل كرتونة = ${receiveTarget.pieces_per_carton || 1} قطعة` : receiveTarget._unit === 'sack' ? `كل شكارة = ${receiveTarget.kg_per_sack || 1} كجم` : 'بالوحدة الأساسية مباشرة'}
              </p>
              {renderModalError()}
              <button type="submit" disabled={modalBusy || !receiveTarget._qty}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-3 rounded-xl text-sm disabled:opacity-50">
                {modalBusy ? 'جاري الإضافة...' : 'توريد المخزون'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- تعديل المخزون ---------------- */}
      {adjustTarget && (
        <div className={MODAL_CLASS} onClick={closeAll} dir="rtl">
          <div className={PANEL_CLASS} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800">تعديل المخزون — {adjustTarget.name}</h3>
              <button onClick={closeAll} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500">
              المتاح الآن: <b className="text-slate-800">{availabilityText(adjustTarget)}</b>
            </p>
            <form onSubmit={runAdjust} className="space-y-3">
              <label className="block text-xs font-bold text-slate-600">نوع العملية
                <select className={INPUT_CLASS + ' mt-1'} value={adjustTarget._op}
                  onChange={e => setAdjustTarget({ ...adjustTarget, _op: e.target.value })}>
                  <option value="add">إضافة</option>
                  <option value="subtract">خصم</option>
                  <option value="set">تصحيح (تعيين القيمة)</option>
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-600">
                {adjustTarget._op === 'set' ? 'القيمة الجديدة (وحدة أساسية)' : 'الكمية'}
                <input type="number" min="0" step="0.01" className={INPUT_CLASS + ' mt-1'}
                  value={adjustTarget._qty} onChange={e => setAdjustTarget({ ...adjustTarget, _qty: e.target.value })} required />
              </label>
              {adjustTarget._op !== 'set' ? (
                <label className="block text-xs font-bold text-slate-600">الوحدة
                  <select className={INPUT_CLASS + ' mt-1'} value={adjustTarget._unit}
                    onChange={e => setAdjustTarget({ ...adjustTarget, _unit: e.target.value })}>
                    {sellOptions(adjustTarget).map(opt => (
                      <option key={opt.unit} value={opt.unit}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-slate-500">التصحيح بالوحدة الأساسية ({baseUnitLabel(adjustTarget.unit_type)}) ولا يمكن أن يكون سلبيًا.</p>
              )}
              {renderModalError()}
              <button type="submit" disabled={modalBusy || adjustTarget._qty === ''}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-xl text-sm disabled:opacity-50">
                {modalBusy ? 'جاري التنفيذ...' : 'تنفيذ'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}