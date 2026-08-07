import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.database import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()

INSUFFICIENT_PREFIX = "insufficient_stock:"
PRODUCT_NOT_FOUND_PREFIX = "product_not_found:"
INVALID_QUANTITY = "invalid_quantity"


class SaleItem(BaseModel):
    id: int
    qty: int = Field(gt=0)
    price: float | None = None
    selling_unit: str | None = None


class SaleCreate(BaseModel):
    cashier_name: str = Field(min_length=1)
    items: list[SaleItem] = Field(min_items=1)
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


def _available_qty(message: str):
    """Parse 'insufficient_stock:<pid>:<available>' -> (product_id, available)."""
    try:
        _, pid, available = message.split(":", 2)
        return int(pid), int(float(available))
    except (ValueError, TypeError):
        return None, None


@router.get("/api/sales")
def list_sales(_profile: dict = Depends(require_permission("reports"))):
    supabase = get_supabase_client()
    try:
        response = supabase.table("sales").select("*").order("created_at", desc=True).execute()
        return getattr(response, "data", None) or []
    except Exception as exc:
        logger.warning("Unable to fetch sales: %s", exc)
        raise HTTPException(status_code=500, detail="Unable to fetch sales") from exc


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
            detail = f"الكمية المطلوبة غير متوفرة. المتاح: {available if available is not None else '؟'}"
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