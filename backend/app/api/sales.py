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


@router.get("/api/sales")
def list_sales():
    supabase = get_supabase_client()
    response = supabase.table("sales").select("*").execute()
    return response.data


@router.post("/api/sales")
def create_sale(payload: SaleCreate):
    supabase = get_supabase_client()
    total_amount = round(sum(item.qty * item.price for item in payload.items), 2)

    sale_record = {
        "cashier_name": payload.cashier_name,
        "total_amount": total_amount,
        "items": [_model_dump(item) for item in payload.items],
    }

    response = supabase.table("sales").insert([sale_record]).execute()
    if getattr(response, "data", None) is None:
        raise HTTPException(status_code=500, detail="Unable to create sale")

    for item in payload.items:
        product_row = supabase.table("products").select("*").eq("id", item.id).execute()
        if not getattr(product_row, "data", None):
            continue
        current_stock = product_row.data[0].get("stock", 0)
        supabase.table("products").update({"stock": max(0, current_stock - item.qty)}).eq("id", item.id).execute()

    return sale_record
