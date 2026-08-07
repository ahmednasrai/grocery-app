import React, { useState, useEffect } from 'react'
import { fetchSales, fetchProducts } from '../services/api'
import { DollarSign, ShoppingBag, AlertTriangle, Users, TrendingUp, Package } from 'lucide-react'
import { availabilityText } from '../utils/units'

export default function AdminDash() {
  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [lowStockProducts, setLowStockProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    setLoading(true)

    try {
      const [salesData, productsData] = await Promise.all([fetchSales(), fetchProducts()])
      const salesList = Array.isArray(salesData) ? salesData : []
      const productList = Array.isArray(productsData) ? productsData : []

      setSales(salesList)
      setProducts(productList.map(p => ({ ...p, stock: p.stock ?? p.stock_qty ?? 0, stock_qty: p.stock_qty ?? p.stock ?? 0 })))

      const lowStock = productList.filter(
        p => (p.stock_qty ?? p.stock ?? 0) < 10
      )
      setLowStockProducts(lowStock)
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  // حساب الحسابات التجميعية
  const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total_amount), 0)
  const totalTransactions = sales.length

  // تجميع المبيعات حسب الموظفات
  const staffSales = sales.reduce((acc, sale) => {
    const name = sale.employee_name || 'غير محدد'
    acc[name] = (acc[name] || 0) + Number(sale.total_amount)
    return acc
  }, {})

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto dir-rtl text-right" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center gap-2">
        <TrendingUp className="text-blue-600" /> Rushdy Mart | لوحة تحكم التاجر
      </h1>

      {loading ? (
        <p className="text-center py-10 text-sm sm:text-base">جاري تحميل البيانات الحية...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">إجمالي المبيعات</p>
                <h3 className="text-xl sm:text-2xl font-bold text-green-600">{totalRevenue.toFixed(2)} ج.م</h3>
              </div>
              <div className="p-3 bg-green-100 text-green-600 rounded-full">
                <DollarSign size={24} />
              </div>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">إجمالي عدد الفواتير</p>
                <h3 className="text-xl sm:text-2xl font-bold text-blue-600">{totalTransactions} فاتورة</h3>
              </div>
              <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
                <ShoppingBag size={24} />
              </div>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between sm:col-span-2 xl:col-span-1">
              <div>
                <p className="text-gray-500 text-sm mb-1">منتجات أوشكت على النفاد</p>
                <h3 className="text-xl sm:text-2xl font-bold text-red-600">{lowStockProducts.length} منتج</h3>
              </div>
              <div className="p-3 bg-red-100 text-red-600 rounded-full">
                <AlertTriangle size={24} />
              </div>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">إجمالي المنتجات</p>
                <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{products.length} منتج</h3>
              </div>
              <div className="p-3 bg-slate-100 text-slate-600 rounded-full">
                <Package size={24} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border">
              <h2 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2 border-b pb-2">
                <Users className="text-blue-600" /> مبيعات حسب الموظفات
              </h2>
              {Object.keys(staffSales).length === 0 ? (
                <p className="text-gray-400 text-center py-4">لا توجد مبيعات مسجلة بعد</p>
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
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border">
              <h2 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2 border-b pb-2 text-red-600">
                <AlertTriangle /> نواقص المخزون (أقل من 10 قطع)
              </h2>
              {lowStockProducts.length === 0 ? (
                <p className="text-green-600 font-semibold text-center py-4">جميع المنتجات متوفرة بمخزون جيد 👍</p>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {lowStockProducts.map(p => (
                    <div key={p.id} className="flex justify-between items-center bg-red-50 p-2.5 rounded-lg border border-red-100">
                      <span className="font-semibold text-gray-800">{p.name}</span>
                      <span className="bg-red-600 text-white text-xs px-2.5 py-1 rounded-full font-bold">
                        متبقي {availabilityText(p)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <h2 className="text-base sm:text-lg font-bold p-4 border-b bg-gray-50">آخر الفواتير المسجلة</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b text-gray-600 text-sm">
                    <th className="p-3">رقم الفاتورة</th>
                    <th className="p-3">اسم الموظفة</th>
                    <th className="p-3">المبلغ الإجمالي</th>
                    <th className="p-3">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.slice(0, 10).map(s => (
                    <tr key={s.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-bold text-gray-700">#{s.id}</td>
                      <td className="p-3">{s.employee_name}</td>
                      <td className="p-3 text-green-600 font-bold">{Number(s.total_amount).toFixed(2)} ج.م</td>
                      <td className="p-3 text-gray-500 text-sm">
                        {new Date(s.created_at).toLocaleString('ar-EG')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
