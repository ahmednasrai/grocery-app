import json
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.database import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()

INSUFFICIENT_PREFIX = "insufficient_stock:"
PRODUCT_NOT_FOUND_PREFIX = "product_not_found:"
INVALID_QUANTITY = "invalid_quantity"
RETURN_EXCEEDS_PREFIX = "return_exceeds:"


def _parallel(calls: list[tuple[str, callable]]) -> dict:
    """Run independent PostgREST reads concurrently. The shared httpx client
    is thread-safe, and the live backend connects with keep-alive, so the
    wall time of a dashboard endpoint becomes ~the slowest query instead of
    the sum of all sequential round trips."""
    with ThreadPoolExecutor(max_workers=len(calls)) as executor:
        futures = {name: executor.submit(fn) for name, fn in calls}
        return {name: fut.result() for name, fut in futures.items()}


class SaleItem(BaseModel):
    id: int
    qty: float = Field(gt=0)
    price: float | None = None
    selling_unit: str | None = None


class SaleCreate(BaseModel):
    cashier_name: str = Field(min_length=1)
    items: list[SaleItem] = Field(min_items=1)
    client_request_id: str | None = None


class ReturnLine(BaseModel):
    sale_item_id: int
    qty: float = Field(gt=0)
    unit: str | None = None


class ReturnCreate(BaseModel):
    items: list[ReturnLine] = Field(min_items=1)
    reason: str | None = None
    employee_name: str | None = None
    client_request_id: str | None = None


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _extract_error_message(exc: Exception) -> str:
    """Pull the RPC error message out of a RuntimeError raised by the pg client."""
    text = str(exc)
    for start_char in ("[", "{"):
        try:
            start = text.find(start_char)
            if start == -1:
                continue
            end = text.rfind("]" if start_char == "[" else "}") + 1
            payload = json.loads(text[start:end])
            if isinstance(payload, list) and payload:
                payload = payload[0]
            if isinstance(payload, dict):
                msg = payload.get("message") or payload.get("detail")
                if msg:
                    return str(msg)
        except (ValueError, TypeError):
            continue
    return text


def _is_schema_missing(exc: Exception) -> bool:
    """True only for PostgREST 'the schema does not exist yet' style errors:
    missing column (42703 / PGRST204) or missing table (PGRST205).
    Everything else must surface - no silent fallbacks for real bugs."""
    text = str(exc)
    return (
        "PGRST205" in text
        or "PGRST204" in text
        or "42703" in text
        or "does not exist" in text
    )


_schema_cache: dict[str, tuple[bool, bool] | None] = {}


def _schema_flags(supabase) -> tuple[bool, bool]:
    """Probe THIS database for the Returns v2 schema pieces.
    Live DB has NOT run migration 008 yet, so `returned_amount` and the
    `returns`/`return_items` tables may be absent - analytics must degrade
    gracefully in that case instead of returning 500 / zeros.
    Once 008 is applied, both probes succeed and the full paths activate
    automatically (no code change needed).

    The result is cached per Supabase project (real clients carry `_base`;
    test fakes don't, so tests always re-probe and stay deterministic).
    """
    base = getattr(supabase, "_base", None)
    if base is not None and _schema_cache.get(base) is not None:
        return _schema_cache[base]

    has_amount = True
    has_returns = True
    try:
        supabase.table("sales").select("returned_amount").execute()
    except Exception as exc:
        if not _is_schema_missing(exc):
            raise
        has_amount = False
    try:
        supabase.table("returns").select("id").execute()
    except Exception as exc:
        if not _is_schema_missing(exc):
            raise
        has_returns = False
    if base is not None:
        _schema_cache[base] = (has_amount, has_returns)
    return has_amount, has_returns


def _available_qty(message: str):
    """Parse 'insufficient_stock:<pid>:<available>' -> (product_id, available).
    Available may be fractional (kg/liter base stock)."""
    try:
        _, pid, available = message.split(":", 2)
        return int(pid), float(available)
    except (ValueError, TypeError):
        return None, None


def _fmt_qty(value) -> str:
    """Whole numbers print without decimals (5, not 5.0)."""
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else f"{number:g}"
    except (ValueError, TypeError):
        return "؟"


@router.get("/api/sales")
def list_sales(
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    limit: int | None = Query(default=None, ge=1, le=200),
    _profile: dict = Depends(require_permission("reports")),
):
    supabase = get_supabase_client()
    from_date = _parse_date(from_date, "from")
    to_date = _parse_date(to_date, "to")
    try:
        has_amount, has_returns = _schema_flags(supabase)
        sales_task = lambda: supabase.table("sales").select("*").order("created_at", desc=True).execute()
        if limit is not None:
            # Server-side cap: the dashboard shows only the newest N invoices.
            # Safe to apply unconditionally for the unlimited ('all') view
            # because the newest N rows ARE the ones the frontend slices to.
            # When date filters are present the frontend omits `limit`, so
            # period views keep fetching their full (small) window.
            sales_task = lambda: supabase.table("sales").select("*").order("created_at", desc=True).limit(limit).execute()
        tasks = [
            ("sales", sales_task),
            ("sale_items", lambda: supabase.table("sale_items").select("sale_id,base_qty").execute()),
        ]
        if has_returns:
            tasks += [
                ("returns", lambda: supabase.table("returns").select("id,sale_id").execute()),
                ("return_items", lambda: supabase.table("return_items").select("return_id,base_qty").execute()),
            ]
        fetched = _parallel(tasks)
        sales_rows = getattr(fetched["sales"], "data", None) or []
        if from_date is not None or to_date is not None:
            sales_rows = [s for s in sales_rows if _within_range(s, from_date, to_date)]
        sold_by_sale = _sold_base_map(fetched["sale_items"])
        returned_by_sale = _return_map_from_row(fetched.get("returns"), fetched.get("return_items")) if has_returns else {}
        for sale in sales_rows:
            sale_id = sale["id"]
            returned = returned_by_sale.get(sale_id, 0.0)
            sold = sold_by_sale.get(sale_id, 0.0)
            status = "none"
            if returned > 0:
                status = "full" if sold > 0 and returned >= sold else "partial"
            sale["return_status"] = status
            sale["returned_base_qty"] = returned
            returned_amount = float(sale.get("returned_amount") or 0) if has_amount else 0.0
            sale["returned_amount"] = returned_amount
            sale["net_total"] = round(max(0.0, float(sale.get("total_amount") or 0) - returned_amount), 2)
        return sales_rows
    except Exception as exc:
        logger.warning("Unable to fetch sales: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to fetch sales") from exc


def _sold_base_map(resp) -> dict[int, float]:
    """sale_id -> total sold base qty (for full/partial return detection)."""
    sold: dict[int, float] = defaultdict(float)
    for item in getattr(resp, "data", None) or []:
        sale_id = item.get("sale_id")
        if sale_id is not None:
            sold[sale_id] += float(item.get("base_qty") or item.get("quantity") or 0)
    return sold


def _return_map_from_row(returns_resp, items_resp) -> dict[int, float]:
    """sale_id -> returned base qty, from already-fetched rows (no extra queries)."""
    returned_by_sale: dict[int, float] = defaultdict(float)
    returns_rows = getattr(returns_resp, "data", None) or []
    items_rows = getattr(items_resp, "data", None) or []
    return_of = {r["id"]: r.get("sale_id") for r in returns_rows if r.get("id") is not None}
    for item in items_rows:
        sale_id = return_of.get(item.get("return_id"))
        if sale_id is not None:
            returned_by_sale[sale_id] += float(item.get("base_qty") or 0)
    return returned_by_sale


def _load_return_map(supabase):
    """Map sale_id -> returned base qty, from the real returns data (no joins,
    tables are small; python-side grouping mirrors the employee-summary code).
    Only PGRST schema-missing errors degrade to {}; any other failure raises
    so real bugs are never hidden."""
    try:
        returns_resp = supabase.table("returns").select("id,sale_id").execute()
        items_resp = supabase.table("return_items").select("return_id,base_qty").execute()
        return _return_map_from_row(returns_resp, items_resp)
    except Exception as exc:
        if not _is_schema_missing(exc):
            raise
        logger.warning("Return summary skipped (returns tables not present yet): %s", exc)
    return {}


def _parse_date(value: str | None, name: str):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} يجب أن يكون تاريخًا صالحًا (ISO 8601)") from None


def _as_utc_naive(value) -> datetime:
    """Normalize a timestamp (PostgREST returns tz-aware UTC strings, the
    frontend sends naive ISO ranges) to naive UTC so comparisons are always
    valid and timezone-consistent (dashboard uses Cairo time via the client;
    stored created_at is UTC)."""
    if isinstance(value, str):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        dt = value
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _within_range(row: dict, from_date, to_date):
    created = row.get("created_at")
    if created is None:
        return True
    try:
        created = _as_utc_naive(str(created))
    except ValueError:
        return True
    if from_date and created < _as_utc_naive(from_date):
        return False
    if to_date and created > _as_utc_naive(to_date):
        return False
    return True


def _units_of(item):
    """Sold quantity in BASE units (may be fractional for kg/liter).
    Whole values stay integers so summaries don't show 5.0."""
    base = item.get("base_qty")
    if base is None:
        base = item.get("quantity") or 0
    value = float(base)
    return int(value) if value.is_integer() else round(value, 4)


@router.get("/api/sales/employee-summary")
def employee_sales_summary(
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    _profile: dict = Depends(require_permission("reports")),
):
    """Aggregated per-employee sales performance, computed from real data.

    Employees are taken from the sales table itself (no fixed names).
    Percentage = employee total / grand total * 100 (value-based, not invoice count).
    Amounts are NET: total_amount - returned_amount (returns never mutate total_amount).
    """
    from_date = _parse_date(from_date, "from")
    to_date = _parse_date(to_date, "to")
    supabase = get_supabase_client()
    try:
        has_amount, _has_returns = _schema_flags(supabase)
        columns = "id,employee_name,total_amount,created_at"
        if has_amount:
            columns += ",returned_amount"
        fetched = _parallel(
            [
                ("sales", lambda: supabase.table("sales").select(columns).order("created_at", desc=True).execute()),
                ("items", lambda: supabase.table("sale_items").select("sale_id,quantity,base_qty").execute()),
            ]
        )
        sales_rows = getattr(fetched["sales"], "data", None) or []
        sales_rows = [s for s in sales_rows if _within_range(s, from_date, to_date)]

        sale_ids = set(s["id"] for s in sales_rows)
        items_rows = [i for i in (getattr(fetched["items"], "data", None) or []) if i.get("sale_id") in sale_ids]
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Unable to build employee summary: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to build employee summary") from exc

    employee_of_sale = {s["id"]: s.get("employee_name") or "غير محدد" for s in sales_rows}
    agg = defaultdict(lambda: {"name": "", "invoice_count": 0, "total_amount": 0.0, "units_sold": 0})
    grand_total = 0.0
    grand_units = 0

    for s in sales_rows:
        name = s.get("employee_name") or "غير محدد"
        agg[name]["name"] = name
        agg[name]["invoice_count"] += 1
        returned = float(s.get("returned_amount") or 0) if has_amount else 0.0
        amount = round(max(0.0, float(s.get("total_amount") or 0) - returned), 2)
        agg[name]["total_amount"] += amount
        grand_total += amount

    for item in items_rows:
        name = employee_of_sale.get(item.get("sale_id"), "غير محدد")
        agg[name]["units_sold"] += _units_of(item)
        grand_units += _units_of(item)

    employees = sorted(
        (
            {
                "name": a["name"],
                "invoice_count": a["invoice_count"],
                "total_amount": round(a["total_amount"], 2),
                "units_sold": a["units_sold"],
                "percentage": round(a["total_amount"] / grand_total * 100, 2) if grand_total > 0 else 0.0,
            }
            for a in agg.values()
        ),
        key=lambda e: e["total_amount"],
        reverse=True,
    )

    return {
        "total_amount": round(grand_total, 2),
        "invoice_count": len(sales_rows),
        "units_sold": grand_units,
        "employees": employees,
    }


@router.get("/api/sales/employees/{employee_name}")
def employee_sales_detail(
    employee_name: str,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    _profile: dict = Depends(require_permission("reports")),
):
    """One employee's sales detail with per-line units (selling_unit + base_qty)."""
    from_date = _parse_date(from_date, "from")
    to_date = _parse_date(to_date, "to")
    supabase = get_supabase_client()
    try:
        has_amount, _has_returns = _schema_flags(supabase)
        columns = "id,employee_name,total_amount,created_at"
        if has_amount:
            columns += ",returned_amount"
        fetched = _parallel(
            [
                ("sales", lambda: supabase.table("sales").select(columns).eq("employee_name", employee_name).order("created_at", desc=True).execute()),
                ("items", lambda: supabase.table("sale_items").select("sale_id,product_id,quantity,unit_price,subtotal,selling_unit,base_qty").execute()),
                ("products", lambda: supabase.table("products").select("id,name").execute()),
            ]
        )
        sales_rows = getattr(fetched["sales"], "data", None) or []
        sales_rows = [s for s in sales_rows if _within_range(s, from_date, to_date)]

        sale_ids = set(s["id"] for s in sales_rows)
        items_rows = [i for i in (getattr(fetched["items"], "data", None) or []) if i.get("sale_id") in sale_ids]
        products_map = {p["id"]: p.get("name") for p in (getattr(fetched["products"], "data", None) or [])}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Unable to load employee sales detail: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to load employee sales detail") from exc

    total_amount = sum(
        max(0.0, float(s.get("total_amount") or 0) - (float(s.get("returned_amount") or 0) if has_amount else 0.0))
        for s in sales_rows
    )
    total_units = sum(_units_of(i) for i in items_rows)
    sales_out = []
    for s in sales_rows:
        returned_amount = float(s.get("returned_amount") or 0) if has_amount else 0.0
        sale_items = [
            {
                "product_id": i.get("product_id"),
                "product_name": products_map.get(i.get("product_id")) or "منتج غير معروف",
                "quantity": i.get("quantity"),
                "unit_price": float(i.get("unit_price") or 0),
                "subtotal": float(i.get("subtotal") or 0),
                "selling_unit": i.get("selling_unit"),
                "base_qty": i.get("base_qty"),
            }
            for i in items_rows
            if i.get("sale_id") == s["id"]
        ]
        sales_out.append(
            {
                "id": s["id"],
                "created_at": s.get("created_at"),
                "total_amount": float(s.get("total_amount") or 0),
                "returned_amount": returned_amount,
                "net_total": round(max(0.0, float(s.get("total_amount") or 0) - returned_amount), 2),
                "items": sale_items,
            }
        )

    return {
        "employee_name": employee_name,
        "total_amount": round(total_amount, 2),
        "invoice_count": len(sales_rows),
        "units_sold": total_units,
        "avg_invoice": round(total_amount / len(sales_rows), 2) if sales_rows else 0.0,
        "sales": sales_out,
    }


@router.post("/api/sales")
def create_sale(
    payload: SaleCreate,
    _profile: dict = Depends(require_permission("pos")),
):
    """Create a sale atomically via the single transactional RPC.

    All writes (sales row, sale_items rows, stock deduction) happen inside the
    PostgreSQL function `create_sale` in ONE transaction: all-or-nothing.
    """
    supabase = get_supabase_client()

    # Items are sent with a selling_unit (carton|piece|sack|kg|...). Default to
    # the product's base unit when omitted; the RPC derives the final
    # base-unit deduction and the price from the stored base price.
    lines = [
        {
            "product_id": item.id,
            "quantity": item.qty,
            "selling_unit": item.selling_unit or None,
        }
        for item in payload.items
    ]

    try:
        result = supabase.rpc(
            "create_sale",
            {
                "p_employee_name": payload.cashier_name,
                "p_items": lines,
                "p_client_request_id": payload.client_request_id,
            },
        )
    except Exception as exc:
        message = _extract_error_message(exc)
        logger.warning("Sale RPC failed: %s", message[:300])

        if message.startswith(INSUFFICIENT_PREFIX):
            _, available = _available_qty(message)
            detail = f"الكمية المطلوبة غير متوفرة. المتاح: {_fmt_qty(available) if available is not None else '؟'}"
            raise HTTPException(status_code=409, detail=detail) from exc
        if message.startswith(PRODUCT_NOT_FOUND_PREFIX):
            raise HTTPException(status_code=404, detail="منتج غير موجود") from exc
        if "invalid_unit" in message:
            raise HTTPException(status_code=400, detail="وحدة البيع غير صحيحة لهذا المنتج") from exc
        if "invalid_capacity" in message:
            raise HTTPException(status_code=400, detail="المنتج لا يحتوي على وحدة تخزين صحيحة") from exc
        if INVALID_QUANTITY in message:
            raise HTTPException(status_code=400, detail="الكمية غير صحيحة") from exc
        raise HTTPException(
            status_code=500,
            detail="حدث خطأ أثناء تسجيل البيع، ولم يتم خصم أي كمية.",
        ) from exc

    if not isinstance(result, dict) or result.get("id") is None:
        raise HTTPException(
            status_code=500,
            detail="حدث خطأ أثناء تسجيل البيع، ولم يتم خصم أي كمية.",
        )

    total_amount = float(result.get("total_amount") or 0)
    sale = {
        "id": result["id"],
        "employee_name": payload.cashier_name,
        "cashier_name": payload.cashier_name,
        "total_amount": total_amount,
        "items": [_model_dump(item) for item in payload.items],
        "client_request_id": payload.client_request_id,
    }
    if result.get("idempotent"):
        sale["idempotent"] = True
    return sale


# ---------------------------------------------------------------------------
# Returns (إرجاع المبيعات واستعادة المخزون) - one atomic RPC, full+partial
# ---------------------------------------------------------------------------

def _map_return_error(exc: Exception):
    message = _extract_error_message(exc)
    logger.warning("Return RPC failed: %s", (message or str(exc))[:300])
    if message.startswith(RETURN_EXCEEDS_PREFIX):
        parts = message.split(":")
        if len(parts) >= 3:
            _kind, _item_id, remaining = parts[0], parts[1], parts[2]
        else:
            remaining = "؟"
        raise HTTPException(
            status_code=409,
            detail=f"الكمية المطلوب إرجاعها أكبر من المباع. الحد الأقصى المتاح للإرجاع: {remaining}",
        ) from exc
    if message.startswith("sale_not_found"):
        raise HTTPException(status_code=404, detail="الفاتورة غير موجودة") from exc
    if message.startswith("sale_item_not_found"):
        raise HTTPException(status_code=404, detail="البند المطلوب إرجاعه غير موجود في الفاتورة") from exc
    if message.startswith("sale_item_not_in_sale"):
        raise HTTPException(status_code=400, detail="هذا البند لا ينتمي إلى هذه الفاتورة") from exc
    if message.startswith(PRODUCT_NOT_FOUND_PREFIX):
        raise HTTPException(status_code=404, detail="منتج غير موجود") from exc
    if "invalid_unit" in message:
        raise HTTPException(status_code=400, detail="وحدة القياس غير صحيحة لهذا المنتج") from exc
    if INVALID_QUANTITY in message:
        raise HTTPException(status_code=400, detail="الكمية غير صحيحة") from exc
    raise HTTPException(
        status_code=500,
        detail="حدث خطأ أثناء تسجيل الإرجاع، ولم تتغير أي كمية.",
    ) from exc


@router.get("/api/sales/{sale_id}")
def get_sale_detail(
    sale_id: int,
    _profile: dict = Depends(require_permission("reports")),
):
    """One invoice with its lines, per-line returnable amounts, and all its returns."""
    supabase = get_supabase_client()
    try:
        has_amount, has_returns = _schema_flags(supabase)
        stage1 = _parallel(
            [
                ("sale", lambda: supabase.table("sales").select("*").eq("id", sale_id).execute()),
                ("items", lambda: supabase.table("sale_items").select("*").eq("sale_id", sale_id).execute()),
                ("products", lambda: supabase.table("products").select("id,name,sell_type,price,units_per_carton,kg_per_sack").execute()),
                ("returns", lambda: supabase.table("returns").select("*").eq("sale_id", sale_id).order("created_at", desc=True).execute() if has_returns else type("R", (), {"data": []})()),
            ]
        )
        sale_rows = getattr(stage1["sale"], "data", None) or []
        if not sale_rows:
            raise HTTPException(status_code=404, detail="الفاتورة غير موجودة")
        sale = sale_rows[0]

        items_rows = getattr(stage1["items"], "data", None) or []
        products_map = {p["id"]: p for p in (getattr(stage1["products"], "data", None) or [])}

        returns_rows = getattr(stage1["returns"], "data", None) or [] if has_returns else []
        all_return_items = []
        returned_by_item: dict[int, float] = {}
        if has_returns and returns_rows:
            return_ids = [r["id"] for r in returns_rows if r.get("id") is not None]
            if return_ids:
                ret_items_resp = (
                    supabase.table("return_items")
                    .select("*")
                    .in_("return_id", return_ids)
                    .execute()
                )
                all_return_items = getattr(ret_items_resp, "data", None) or []
        for item in all_return_items:
            item_id = item.get("sale_item_id")
            if item_id is not None:
                returned_by_item[item_id] = returned_by_item.get(item_id, 0.0) + float(item.get("base_qty") or 0)

        items_out = []
        for item in items_rows:
            product = products_map.get(item.get("product_id")) or {}
            unit_type = (product.get("sell_type") or "piece").strip().lower()
            pieces = int(product["units_per_carton"]) if (unit_type == "carton" and product.get("units_per_carton")) else None
            kgs = float(product["kg_per_sack"]) if (unit_type == "sack" and product.get("kg_per_sack")) else None
            base_qty = float(item.get("base_qty") or item.get("quantity") or 0)
            returned_qty = returned_by_item.get(item.get("id"), 0.0)
            items_out.append({
                "id": item.get("id"),
                "product_id": item.get("product_id"),
                "product_name": (product.get("name") or "منتج غير معروف"),
                "quantity": item.get("quantity"),
                "unit_price": float(item.get("unit_price") or 0),
                "subtotal": float(item.get("subtotal") or 0),
                "selling_unit": item.get("selling_unit"),
                "base_qty": base_qty,
                "returned_base_qty": returned_qty,
                "remaining_base_qty": max(0.0, base_qty - returned_qty),
                "unit_type": unit_type if unit_type in ("piece", "kg", "liter", "carton", "sack") else "piece",
                "pieces_per_carton": pieces,
                "kg_per_sack": kgs,
            })

        returns_out = []
        for ret in returns_rows:
            ret_items = [
                {"id": i.get("id"), "sale_item_id": i.get("sale_item_id"),
                 "product_id": i.get("product_id"), "quantity": i.get("quantity"),
                 "unit": i.get("unit"), "base_qty": i.get("base_qty")}
                for i in all_return_items
                if i.get("return_id") == ret.get("id")
            ]
            returns_out.append({
                "id": ret.get("id"),
                "created_at": ret.get("created_at"),
                "employee_name": ret.get("employee_name"),
                "reason": ret.get("reason"),
                "items": ret_items,
            })

        returned_total = sum(
            float(i.get("base_qty") or 0)
            for i in all_return_items
            if i.get("return_id") in {r.get("id") for r in returns_rows if r.get("id") is not None}
        )
        sold_total = sum(float(i.get("base_qty") or i.get("quantity") or 0) for i in items_rows)
        sale_status = "none"
        if returned_total > 0:
            sale_status = "full" if sold_total > 0 and returned_total >= sold_total else "partial"
        sale["return_status"] = sale_status
        sale["returned_base_qty"] = returned_total
        sale["returned_amount"] = float(sale.get("returned_amount") or 0) if has_amount else 0.0
        sale["net_total"] = round(
            max(0.0, float(sale.get("total_amount") or 0) - float(sale.get("returned_amount") or 0)), 2
        ) if has_amount else round(max(0.0, float(sale.get("total_amount") or 0)), 2)
        return {
            "sale": sale,
            "items": items_out,
            "returns": returns_out,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Unable to load sale %s detail: %s", sale_id, exc)
        raise HTTPException(status_code=500, detail="تعذر تحميل تفاصيل الفاتورة") from exc


@router.post("/api/sales/{sale_id}/return")
def create_return(
    sale_id: int,
    payload: ReturnCreate,
    _profile: dict = Depends(require_permission("inventory")),
):
    """Return full or partial lines of an invoice; stock is restored atomically
    inside the single create_return RPC (row locks + idempotency included)."""
    supabase = get_supabase_client()
    lines = [
        {
            "sale_item_id": item.sale_item_id,
            "quantity": item.qty,
            "unit": item.unit or None,
        }
        for item in payload.items
    ]
    try:
        result = supabase.rpc(
            "create_return",
            {
                "p_sale_id": sale_id,
                "p_employee_name": payload.employee_name or _profile["email"],
                "p_items": lines,
                "p_reason": payload.reason,
                "p_client_request_id": payload.client_request_id,
            },
        )
    except Exception as exc:
        raise _map_return_error(exc) from exc

    if not isinstance(result, dict) or result.get("id") is None:
        raise HTTPException(
            status_code=500,
            detail="حدث خطأ أثناء تسجيل الإرجاع، ولم تتغير أي كمية.",
        )

    return {
        "return_id": result["id"],
        "sale_id": sale_id,
        "employee_name": result.get("employee_name"),
        "returned_amount": float(result.get("returned_amount") or 0),
        "idempotent": bool(result.get("idempotent")),
    }