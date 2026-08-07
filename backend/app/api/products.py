import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.api.deps import get_current_profile, require_permission
from app.core.config import UPLOAD_DIR
from app.core.database import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()

UNIT_TYPES = ("piece", "kg", "liter", "carton", "sack")

UNIT_LABELS = {
    "piece": "قطعة",
    "kg": "كيلو",
    "liter": "لتر",
    "carton": "كرتونة",
    "sack": "شكارة",
}


def _unit_label(unit_type: str) -> str:
    return UNIT_LABELS.get(unit_type or "piece", "")


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

    product["price"] = product.get("price") or 0
    product["unit_price"] = product.get("unit_price") or product["price"]
    product["stock"] = product.get("stock") if product.get("stock") is not None else 0
    product["stock_qty"] = product.get("stock_qty") if product.get("stock_qty") is not None else product["stock"]

    unit_type = (product.get("sell_type") or "piece").strip().lower()
    if unit_type not in UNIT_TYPES:
        unit_type = "piece"
    product["unit_type"] = unit_type
    product["unit_label"] = UNIT_LABELS[unit_type]

    product["pieces_per_carton"] = (
        int(product["units_per_carton"])
        if unit_type == "carton" and product.get("units_per_carton") is not None
        else None
    )
    product["kg_per_sack"] = (
        float(product["kg_per_sack"])
        if unit_type == "sack" and product.get("kg_per_sack") is not None
        else None
    )

    base_price = float(product.get("price") or 0)

    # Derived container prices, always from the stored base price:
    #   carton: price per box   = base price x pieces per box
    #   sack:   price per sack  = base price x kg per sack
    # The optional carton_price column is honored only when explicitly > 0.
    if unit_type == "carton" and product.get("pieces_per_carton"):
        stored_carton = product.get("carton_price")
        product["carton_price"] = (
            float(stored_carton)
            if stored_carton is not None and float(stored_carton) > 0
            else round(base_price * product["pieces_per_carton"], 2)
        )
    elif unit_type == "sack" and product.get("kg_per_sack"):
        product["sack_price"] = round(base_price * product["kg_per_sack"], 2)

    return product


class ProductCreate(BaseModel):
    name: str = Field(min_length=1)
    unit_type: str = "piece"
    price: float | None = None
    unit_price: float | None = None
    carton_price: float | None = None
    stock: int | None = None
    stock_qty: int | None = None
    pieces_per_carton: int | None = None
    kg_per_sack: float | None = None
    image_url: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    unit_type: str | None = None
    price: float | None = None
    unit_price: float | None = None
    carton_price: float | None = None
    stock: int | None = None
    stock_qty: int | None = None
    pieces_per_carton: int | None = None
    kg_per_sack: float | None = None
    image_url: str | None = None


def _model_dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def _validate_unit_fields(unit_type: str, pieces_per_carton, kg_per_sack):
    unit_type = (unit_type or "piece").strip().lower()
    if unit_type not in UNIT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid unit_type '{unit_type}'. Must be one of: {', '.join(UNIT_TYPES)}")

    if unit_type == "carton":
        if pieces_per_carton is None:
            raise HTTPException(status_code=422, detail="unit_type 'carton' requires pieces_per_carton > 0")
        pieces = int(pieces_per_carton)
        if pieces <= 0:
            raise HTTPException(status_code=422, detail="pieces_per_carton must be > 0")
        return unit_type, pieces, None

    if unit_type == "sack":
        if kg_per_sack is None:
            raise HTTPException(status_code=422, detail="unit_type 'sack' requires kg_per_sack > 0")
        kg = float(kg_per_sack)
        if kg <= 0:
            raise HTTPException(status_code=422, detail="kg_per_sack must be > 0")
        if kg != int(kg):
            raise HTTPException(status_code=422, detail="kg_per_sack must be a whole number (e.g. 25)")
        return unit_type, None, int(kg)

    return unit_type, None, None


def _prepare_product_payload(payload):
    data = _model_dump(payload)

    unit_type = (data.get("unit_type") or "piece").strip().lower()
    _valid_unit, pieces, kg = _validate_unit_fields(
        unit_type, data.get("pieces_per_carton"), data.get("kg_per_sack")
    )
    data["unit_type"] = unit_type

    price = data.get("price") if data.get("price") is not None else data.get("unit_price")
    if price is None:
        raise HTTPException(status_code=422, detail="price or unit_price is required")
    price = float(price)
    if price < 0:
        raise HTTPException(status_code=422, detail="price must be >= 0")
    data["price"] = price
    data["unit_price"] = price

    stock = data.get("stock") if data.get("stock") is not None else data.get("stock_qty")
    stock = 0 if stock is None else int(stock)
    if stock < 0:
        raise HTTPException(status_code=422, detail="stock must be >= 0")
    data["stock"] = stock
    data["stock_qty"] = stock

    data["sell_type"] = unit_type
    data["units_per_carton"] = pieces if pieces is not None else None
    data["kg_per_sack"] = kg if kg is not None else None
    data.pop("pieces_per_carton", None)
    data.pop("unit_type", None)
    return data


def _prepare_update_payload(payload: ProductUpdate) -> dict:
    data = _model_dump(payload)

    if "unit_type" in data:
        unit_type = (data.get("unit_type") or "piece").strip().lower()
        _type, pieces, kg = _validate_unit_fields(
            unit_type, data.get("pieces_per_carton"), data.get("kg_per_sack")
        )
        data["sell_type"] = unit_type
        data["units_per_carton"] = pieces if pieces is not None else None
        data["kg_per_sack"] = kg if kg is not None else None
    elif "pieces_per_carton" in data or "kg_per_sack" in data:
        raise HTTPException(status_code=422, detail="unit_type is required when changing piece/kg fields")

    price = data.get("price") if data.get("price") is not None else data.get("unit_price")
    unit_price = data.get("unit_price") if data.get("unit_price") is not None else data.get("price")

    if price is not None:
        price = float(price)
        if price < 0:
            raise HTTPException(status_code=422, detail="price must be >= 0")
        data["price"] = price
    if unit_price is not None:
        unit_price = float(unit_price)
        if unit_price < 0:
            raise HTTPException(status_code=422, detail="price must be >= 0")
        data["unit_price"] = unit_price

    stock = data.get("stock") if data.get("stock") is not None else data.get("stock_qty")
    if stock is not None:
        stock = int(stock)
        if stock < 0:
            raise HTTPException(status_code=422, detail="stock must be >= 0")
        data["stock"] = stock
        data["stock_qty"] = stock

    unit_cols = {}
    if "sell_type" in data:
        unit_cols["units_per_carton"] = data.pop("units_per_carton", None)
        unit_cols["kg_per_sack"] = data.pop("kg_per_sack", None)

    for legacy in ("unit_type", "pieces_per_carton"):
        data.pop(legacy, None)

    data = {k: v for k, v in data.items() if v is not None}
    data.update({k: v for k, v in unit_cols.items()})
    return data


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
