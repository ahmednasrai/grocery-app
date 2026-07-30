import React, { useState, useEffect } from 'react'
import { supabase } from '../services/supabaseClient'
import { ShoppingCart, User, Search, CheckCircle, Trash2, Plus, Minus } from 'lucide-react'

export default function EmployeePOS() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [selectedStaff, setSelectedStaff] = useState('مريم') // الموظفة الافتراضية
  const [loading, setLoading] = useState(false)

  // قائمة أسماء الموظفات في المحل
  const staffMembers = ['مريم', 'فاطمة', 'عائشة', 'كاشير عام']

  // جلب المنتجات من الداتابيز
  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    const { data, error } = await supabase.from('products').select('*')
    if (!error) setProducts(data || [])
  }

  // إضافة منتج للسلة
  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) {
      setCart(cart.map(item =>
        item.id === product.id ? { ...item, qty: item.qty + 1 } : item
      ))
    } else {
      setCart([...cart, { ...product, qty: 1 }])
    }
  }

  // تغيير كمية منتج في السلة
  const updateQty = (id, delta) => {
    setCart(cart.map(item => {
      if (item.id === id) {
        const newQty = item.qty + delta
        return newQty > 0 ? { ...item, qty: newQty } : item
      }
      return item
    }))
  }

  // حذف منتج من السلة
  const removeFromCart = (id) => {
    setCart(cart.filter(item => item.id !== id))
  }

  // حساب الإجمالي
  const totalAmount = cart.reduce((sum, item) => sum + (item.unit_price * item.qty), 0)

  // إتمام عملية البيع وخصم المخزون
  const handleCheckout = async () => {
    if (cart.length === 0) {
      alert('السلة فارغة!')
      return
    }

    setLoading(true)

    // 1. تسجيل الفاتورة باسم الموظفة المختارة
    const { data: saleData, error: saleError } = await supabase
      .from('sales')
      .insert([
        {
          employee_name: selectedStaff,
          total_amount: totalAmount
        }
      ])
      .select()

    if (saleError) {
      alert('حدث خطأ أثناء حفظ الفاتورة: ' + saleError.message)
      setLoading(false)
      return
    }

    const saleId = saleData[0].id

    // 2. تسجيل تفاصيل الفاتورة وخصم الكميات من المخزون
    for (const item of cart) {
      // تفاصيل الفاتورة
      await supabase.from('sale_items').insert([
        {
          sale_id: saleId,
          product_id: item.id,
          quantity: item.qty,
          unit_price: item.unit_price,
          subtotal: item.unit_price * item.qty
        }
      ])

      // خصم من المخزون الحالي
      const newStock = Math.max(0, item.stock_qty - item.qty)
      await supabase
        .from('products')
        .update({ stock_qty: newStock })
        .eq('id', item.id)
    }

    alert(`تم إتمام البيع بنجاح لحساب الموظفة (${selectedStaff})! 🎉`)
    setCart([])
    fetchProducts() // تحديث المنتجات بالكميات الجديدة
    setLoading(false)
  }

  // تصفية المنتجات حسب البحث
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-4 max-w-7xl mx-auto dir-rtl text-right" dir="rtl">
      
      {/* 1. شريط اختيار الموظفة */}
      <div className="bg-white p-4 rounded-xl shadow-sm border mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold text-gray-700">
          <User className="text-blue-600" />
          <span>الموظفة الحالية:</span>
        </div>
        <div className="flex gap-2">
          {staffMembers.map(name => (
            <button
              key={name}
              onClick={() => setSelectedStaff(name)}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition ${
                selectedStaff === name
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 2. قائمة المنتجات والبحث (ياخد ثلثين الشاشة) */}
        <div className="md:col-span-2 bg-white p-4 rounded-xl shadow-sm border">
          <div className="relative mb-4">
            <Search className="absolute right-3 top-3 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="إبحث عن منتج بالاسم..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-10 pl-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto p-1">
            {filteredProducts.map(product => (
              <div
                key={product.id}
                onClick={() => addToCart(product)}
                className="border p-3 rounded-lg hover:border-blue-500 hover:shadow-md cursor-pointer bg-gray-50 flex flex-col justify-between transition"
              >
                <div>
                  <h3 className="font-bold text-gray-800 text-sm mb-1">{product.name}</h3>
                  <p className="text-xs text-gray-500">المخزون: {product.stock_qty} قطعة</p>
                </div>
                <div className="mt-2 text-green-600 font-bold text-base">
                  {product.unit_price} ج.م
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. سلة الفاتورة الحالية (ياخد ثلث الشاشة) */}
        <div className="bg-white p-4 rounded-xl shadow-sm border flex flex-col justify-between h-[550px]">
          <div>
            <h2 className="font-bold text-lg border-b pb-2 mb-3 flex items-center gap-2">
              <ShoppingCart className="text-green-600" /> الفاتورة الحالية
            </h2>

            <div className="overflow-y-auto max-h-[350px] space-y-2">
              {cart.length === 0 ? (
                <p className="text-gray-400 text-center py-10">اضغط على المنتجات لإضافتها للسلة</p>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between border-b pb-2">
                    <div>
                      <div className="font-semibold text-sm">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.unit_price} × {item.qty} = {item.unit_price * item.qty} ج.م</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.id, -1)} className="p-1 bg-gray-100 rounded hover:bg-gray-200">
                        <Minus size={14} />
                      </button>
                      <span className="font-bold text-sm">{item.qty}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="p-1 bg-gray-100 rounded hover:bg-gray-200">
                        <Plus size={14} />
                      </button>
                      <button onClick={() => removeFromCart(item.id)} className="text-red-500 mr-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ملخص الإجمالي وزرار التأكيد */}
          <div className="border-t pt-3 mt-2">
            <div className="flex justify-between items-center text-lg font-bold mb-3">
              <span>إجمالي الفاتورة:</span>
              <span className="text-green-600">{totalAmount} ج.م</span>
            </div>

            <button
              onClick={handleCheckout}
              disabled={loading || cart.length === 0}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50 transition"
            >
              <CheckCircle size={20} />
              {loading ? 'جاري الحفظ...' : 'إتمام البيع (كاش)'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
