import React, { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, PackageSearch, RefreshCw } from 'lucide-react';
import { fetchProducts } from '../services/api';
import { availabilityText } from '../utils/units';
import { useAuth } from '../context/AuthContext';

export const LOW_STOCK_THRESHOLD = 5;

const stockOf = (p) => Number(p.stock ?? p.stock_qty ?? 0);

/** Backend 'out' means zero stock; fall back to the stock==0 heuristic. */
const isOut = (p) => p.stock_status === 'out' || stockOf(p) === 0;

/** Fetches products and returns only those whose stock is below the threshold. */
export function useLowStockProducts(threshold = LOW_STOCK_THRESHOLD) {
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProducts();
      const list = Array.isArray(data) ? data : [];
      const normalized = list.map((p) => ({
        ...p,
        stock: p.stock ?? p.stock_qty ?? 0,
        stock_qty: p.stock_qty ?? p.stock ?? 0,
        unit_type: p.unit_type || 'piece',
      }));
      setLowStock(
        normalized
          .filter((p) => stockOf(p) < threshold)
          .sort((a, b) => stockOf(a) - stockOf(b)),
      );
    } catch (error) {
      console.error('Error loading low-stock products:', error);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { lowStock, loading, refresh };
}

/**
 * Prominent low-stock alert: animated warning icon, count badge and an
 * expandable Arabic list of products about to run out. Renders nothing
 * when the stock is healthy.
 *
 * Pass `lowStock` (+ optional `onRefresh`) to reuse an already-fetched list
 * (e.g. the dashboard's backend `stock_status` products) instead of fetching.
 */
export default function LowStockAlert(props) {
  if (props.lowStock !== undefined) {
    return (
      <LowStockAlertBody
        lowStock={props.lowStock}
        loading={props.loading ?? false}
        onRefresh={props.onRefresh}
        threshold={props.threshold}
        defaultExpanded={props.defaultExpanded}
        summary={props.summary}
      />
    );
  }
  return <LowStockAlertWithFetch {...props} />;
}

function LowStockAlertWithFetch({ threshold = LOW_STOCK_THRESHOLD, defaultExpanded = true, summary }) {
  const { lowStock, loading, refresh } = useLowStockProducts(threshold);
  return (
    <LowStockAlertBody
      lowStock={lowStock}
      loading={loading}
      onRefresh={refresh}
      threshold={threshold}
      defaultExpanded={defaultExpanded}
      summary={summary}
    />
  );
}

function LowStockAlertBody({
  lowStock,
  loading,
  onRefresh,
  threshold = LOW_STOCK_THRESHOLD,
  defaultExpanded = true,
  summary,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { hasPermission } = useAuth();
  const canViewInventory = hasPermission('inventory');

  if (loading && lowStock.length === 0) return null;
  if (lowStock.length === 0) return null;

  const outOfStockCount = lowStock.filter(isOut).length;
  const usesBackendStatus = lowStock.some(p => p.stock_status === 'low' || p.stock_status === 'out');
  const subtitle = summary
    ?? (usesBackendStatus
      ? `${lowStock.length} منتج بحالة مخزون منخفض أو نافد (حسب الحد الأدنى لكل منتج)`
      : `${lowStock.length} منتج أوشك على النفاد (المتبقي أقل من ${threshold} قطع)${outOfStockCount > 0 ? ` — منها ${outOfStockCount} منتج نافذ تماماً` : ''}`);

  return (
    <section
      dir="rtl"
      className="low-stock-alert rounded-2xl border-2 border-red-300 bg-red-50 shadow-md overflow-hidden"
    >
      <div className="flex items-center gap-2.5 sm:gap-3 p-3 sm:p-4">
        <span className="relative shrink-0">
          <AlertTriangle size={22} className="text-red-600 animate-pulse" />
          <span className="absolute -top-1.5 -left-1.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
        </span>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex-1 min-w-0 text-right"
          title={expanded ? 'إخفاء القائمة' : 'عرض القائمة'}
        >
          <span className="block font-black text-red-700 text-sm sm:text-base">تنبيه: مخزون منخفض!</span>
          <span className="block text-xs font-bold text-red-600/90">{subtitle}</span>
        </button>

        <span className="shrink-0 bg-red-600 text-white text-xs font-black px-2.5 py-1 rounded-full">
          {lowStock.length}
        </span>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title="تحديث حالة المخزون"
            className="shrink-0 p-1.5 rounded-lg text-red-500 hover:bg-red-100 transition"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        )}

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'إخفاء القائمة' : 'عرض القائمة'}
          className="shrink-0 p-1.5 rounded-lg text-red-400 hover:bg-red-100 transition"
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-red-200 px-3 sm:px-4 py-3">
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {lowStock.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 bg-white border border-red-100 rounded-xl px-3 py-2 text-sm"
              >
                <span className="font-bold text-slate-800 truncate">{p.name}</span>
                {isOut(p) ? (
                  <span className="shrink-0 bg-red-600 text-white text-[11px] font-black px-2.5 py-1 rounded-full">
                    نافذ تماماً
                  </span>
                ) : (
                  <span className="shrink-0 bg-amber-100 text-amber-700 text-[11px] font-black px-2.5 py-1 rounded-full">
                    متبقي {availabilityText(p)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {canViewInventory && (
            <NavLink
              to="/inventory"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-blue-600 hover:text-blue-700"
            >
              <PackageSearch size={14} /> الذهاب إلى المخزون وإعادة التوريد
            </NavLink>
          )}
        </div>
      )}
    </section>
  );
}
