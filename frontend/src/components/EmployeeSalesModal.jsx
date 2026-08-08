import React, { useState, useEffect } from 'react'
import { XCircle } from 'lucide-react'
import { fetchEmployeeSalesDetail } from '../services/api'
import { unitLabel } from '../utils/units'

function unitLine(item) {
  const unit = item.selling_unit
  const qty = item.quantity
  const base = item.base_qty
  if (!unit) return String(qty)
  const baseLabel = unit === 'carton' ? 'قطعة أساسية' : unit === 'sack' ? 'كجم أساسي' : unitLabel(unit)
  if (base === null || base === undefined || base === 0) return `${qty} ${unitLabel(unit)}`
  return `${qty} ${unitLabel(unit)} — ${base} ${baseLabel}`
}

export default function EmployeeSalesModal({ employeeName, range, onClose }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const data = await fetchEmployeeSalesDetail(employeeName, range)
        if (mounted) setDetail(data)
      } catch (err) {
        if (mounted) setError(err.message || 'تعذر تحميل البيانات')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [employeeName, JSON.stringify(range)])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 sm:p-5 border-b">
          <h3 className="font-black text-base sm:text-lg flex items-center gap-2">
            تفاصيل مبيعات الموظف — {employeeName}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><XCircle size={22} /></button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">جاري تحميل التفاصيل...</div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-red-500">{error}</div>
        ) : !detail ? (
          <div className="p-10 text-center text-sm text-slate-400">لا توجد بيانات</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-5 border-b bg-gray-50">
              <div>
                <p className="text-xs text-gray-500">إجمالي المبيعات</p>
                <p className="font-black text-green-600">{detail.total_amount.toFixed(2)} ج.م</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">عدد الفواتير</p>
                <p className="font-black text-blue-600">{detail.invoice_count} فاتورة</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">إجمالي الكميات المباعة</p>
                <p className="font-black text-slate-700">{detail.units_sold} وحدة أساسية</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">متوسط قيمة الفاتورة</p>
                <p className="font-black text-indigo-600">{detail.avg_invoice.toFixed(2)} ج.م</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {detail.sales.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">لا توجد فواتير في هذه الفترة</p>
              ) : (
                <div className="space-y-5">
                  {detail.sales.map(sale => (
                    <div key={sale.id} className="border rounded-xl overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-bold text-slate-700">فاتورة #{sale.id}</span>
                        <span className="text-slate-500">
                          {sale.created_at ? new Date(sale.created_at).toLocaleString('ar-EG') : '—'}
                        </span>
                        <span className="font-bold text-green-600">{Number(sale.total_amount).toFixed(2)} ج.م</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-sm border-collapse">
                          <thead>
                            <tr className="text-slate-500 text-xs border-b">
                              <th className="p-2.5 text-right">المنتج</th>
                              <th className="p-2.5 text-right">الكمية</th>
                              <th className="p-2.5 text-right">السعر</th>
                              <th className="p-2.5 text-right">الإجمالي</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {sale.items.map((item, idx) => (
                              <tr key={idx}>
                                <td className="p-2.5 font-semibold text-slate-700">{item.product_name}</td>
                                <td className="p-2.5 text-slate-600">{unitLine(item)}</td>
                                <td className="p-2.5 text-slate-600">{Number(item.unit_price).toFixed(2)} ج.م</td>
                                <td className="p-2.5 font-bold text-slate-700">{Number(item.subtotal).toFixed(2)} ج.م</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}