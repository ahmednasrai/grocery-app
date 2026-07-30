from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.config import UPLOAD_DIR
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
    try:
        response = supabase.table("products").insert([_model_dump(payload)]).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to create product: {exc}") from exc

    if getattr(response, "data", None) is None:
        raise HTTPException(status_code=500, detail="Unable to create product")
    return response.data[0]


@router.post("/api/products/upload-image")
async def upload_product_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are supported")

    file_name = f"{file.filename or 'image'}"
    safe_name = file_name.replace(" ", "_")
    target_path = UPLOAD_DIR / safe_name

    try:
        contents = await file.read()
        target_path.write_bytes(contents)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to save image: {exc}") from exc

    return {"filename": safe_name, "url": f"/uploads/{safe_name}"}


@router.delete("/api/products/{product_id}")
def delete_product(product_id: int):
    supabase = get_supabase_client()
    supabase.table("products").delete().eq("id", product_id).execute()
    return {"deleted": True, "id": product_id}
