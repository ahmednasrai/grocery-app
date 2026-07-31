import json
import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

try:
    from pydantic import field_validator
except ImportError:
    from pydantic import validator

    def field_validator(*fields, **kwargs):
        if kwargs.get("mode") == "before":
            kwargs.pop("mode")
            kwargs["pre"] = True
        return validator(*fields, **kwargs)

from app.core.config import UPLOAD_DIR
from app.core.database import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _safe_json_list(value):
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return []
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


class ProductCreate(BaseModel):
    name: str = Field(min_length=1)
    price: float
    carton_price: float | None = None
    stock: int = 0
    image_url: str | None = None
    ai_images: list[str] | str | None = None

    @field_validator("ai_images", mode="before")
    @classmethod
    def validate_ai_images(cls, value):
        return _safe_json_list(value)


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def _prepare_product_payload(payload):
    data = _model_dump(payload)
    data["ai_images"] = _safe_json_list(data.get("ai_images"))
    data = {k: v for k, v in data.items() if v is not None}
    return data


@router.get("/api/products")
def list_products():
    supabase = get_supabase_client()
    try:
        response = supabase.table("products").select("*").execute()
        return getattr(response, "data", []) or []
    except Exception as exc:
        logger.exception("Error fetching products")
        raise HTTPException(status_code=500, detail="Unable to fetch products") from exc


@router.post("/api/products", status_code=201)
def create_product(payload: ProductCreate):
    supabase = get_supabase_client()
    payload_data = _prepare_product_payload(payload)
    try:
        # إجبار Supabase على إرجاع السجل المُدخل لتفادي استجابة JSON الفارغة
        response = supabase.table("products").insert([payload_data]).execute()
        data = getattr(response, "data", None)
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
        return {"success": True, **payload_data}
    except Exception as exc:
        logger.exception("Unable to create product")
        raise HTTPException(
            status_code=500,
            detail=f"Unable to create product: {str(exc)}",
        ) from exc


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
    pid = int(product_id)
    try:
        # استخدام .filter("id", "eq", pid) بأسلوب يناسب PostgREST للقيام بالحذف الصريح
        supabase.table("products").delete().filter("id", "eq", pid).execute()
        return {"deleted": True, "id": pid}
    except Exception as exc:
        logger.exception(f"Primary delete failed for product {pid}, retrying direct query")
        try:
            # طريقة احتياطية باستخدام client.postgrest بشكل مباشر لتجنب أخطاء الفلترة
            supabase.postgrest.from_("products").delete().eq("id", str(pid)).execute()
            return {"deleted": True, "id": pid}
        except Exception as inner_exc:
            logger.exception(f"Fallback delete failed for product {pid}")
            raise HTTPException(
                status_code=500,
                detail=f"Unable to delete product #{pid}: {str(inner_exc)}",
            ) from inner_exc