import React, { useState, useEffect } from 'react'
import { XCircle, ReceiptText } from 'lucide-react'
import { fetchSaleDetail } from '../services/api'
import { unitLabel } from '../utils/units'

function unitLine(item) {
  const qty = item.quantity
  const unit = item.selling_unit || item.unit_type
  const base = item.base_qty
  if (!unit) return String(qty)
  const baseLabel = unit === 'carton' ? 'قطعة' : unit === 'sack' ? 'كجم' : unitLabel(unit)
  if (base === null || base === undefined || base === 0) return `${qty} ${unitLabel(unit)}`
  return `${qty} ${unitLabel(unit)} — ${base === qty ? baseLabel : `${base} ${baseLabel} أساسية`}`
}

function ReturnStatusBadge({ status, returned }) {
  if (status === 'full')
    return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">مرتجعة بالكامل</span>
  if (status === 'partial')
    return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">إرجاع جزئي</span>
  if (returned > 0)
    return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">إرجاع جزئي</span>
  return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">بدون إرجاع</span>
}

export default function SaleDetailsModal({ sale, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const data = await fetchSaleDetail(sale.id)
        if (mounted) setDetail(data)
      } catch (err) {
        if (mounted) setError(err.message || 'تعذر تحميل تفاصيل الفاتورة')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [sale.id])

  const headerSale = detail ? detail.sale : sale
  const returnedAmount = Number(headerSale.returned_amount || 0)
  const netTotal = Number(headerSale.net_total ?? headerSale.total_amount ?? 0)
  const items = detail?.items || []

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 sm:p-5 border-b">
          <h3 className="font-black text-base sm:text-lg flex items-center gap-2">
            <ReceiptText size={20} className="text-blue-600" />
            تفاصيل الفاتورة #{headerSale.id}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <XCircle size={22} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-5 border-b bg-gray-50">
          <div>
            <p className="text-xs text-gray-500">الكاشير</p>
            <p className="font-bold text-slate-800">{headerSale.employee_name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">التاريخ والوقت</p>
            <p className="font-bold text-slate-800 text-sm">
              {headerSale.created_at ? new Date(headerSale.created_at).toLocaleString('ar-EG') : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">الإجمالي</p>
            <p className="font-black text-green-600">{Number(headerSale.total_amount || 0).toFixed(2)} ج.م</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">الصافي بعد الإرجاع</p>
            {returnedAmount > 0 ? (
              <>
                <p className="font-black text-indigo-600">{netTotal.toFixed(2)} ج.م</p>
                <p className="text-[11px] text-red-500">مرتجع: {returnedAmount.toFixed(2)} ج.م</p>
              </>
            ) : (
              <p className="font-black text-slate-700">{netTotal.toFixed(2)} ج.م</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">جاري تحميل تفاصيل الفاتورة...</div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-red-500">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">لا توجد أصناف في هذه الفاتورة</div>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 flex items-center justify-between border-b">
              <span className="text-xs font-bold text-slate-500">المنتجات المباعة</span>
              <ReturnStatusBadge status={headerSale.return_status} returned={returnedAmount} />
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm border-collapse">
                  <thead>
                    <tr className="text-slate-500 text-xs border-b">
                      <th className="p-2.5 text-right">المنتج</th>
                      <th className="p-2.5 text-right">الكمية المباعة</th>
                      <th className="p-2.5 text-right">الوحدة</th>
                      <th className="p-2.5 text-right">سعر الوحدة</th>
                      <th className="p-2.5 text-right">الإجمالي الفرعي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-700">{item.product_name}</td>
                        <td className="p-2.5 text-slate-600">{unitLine(item)}</td>
                        <td className="p-2.5 text-slate-600">{item.selling_unit ? unitLabel(item.selling_unit) : '—'}</td>
                        <td className="p-2.5 text-slate-600">{Number(item.unit_price || 0).toFixed(2)} ج.م</td>
                        <td className="p-2.5 font-bold text-slate-700">{Number(item.subtotal || 0).toFixed(2)} ج.م</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail?.returns?.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-bold text-slate-500 mb-2">سجل المرتجعات</p>
                  <div className="space-y-2">
                    {detail.returns.map(ret => (
                      <div key={ret.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-xl px-3 py-2 text-xs bg-red-50/40">
                        <span className="font-bold text-red-600">إرجاع #{ret.id}</span>
                        <span className="text-slate-500">
                          {ret.created_at ? new Date(ret.created_at).toLocaleString('ar-EG') : '—'} • {ret.employee_name || '—'}
                        </span>
                        <span className="font-bold text-slate-700">
                          {Number(ret.items?.reduce((s, i) => s + Number(i.amount || 0), 0) || 0).toFixed(2)} ج.م
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t pt-3">
                <span className="text-sm font-bold text-slate-500">إجمالي الفاتورة</span>
                <div className="text-left">
                  <p className="font-black text-green-600 text-lg">{Number(headerSale.total_amount || 0).toFixed(2)} ج.م</p>
                  {returnedAmount > 0 && (
                    <p className="text-xs text-slate-500">
                      الصافي بعد الإرجاع: <b className="text-indigo-600">{netTotal.toFixed(2)} ج.م</b>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}