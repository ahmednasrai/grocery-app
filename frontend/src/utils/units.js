const UNIT_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  liter: 'لتر',
  carton: 'كرتونة',
  sack: 'شكارة',
};

const INVENTORY_QTY_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  liter: 'لتر',
  carton: 'كرتونة',
  sack: 'شكارة',
};

const POS_QTY_LABELS = {
  piece: 'قطعة',
  kg: 'كجم',
  liter: 'لتر',
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

/** Capacity of a container in base units (1 for base-only products). */
export function containerCapacity(product, sellingUnit) {
  if (!product) return 1;
  if (sellingUnit === 'carton') return product.pieces_per_carton || 1;
  if (sellingUnit === 'sack') return product.kg_per_sack || 1;
  return 1;
}

/** Selling-unit price: base price for piece/kg/liter, container price for carton/sack. */
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
  return basePrice;
}

/** Convert a selling-unit quantity into base units (e.g. 2 cartons -> 48 pieces). */
export function toBaseQty(product, sellingUnit, qty) {
  return Math.round(qty * containerCapacity(product, sellingUnit));
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
  return options.map(o => ({ ...o, price: priceFor(product, o.unit) }));
}

/** Available base stock as human text, e.g. "216 قطعة (9 كراتين)". */
export function availabilityText(product) {
  if (!product) return '0';
  const base = product.stock ?? product.stock_qty ?? 0;
  if (product.unit_type === 'carton' && product.pieces_per_carton) {
    const full = Math.floor(base / product.pieces_per_carton);
    const rest = base % product.pieces_per_carton;
    if (full === 0) return `${rest} قطعة`;
    if (rest === 0) return `${base} قطعة (${full} كرتون)`;
    return `${base} قطعة (${full} كرتون + ${rest} قطعة)`;
  }
  if (product.unit_type === 'sack' && product.kg_per_sack) {
    const full = Math.floor(base / product.kg_per_sack);
    const rest = base % product.kg_per_sack;
    if (full === 0) return `${base} كجم`;
    if (rest === 0) return `${base} كجم (${full} شكارة)`;
    return `${base} كجم (${full} شكارة + ${rest} كجم)`;
  }
  return `${base} ${unitLabel(product.unit_type)}`;
}

/** Cart line subtotal: qty x unit price, rounded to 2 decimals. */
export function lineSubtotal(product, qty, sellingUnit) {
  return Math.round(qty * priceFor(product, sellingUnit) * 100) / 100;
}