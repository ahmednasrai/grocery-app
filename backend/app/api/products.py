import json
import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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

from app.api.deps import get_current_profile, require_permission
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


def _normalize_product(row):
    if not row:
        return row
    product = dict(row)
    price = product.get("price")
    unit_price = product.get("unit_price")
    if price is None and unit_price is not None:
        product["price"] = unit_price
    elif unit_price is None and price is not None:
        product["unit_price"] = price

    stock = product.get("stock")
    stock_qty = product.get("stock_qty")
    if stock is None and stock_qty is not None:
        product["stock"] = stock_qty
    elif stock_qty is None and stock is not None:
        product["stock_qty"] = stock

    product["ai_images"] = _safe_json_list(product.get("ai_images"))
    product["price"] = product.get("price") or 0
    product["unit_price"] = product.get("unit_price") or product["price"]
    product["stock"] = product.get("stock") if product.get("stock") is not None else 0
    product["stock_qty"] = product.get("stock_qty") if product.get("stock_qty") is not None else product["stock"]
    return product


class ProductCreate(BaseModel):
    name: str = Field(min_length=1)
    price: float | None = None
    unit_price: float | None = None
    carton_price: float | None = None
    stock: int | None = None
    stock_qty: int | None = None
    image_url: str | None = None
    ai_images: list[str] | str | None = None

    @field_validator("ai_images", mode="before")
    @classmethod
    def validate_ai_images(cls, value):
        return _safe_json_list(value)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    price: float | None = None
    unit_price: float | None = None
    carton_price: float | None = None
    stock: int | None = None
    stock_qty: int | None = None
    image_url: str | None = None
    ai_images: list[str] | str | None = None


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def _prepare_product_payload(payload):
    data = _model_dump(payload)
    data["ai_images"] = _safe_json_list(data.get("ai_images"))

    price = data.get("price") if data.get("price") is not None else data.get("unit_price")
    if price is None:
        raise HTTPException(status_code=422, detail="price or unit_price is required")
    data["price"] = float(price)
    data["unit_price"] = float(price)

    stock = data.get("stock") if data.get("stock") is not None else data.get("stock_qty")
    stock = 0 if stock is None else int(stock)
    data["stock"] = stock
    data["stock_qty"] = stock

    if not data.get("image_url") and data["ai_images"]:
        data["image_url"] = data["ai_images"][0]

    return data


def _prepare_update_payload(payload: ProductUpdate) -> dict:
    data = _model_dump(payload)
    if "ai_images" in data:
        data["ai_images"] = _safe_json_list(data.get("ai_images"))

    price = data.get("price") if data.get("price") is not None else data.get("unit_price")
    unit_price = data.get("unit_price") if data.get("unit_price") is not None else data.get("price")

    if price is not None:
        data["price"] = float(price)
    if unit_price is not None:
        data["unit_price"] = float(unit_price)

    stock = data.get("stock") if data.get("stock") is not None else data.get("stock_qty")
    if stock is not None:
        data["stock"] = int(stock)
        data["stock_qty"] = int(stock)

    if not data.get("image_url") and data.get("ai_images"):
        data["image_url"] = data["ai_images"][0]

    return {k: v for k, v in data.items() if v is not None}


@router.get("/api/products")
def list_products(_profile: dict = Depends(get_current_profile)):
    supabase = get_supabase_client()
    try:
        response = supabase.table("products").select("*").execute()
        rows = getattr(response, "data", None) or []
        return [_normalize_product(row) for row in rows]
    except Exception as exc:
        logger.exception("Error fetching products")
        raise HTTPException(status_code=500, detail="Unable to fetch products") from exc


@router.post("/api/products", status_code=201)
def create_product(
    payload: ProductCreate,
    _profile: dict = Depends(require_permission("inventory")),
):
    supabase = get_supabase_client()
    payload_data = _prepare_product_payload(payload)
    try:
        response = supabase.table("products").insert([payload_data]).execute()
        data = getattr(response, "data", None)
        if data and isinstance(data, list) and len(data) > 0:
            return _normalize_product(data[0])
        return _normalize_product({"id": None, **payload_data})
    except Exception as exc:
        logger.exception("Unable to create product")
        raise HTTPException(
            status_code=500,
            detail=f"Unable to create product: {str(exc)}",
        ) from exc


@router.put("/api/products/{product_id}")
def update_product(
    product_id: int,
    payload: ProductUpdate,
    _profile: dict = Depends(require_permission("inventory")),
):
    supabase = get_supabase_client()
    pid = int(product_id)
    update_data = _prepare_update_payload(payload)
    try:
        response = supabase.table("products").update(update_data).eq("id", pid).execute()
        rows = getattr(response, "data", None) or []
        if not rows:
            raise HTTPException(status_code=404, detail=f"Product #{pid} not found")
        return _normalize_product(rows[0])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Update failed for product %s", pid)
        raise HTTPException(
            status_code=500,
            detail=f"Unable to update product #{pid}: {str(exc)}",
        ) from exc


@router.post("/api/products/upload-image")
async def upload_product_image(
    file: UploadFile = File(...),
    _profile: dict = Depends(require_permission("inventory")),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are supported")

    original_name = (file.filename or "image").replace(" ", "_")
    safe_name = f"{uuid.uuid4().hex}_{original_name}"
    target_path = UPLOAD_DIR / safe_name

    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty image file")
        target_path.write_bytes(contents)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to save image: {exc}") from exc

    return {"filename": safe_name, "url": f"/uploads/{safe_name}"}


@router.delete("/api/products/{product_id}")
def delete_product(
    product_id: int,
    _profile: dict = Depends(require_permission("inventory")),
):
    supabase = get_supabase_client()
    pid = int(product_id)
    try:
        supabase.table("products").delete().eq("id", pid).execute()
        return {"deleted": True, "id": pid}
    except Exception as exc:
        logger.exception("Delete failed for product %s", pid)
        raise HTTPException(
            status_code=500,
            detail=f"Unable to delete product #{pid}: {str(exc)}",
        ) from exc
