from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_supabase_client

router = APIRouter()


class ProductCreate(BaseModel):
    name: str = Field(min_length=1)
    price: float
    carton_price: float | None = None
    stock: int = 0
    image_url: str | None = None
    ai_images: list[str] | None = None


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


@router.get("/api/products")
def list_products():
    supabase = get_supabase_client()
    response = supabase.table("products").select("*").execute()
    return response.data


@router.post("/api/products", status_code=201)
def create_product(payload: ProductCreate):
    supabase = get_supabase_client()
    response = supabase.table("products").insert([_model_dump(payload)]).execute()
    if getattr(response, "data", None) is None:
        raise HTTPException(status_code=500, detail="Unable to create product")
    return response.data[0]


@router.delete("/api/products/{product_id}")
def delete_product(product_id: int):
    supabase = get_supabase_client()
    supabase.table("products").delete().eq("id", product_id).execute()
    return {"deleted": True, "id": product_id}
