from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_supabase_client

router = APIRouter()


class SaleItem(BaseModel):
    id: int
    qty: int = Field(gt=0)
    price: float


class SaleCreate(BaseModel):
    cashier_name: str = Field(min_length=1)
    items: list[SaleItem]


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _current_stock(product_row):
    stock_qty = product_row.get("stock_qty")
    stock = product_row.get("stock")
    if stock_qty is not None:
        return int(stock_qty)
    if stock is not None:
        return int(stock)
    return 0


@router.get("/api/sales")
def list_sales():
    supabase = get_supabase_client()
    try:
        response = supabase.table("sales").select("*").order("created_at", desc=True).execute()
        return getattr(response, "data", None) or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to fetch sales: {exc}") from exc


@router.post("/api/sales")
def create_sale(payload: SaleCreate):
    supabase = get_supabase_client()
    total_amount = round(sum(item.qty * item.price for item in payload.items), 2)

    sale_record = {
        "employee_name": payload.cashier_name,
        "total_amount": total_amount,
    }

    try:
        response = supabase.table("sales").insert([sale_record]).execute()
        data = getattr(response, "data", None) or []
        if not data:
            raise HTTPException(status_code=500, detail="Unable to create sale")

        sale_id = data[0]["id"]

        sale_items = [
            {
                "sale_id": sale_id,
                "product_id": item.id,
                "quantity": item.qty,
                "unit_price": item.price,
            }
            for item in payload.items
        ]
        supabase.table("sale_items").insert(sale_items).execute()

        for item in payload.items:
            product_row = (
                supabase.table("products")
                .select("stock,stock_qty")
                .eq("id", item.id)
                .execute()
            )
            rows = getattr(product_row, "data", None) or []
            if not rows:
                continue
            new_stock = max(0, _current_stock(rows[0]) - item.qty)
            supabase.table("products").update(
                {"stock": new_stock, "stock_qty": new_stock}
            ).eq("id", item.id).execute()

        return {
            "id": sale_id,
            "employee_name": payload.cashier_name,
            "cashier_name": payload.cashier_name,
            "total_amount": total_amount,
            "items": [_model_dump(item) for item in payload.items],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create sale: {exc}") from exc
