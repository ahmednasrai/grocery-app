const UNIT_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  g: 'جم',
  liter: 'لتر',
  ml: 'مل',
  carton: 'كرتونة',
  sack: 'شكارة',
};

const INVENTORY_QTY_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  g: 'جم',
  liter: 'لتر',
  ml: 'مل',
  carton: 'كرتونة',
  sack: 'شكارة',
};

const POS_QTY_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  g: 'جم',
  liter: 'لتر',
  ml: 'مل',
  carton: 'كرتونة',
  sack: 'شكارة',
};

export function unitLabel(unitType) {
  return UNIT_LABELS[unitType] || UNIT_LABELS.piece;
}

export function inventoryQtyLabel(unitType) {
  return INVENTORY_QTY_LABELS[unitType] || INVENTORY_QTY_LABELS.piece;
}

export function posQtyLabel(unitType) {
  return POS_QTY_LABELS[unitType] || POS_QTY_LABELS.piece;
}

export function unitDetailText(product) {
  if (!product) return null;
  if (product.unit_type === 'carton' && product.pieces_per_carton) {
    return `${product.pieces_per_carton} قطعة/كرتونة`;
  }
  if (product.unit_type === 'sack' && product.kg_per_sack) {
    return `${product.kg_per_sack} كجم/شكارة`;
  }
  return null;
}

// ---- Base-unit conversions (single source of truth) --------------------
// After migration 004, product.stock/stock_qty is ALWAYS in base units:
//   piece -> pieces | kg -> kilos | liter -> liters
//   carton -> pieces inside all cartons | sack -> kg inside all sacks

/** Capacity of a container in base units (1 for base-only products).
 * g/ml are commercial sub-units: 1 kg = 1000 g, 1 L = 1000 ml. */
export function containerCapacity(product, sellingUnit) {
  if (!product) return 1;
  if (sellingUnit === 'carton') return product.pieces_per_carton || 1;
  if (sellingUnit === 'sack') return product.kg_per_sack || 1;
  if (sellingUnit === 'g') return 0.001;
  if (sellingUnit === 'ml') return 0.001;
  return 1;
}

/** Selling-unit price: base price for piece/kg/liter, container price for carton/sack,
 * base price / 1000 for g/ml (price is per kg / per liter). */
export function priceFor(product, sellingUnit) {
  if (!product) return 0;
  const basePrice = product.price ?? product.unit_price ?? 0;
  if (sellingUnit === 'carton') {
    const stored = product.carton_price;
    return stored > 0 ? stored : basePrice * (product.pieces_per_carton || 1);
  }
  if (sellingUnit === 'sack') {
    const stored = product.sack_price;
    return stored > 0 ? stored : basePrice * (product.kg_per_sack || 1);
  }
  if (sellingUnit === 'g' || sellingUnit === 'ml') return basePrice * 0.001;
  return basePrice;
}

/** Whole numbers print without decimals (5, not 5.0); fractions keep 2 decimals. */
function fmtNum(value) {
  const number = Number(value) || 0;
  if (Number.isInteger(number)) return String(number);
  return String(Math.round(number * 100) / 100);
}

/** Convert a selling-unit quantity into base units (2 cartons -> 48 pieces,
 * 250 g -> 0.25 kg). Rounding only trims float noise (4 decimals). */
export function toBaseQty(product, sellingUnit, qty) {
  const base = qty * containerCapacity(product, sellingUnit);
  return Math.round(base * 10000) / 10000;
}

/** All valid selling units for a product: [{unit, label, price}]. */
export function sellOptions(product) {
  if (!product) return [];
  const base = { unit: product.unit_type, label: unitLabel(product.unit_type) };
  const options = [base];
  if (product.unit_type === 'carton') {
    options.push({ unit: 'piece', label: UNIT_LABELS.piece });
  }
  if (product.unit_type === 'sack') {
    options.push({ unit: 'kg', label: UNIT_LABELS.kg });
  }
  if (product.unit_type === 'kg') {
    options.push({ unit: 'g', label: UNIT_LABELS.g });
  }
  if (product.unit_type === 'liter') {
    options.push({ unit: 'ml', label: UNIT_LABELS.ml });
  }
  return options.map(o => ({ ...o, price: priceFor(product, o.unit) }));
}

/** Available base stock as human text, e.g. "216 قطعة (9 كراتين)" or "9.75 كجم". */
export function availabilityText(product) {
  if (!product) return '0';
  const base = product.stock ?? product.stock_qty ?? 0;
  if (product.unit_type === 'carton' && product.pieces_per_carton) {
    const full = Math.floor(base / product.pieces_per_carton);
    const rest = base % product.pieces_per_carton;
    if (full === 0) return `${fmtNum(rest)} قطعة`;
    if (rest === 0) return `${fmtNum(base)} قطعة (${full} كرتون)`;
    return `${fmtNum(base)} قطعة (${full} كرتون + ${fmtNum(rest)} قطعة)`;
  }
  if (product.unit_type === 'sack' && product.kg_per_sack) {
    const full = Math.floor(base / product.kg_per_sack);
    const rest = base % product.kg_per_sack;
    if (full === 0) return `${fmtNum(rest)} كجم`;
    if (rest === 0) return `${fmtNum(base)} كجم (${full} شكارة)`;
    return `${fmtNum(base)} كجم (${full} شكارة + ${fmtNum(rest)} كجم)`;
  }
  return `${fmtNum(base)} ${unitLabel(product.unit_type)}`;
}

/** Cart line subtotal: qty x unit price, rounded to 2 decimals. */
export function lineSubtotal(product, qty, sellingUnit) {
  return Math.round(qty * priceFor(product, sellingUnit) * 100) / 100;
}

// ---- Stock status (single rule shared by POS / Inventory / Dashboard) ----
// stock_status comes computed from the Backend (base-unit comparison vs
// minimum_stock). The labels below are presentation only.

export function baseUnitLabel(unitType) {
  if (unitType === 'carton') return UNIT_LABELS.piece;
  if (unitType === 'sack') return UNIT_LABELS.kg;
  return UNIT_LABELS[unitType] || UNIT_LABELS.piece;
}

export function stockStatusLabel(status) {
  if (status === 'out') return 'نفد المخزون';
  if (status === 'low') return 'المخزون منخفض';
  return 'متوفر';
}

export function stockStatusTone(status) {
  if (status === 'out') return 'bg-red-100 text-red-600';
  if (status === 'low') return 'bg-amber-100 text-amber-600';
  return 'bg-green-100 text-green-600';
}

export function stockStatusBadge(status) {
  const icon = status === 'out' ? '🔴' : status === 'low' ? '⚠' : '✔';
  return `${icon} ${stockStatusLabel(status)}`;
}