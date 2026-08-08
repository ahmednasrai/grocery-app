import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchSales, fetchProducts, fetchEmployeeSalesSummary, fetchSaleDetail, createSaleReturn } from '../services/api'
import { DollarSign, ShoppingBag, AlertTriangle, Users, TrendingUp, Package, RefreshCw, PackageX, ArrowDownToLine, Receipt, Undo2, XCircle } from 'lucide-react'
import { availabilityText, stockStatusBadge, stockStatusTone, baseUnitLabel, unitLabel } from '../utils/units'
import { useAuth } from '../context/AuthContext'
import EmployeeSalesModal from '../components/EmployeeSalesModal'
import SaleDetailsModal from '../components/SaleDetailsModal'
import LowStockAlert from '../components/LowStockAlert'

const EMPLOYEE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b']
const POLL_INTERVAL_MS = 20000

const FILTERS = [
  { key: 'today', label: 'اليوم' },
  { key: '7d', label: 'آخر 7 أيام' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'all', label: 'كل المبيعات' },
]

function rangeFor(filter) {
  const now = new Date()
  if (filter === 'today') {
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  if (filter === '7d') {
    const from = new Date(now)
    from.setDate(from.getDate() - 6)
    from.setHours(0, 0, 0, 0)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  if (filter === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.toISOString(), to: now.toISOString() }
  }
  return {}
}

function SectionBox({ title, icon: Icon, tone = 'text-blue-600', children, error, ready = true }) {
  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border">
      <h2 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2 border-b pb-2">
        <Icon className={tone} size={20} /> {title}
      </h2>
      {error ? (
        <p className="text-red-500 text-center py-6 text-sm">تعذر تحميل البيانات: {error}</p>
      ) : !ready ? (
        <p className="text-slate-400 text-center py-6 text-sm">جاري تحميل البيانات...</p>
      ) : children}
    </div>
  )
}

export default function AdminDash() {
  const { profile, hasPermission } = useAuth()
  const canReturn = profile?.role === 'admin' || hasPermission('inventory')
  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [summary, setSummary] = useState({ total_amount: 0, invoice_count: 0, units_sold: 0, employees: [] })
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [errors, setErrors] = useState({ sales: '', products: '', summary: '' })
  const [detailEmployee, setDetailEmployee] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [returnModal, setReturnModal] = useState(null)
  const [detailSale, setDetailSale] = useState(null)
  const mountedRef = useRef(true)

  const fetchDashboardData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const range = rangeFor(filter)
    const settled = await Promise.all([
      fetchSales(range).then(d => ['ok', d]).catch(e => ['err', e]),
      fetchProducts().then(d => ['ok', d]).catch((e) => ['err', e]),
      fetchEmployeeSalesSummary(range).then(d => ['ok', d]).catch(e => ['err', e]),
    ])
    if (!mountedRef.current) return
    const [salesStatus, salesData] = settled[0]
    const [productsStatus, productsRaw] = settled[1]
    const [summaryStatus, summaryData] = settled[2]
    setErrors({
      sales: salesStatus === 'err' ? salesData.message : '',
      products: productsStatus === 'err' ? productsRaw.message : '',
      summary: summaryStatus === 'err' ? summaryData.message : '',
    })
    if (salesStatus === 'ok') setSales(Array.isArray(salesData) ? salesData.slice() : [])
    if (productsStatus === 'ok') setProducts(Array.isArray(productsRaw) ? productsRaw.slice() : [])
    if (summaryStatus === 'ok') setSummary(summaryData || { total_amount: 0, invoice_count: 0, units_sold: 0, employees: [] })
    setLastUpdated(new Date())
    if (!silent) setLoading(false)
  }, [filter])

  useEffect(() => {
    mountedRef.current = true
    fetchDashboardData()
    const poll = setInterval(() => fetchDashboardData(true), POLL_INTERVAL_MS)
    const onFocus = () => fetchDashboardData(true)
    window.addEventListener('focus', onFocus)
    return () => {
      mountedRef.current = false
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchDashboardData])

  useEffect(() => {
    if (refreshTick > 0) fetchDashboardData(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  const lowStockProducts = products.filter(p => p.is_active !== false && p.stock_status === 'low')
  const outOfStockProducts = products.filter(p => p.is_active !== false && p.stock_status === 'out')
  const alertProducts = [...lowStockProducts, ...outOfStockProducts]
  const totalRevenue = summary.total_amount
  const totalTransactions = summary.invoice_count

  // ---------------- Returns (إرجاع المبيعات) ----------------
  const returnUnitChoices = (item) => {
    if (item.unit_type === 'carton') return [{ unit: 'carton', label: 'كرتونة' }, { unit: 'piece', label: 'قطعة' }]
    if (item.unit_type === 'sack') return [{ unit: 'sack', label: 'شكارة' }, { unit: 'kg', label: 'كجم' }]
    return [{ unit: item.unit_type, label: unitLabel(item.unit_type) }]
  }

  const basePerUnit = (item, unit) =>
    unit === 'carton' ? item.pieces_per_carton || 1 : unit === 'sack' ? item.kg_per_sack || 1 : 1

  const openReturn = async (sale) => {
    try {
      const detail = await fetchSaleDetail(sale.id)
      const items = (detail.items || []).map(it => ({
        ...it,
        qty: '',
        unit: it.unit_type === 'carton' ? 'piece' : it.unit_type === 'sack' ? 'kg' : it.unit_type,
      }))
      setReturnModal({ saleId: sale.id, items, reason: '', busy: false, msg: null })
    } catch (err) {
      alert(`تعذر تحميل تفاصيل الفاتورة: ${err.message || 'حاول مرة أخرى'}`)
    }
  }

  const submitReturn = async () => {
    const modal = returnModal
    if (!modal || modal.busy) return
    const lines = modal.items
      .filter(it => it.qty !== '' && Number(it.qty) > 0)
      .map(it => ({ sale_item_id: it.id, qty: Number(it.qty), unit: it.unit }))
    if (lines.length === 0) {
      setReturnModal(m => ({ ...m, msg: 'أدخل كمية إرجاع لبند واحد على الأقل.' }))
      return
    }
    const over = modal.items.find(it => {
      const line = lines.find(l => l.sale_item_id === it.id)
      return line && line.qty * basePerUnit(it, line.unit) > it.remaining_base_qty
    })
    if (over) {
      setReturnModal(m => ({ ...m, msg: `${over.product_name}: الكمية أكبر من المتبقي للإرجاع (${over.remaining_base_qty} ${baseUnitLabel(over.unit_type)}).` }))
      return
    }
    setReturnModal(m => ({ ...m, busy: true, msg: null }))
    try {
      await createSaleReturn(modal.saleId, {
        items: lines,
        reason: modal.reason || null,
        client_request_id: crypto.randomUUID(),
        employee_name: profile?.email || null,
      })
      const detail = await fetchSaleDetail(modal.saleId)
      setSales(prev => prev.map(s => s.id === modal.saleId
        ? { ...s, return_status: detail.sale.return_status, returned_base_qty: detail.sale.returned_base_qty }
        : s))
      setReturnModal(null)
      fetchDashboardData(true)
    } catch (err) {
      setReturnModal(m => ({ ...m, busy: false, msg: err.message || 'فشل تسجيل الإرجاع' }))
    }
  }

  const toggleReturnUnit = (itemId, unit) => {
    setReturnModal(m => ({ ...m, items: m.items.map(it => it.id === itemId ? { ...it, unit } : it) }))
  }

  const setReturnQty = (itemId, value) => {
    setReturnModal(m => ({ ...m, items: m.items.map(it => it.id === itemId ? { ...it, qty: value } : it) }))
  }

  const returnStatusBadge = (status) => {
    if (status === 'full') return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-green-100 text-green-700">مرتجعة بالكامل</span>
    if (status === 'partial') return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">إرجاع جزئي</span>
    return <span className="text-slate-300">—</span>
  }

  const staffSales = (summary.employees || []).reduce((acc, emp) => {
    acc[emp.name] = emp.total_amount
    return acc
  }, {})

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto dir-rtl text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
          <TrendingUp className="text-blue-600" /> Rushdy Mart | لوحة تحكم التاجر
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-xl border shadow-sm">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            className="px-3 py-1.5 rounded-xl border bg-white text-slate-600 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-50 transition"
            title="تحديث فوري"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {lastUpdated && !loading && (
        <p className="text-[11px] text-slate-400 mb-2">آخر تحديث تلقائي: {lastUpdated.toLocaleTimeString('ar-EG')} — يتم التحديث كل {POLL_INTERVAL_MS / 1000} ثانية</p>
      )}

      {Object.values(errors).some(Boolean) && !loading && (
        <div className="p-3 mb-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">
          بعض الأقسام فشل تحميلها وسيُعاد إعادة المحاولة تلقائيًا. {errors.sales || errors.products || errors.summary}
        </div>
      )}

      {loading ? (
        <p className="text-center py-10 text-sm sm:text-base text-slate-400">جاري تحميل البيانات الحية...</p>
      ) : (
        <>
          <div className="mb-6 sm:mb-8">
            <LowStockAlert
              lowStock={alertProducts}
              onRefresh={() => fetchDashboardData(true)}
              summary={`${alertProducts.length} منتج بحالة مخزون منخفض أو نافد (حسب الحد الأدنى لكل منتج)`}
              defaultExpanded={false}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">إجمالي الإيرادات</p>
                <h3 className="text-xl sm:text-2xl font-bold text-green-600">{totalRevenue.toFixed(2)} ج.م</h3>
              </div>
              <div className="p-3 bg-green-100 text-green-600 rounded-full"><DollarSign size={24} /></div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">عدد الفواتير</p>
                <h3 className="text-xl sm:text-2xl font-bold text-blue-600">{totalTransactions} فاتورة</h3>
              </div>
              <div className="p-3 bg-blue-100 text-blue-600 rounded-full"><ShoppingBag size={24} /></div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">تنبيهات المخزون (منخفض/نافد)</p>
                <h3 className={`text-xl sm:text-2xl font-bold ${alertProducts.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{alertProducts.length} منتج</h3>
              </div>
              <div className="p-3 bg-red-100 text-red-600 rounded-full"><PackageX size={24} /></div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">إجمالي المنتجات</p>
                <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{products.length} منتج</h3>
              </div>
              <div className="p-3 bg-slate-100 text-slate-600 rounded-full"><Package size={24} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <SectionBox title="مبيعات الموظفين" icon={Users} error={errors.summary}
              ready={!loading && !errors.summary}>
              {summary.employees.length === 0 ? (
                <p className="text-gray-400 text-center py-4">لا توجد مبيعات مسجلة في هذه الفترة</p>
              ) : (
                <div className="space-y-2">
                  {summary.employees.map((emp, idx) => {
                    const max = (summary.employees[0]?.total_amount || 1)
                    const pctBar = emp.total_amount / max * 100
                    return (
                      <button
                        key={emp.name}
                        onClick={() => setDetailEmployee(emp.name)}
                        className="w-full bg-gray-50 hover:bg-blue-50 p-3 rounded-lg transition text-right"
                      >
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-gray-800 flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EMPLOYEE_COLORS[idx] }} />
                            {emp.name}
                          </span>
                          <span className="font-bold text-green-600">{emp.total_amount.toFixed(2)} ج.م</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-500 mt-1">
                          <span>{emp.invoice_count} فاتورة • {emp.units_sold} وحدة أساسية</span>
                          <span className="font-bold text-blue-600">{emp.percentage.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-200 rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, pctBar)}%` }} />
                        </div>
                      </button>
                    )
                  })}
                  <div className="flex justify-between items-center text-xs text-gray-500 pt-2 border-t">
                    <span>الإجمالي (المجموع = 100%)</span>
                    <span className="font-bold text-gray-800">{summary.total_amount.toFixed(2)} ج.م — {summary.invoice_count} فاتورة</span>
                  </div>
                </div>
              )}
            </SectionBox>

            <SectionBox title="نسبة مساهمة الموظفين" icon={Users} error={errors.summary}>
              {summary.employees.length === 0 ? (
                <p className="text-gray-400 text-center py-8">لا توجد بيانات لعرض النسب</p>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="relative w-40 h-40 mx-auto shrink-0">
                    <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
                      {buildDonutSegments(summary.employees, EMPLOYEE_COLORS).map(seg => (
                        <circle key={seg.name} cx="80" cy="80" r="60" fill="none" stroke={seg.color} strokeWidth="26" strokeDasharray={`${seg.dash} ${seg.gap}`} strokeDashoffset={seg.offset} strokeLinecap="butt" />
                      ))}
                      <circle cx="80" cy="80" r="38" fill="white" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                      <span className="text-lg font-black text-slate-800">{summary.total_amount.toFixed(0)}</span>
                      <span className="text-[10px] text-slate-400">ج.م</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 w-full">
                    {summary.employees.map((emp, i) => (
                      <div key={emp.name} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-gray-700 font-semibold">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: EMPLOYEE_COLORS[i % EMPLOYEE_COLORS.length] }} />
                          {emp.name}
                        </span>
                        <span className="font-bold text-gray-800">{emp.percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionBox>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <SectionBox title="مبيعات حسب الموظفات (قيم مرصدة)" icon={Users}>
              {Object.keys(staffSales).length === 0 ? (
                <p className="text-gray-400 text-center py-4">لا توجد مبيعات مسجلة في هذه الفترة</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(staffSales).map(([staff, amount]) => (
                    <div key={staff} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                      <span className="font-semibold text-gray-700">{staff}</span>
                      <span className="font-bold text-green-600">{amount.toFixed(2)} ج.م</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionBox>

            <SectionBox title="تنبيهات المخزون" icon={AlertTriangle} tone="text-red-600" error={errors.products}>
              {alertProducts.length === 0 ? (
                <p className="text-green-600 font-semibold text-center py-4">جميع المنتجات متوفرة بمخزون جيد 👍</p>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto">
                  {alertProducts.map(p => (
                    <div key={p.id} className={`p-2.5 rounded-lg border ${p.stock_status === 'out' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                          {p.stock_status === 'out' ? <PackageX size={15} className="text-red-500" /> : <ArrowDownToLine size={15} className="text-amber-500" />}
                          {p.name}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${stockStatusTone(p.stock_status)}`}>
                          {stockStatusBadge(p.stock_status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1.5 text-xs text-slate-600 flex-wrap">
                        <span>المتاح: <b className="text-slate-800">{availabilityText(p)}</b></span>
                        <span>الحد الأدنى: <b className="text-slate-800">{p.minimum_stock} {baseUnitLabel(p.unit_type)}</b></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBox>
          </div>

          <SectionBox
            title="آخر الفواتير المسجلة"
            icon={Receipt}
            error={errors.sales}
          >
            {sales.length === 0 ? (
              <p className="text-gray-400 text-center py-4">لا توجد فواتير في هذه الفترة</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-right border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b text-gray-600 text-sm">
                      <th className="p-3">رقم الفاتورة</th>
                      <th className="p-3">اسم الموظفة</th>
                      <th className="p-3">المبلغ الإجمالي</th>
                      <th className="p-3">التاريخ والوقت</th>
                      <th className="p-3">حالة الإرجاع</th>
                      {canReturn && <th className="p-3">إجراء</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, 10).map(s => (
                      <tr
                        key={s.id}
                        onClick={() => setDetailSale(s)}
                        className="border-b hover:bg-indigo-50/40 cursor-pointer transition"
                      >
                        <td className="p-3 font-bold text-gray-700">#{s.id}</td>
                        <td className="p-3">{s.employee_name}</td>
                        <td className="p-3">
                          <div className="text-green-600 font-bold">{Number(s.total_amount).toFixed(2)} ج.م</div>
                          {Number(s.returned_amount || 0) > 0 && (
                            <div className="text-[11px] text-slate-500">
                              صافي بعد الإرجاع: <b className="text-slate-700">{Number(s.net_total || 0).toFixed(2)} ج.م</b>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-gray-500 text-sm">
                          {s.created_at ? new Date(s.created_at).toLocaleString('ar-EG') : '—'}
                        </td>
                        <td className="p-3">{returnStatusBadge(s.return_status)}</td>
                        {canReturn && (
                          <td className="p-3">
                            {s.return_status !== 'full' ? (
                              <button
                                onClick={e => { e.stopPropagation(); openReturn(s) }}
                                disabled={returnModal !== null}
                                className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 hover:bg-blue-100 transition disabled:opacity-40 flex items-center gap-1"
                              >
                                <Undo2 size={13} /> إرجاع
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionBox>
        </>
      )}

      {detailEmployee && (
        <EmployeeSalesModal
          employeeName={detailEmployee}
          range={rangeFor(filter)}
          onClose={() => setDetailEmployee(null)}
        />
      )}

      {detailSale && (
        <SaleDetailsModal sale={detailSale} onClose={() => setDetailSale(null)} />
      )}

      {returnModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !returnModal.busy && setReturnModal(null)}>
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-base flex items-center gap-2">
                <Undo2 size={18} className="text-blue-600" /> إرجاع مبيعات — فاتورة #{returnModal.saleId}
              </h3>
              <button onClick={() => setReturnModal(null)} disabled={returnModal.busy} className="text-slate-400 hover:text-slate-600">
                <XCircle size={20} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {returnModal.items.map(it => (
                <div key={it.id} className="p-3 bg-slate-50 rounded-xl border">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-bold text-slate-800">{it.product_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        مباع: {it.quantity} {unitLabel(it.selling_unit || it.unit_type)}
                        {it.base_qty > 0 ? ` (${it.base_qty} ${baseUnitLabel(it.unit_type)})` : ''}
                        {' • '}مرتجع: {it.returned_base_qty} {baseUnitLabel(it.unit_type)}
                        {' • '}متبقي: <b className="text-blue-700">{it.remaining_base_qty} {baseUnitLabel(it.unit_type)}</b>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={it.unit}
                        onChange={e => toggleReturnUnit(it.id, e.target.value)}
                        className="px-2 py-1.5 rounded-lg border bg-white text-xs font-bold text-slate-700"
                      >
                        {returnUnitChoices(it).map(opt => (
                          <option key={opt.unit} value={opt.unit}>{opt.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.qty}
                        placeholder={`الحد الأقصى ${Math.floor(it.remaining_base_qty / basePerUnit(it, it.unit))} ${unitLabel(it.unit)}`}
                        onChange={e => setReturnQty(it.id, e.target.value)}
                        className="w-28 px-2 py-1.5 rounded-lg border bg-white text-sm"
                      />
                    </div>
                  </div>
                  {it.qty !== '' && Number(it.qty) > 0 && (
                    <p className="text-[11px] text-blue-600 mt-1.5 font-bold">
                      = {Number(it.qty) * basePerUnit(it, it.unit)} {baseUnitLabel(it.unit_type)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <input
              type="text"
              value={returnModal.reason}
              onChange={e => setReturnModal(m => ({ ...m, reason: e.target.value }))}
              placeholder="سبب الإرجاع (اختياري)"
              className="w-full p-3 border rounded-xl bg-white text-sm mb-4"
            />

            {returnModal.msg && (
              <p className="p-3 mb-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{returnModal.msg}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={submitReturn}
                disabled={returnModal.busy}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {returnModal.busy ? 'جاري تسجيل الإرجاع...' : 'تأكيد الإرجاع واستعادة المخزون'}
              </button>
              <button
                onClick={() => setReturnModal(null)}
                disabled={returnModal.busy}
                className="px-5 py-3 rounded-xl border text-slate-600 text-sm font-bold hover:bg-slate-50 transition disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function buildDonutSegments(employees, colors) {
  const total = employees.reduce((sum, e) => sum + e.total_amount, 0)
  const C = 2 * Math.PI * 60
  let acc = 0
  return employees.map((emp, i) => {
    const frac = total > 0 ? emp.total_amount / total : 0
    const dash = frac * C
    const seg = { name: emp.name, color: colors[i % colors.length], dash, gap: C - dash, offset: acc }
    acc += dash
    return seg
  })
}