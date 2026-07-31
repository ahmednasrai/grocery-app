import uuid

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from ultralytics import YOLO

from app.ai.matcher import identify_product_from_image
from app.api.products import _normalize_product
from app.core.config import UPLOAD_DIR
from app.core.database import get_supabase_client

router = APIRouter()

try:
    model = YOLO("yolov8n.pt")
except Exception:
    model = None


async def _read_image_file(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are supported")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image file")
    return contents


@router.post("/api/scan")
async def scan_product(file: UploadFile = File(...)):
    try:
        contents = await _read_image_file(file)

        original_name = (file.filename or "scan.jpg").replace(" ", "_")
        safe_name = f"{uuid.uuid4().hex}_{original_name}"
        target_path = UPLOAD_DIR / safe_name
        target_path.write_bytes(contents)
        image_url = f"/uploads/{safe_name}"

        detections = []
        warning = None

        if model is None:
            warning = "Vision model is unavailable"
        else:
            nparr = np.frombuffer(contents, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                warning = "Unable to decode image"
            else:
                results = model(image)
                for result in results:
                    for box in result.boxes:
                        class_id = int(box.cls[0])
                        label = model.names[class_id]
                        confidence = round(float(box.conf[0]), 2)
                        detections.append({"label": label, "confidence": confidence})

        return {
            "detected_products": detections,
            "image_url": image_url,
            "filename": safe_name,
            "warning": warning,
        }
    except HTTPException:
        raise
    except Exception as exc:
        return {
            "detected_products": [],
            "image_url": None,
            "warning": str(exc),
        }


@router.post("/api/scan/identify")
async def identify_product(file: UploadFile = File(...)):
    contents = await _read_image_file(file)

    supabase = get_supabase_client()
    response = supabase.table("products").select("*").execute()
    products = [_normalize_product(row) for row in (getattr(response, "data", None) or [])]

    if not products:
        raise HTTPException(status_code=404, detail="لا توجد منتجات مسجلة للتعرف عليها")

    trained_products = [product for product in products if product.get("ai_images") or product.get("image_url")]
    if not trained_products:
        raise HTTPException(
            status_code=404,
            detail="لا توجد صور تدريب للمنتجات. أضف صوراً من صفحة المخزون أولاً.",
        )

    match, error = identify_product_from_image(contents, trained_products, UPLOAD_DIR)
    if error:
        return {
            "matched": False,
            "message": error,
            "product": None,
            "confidence": 0,
        }

    product = match["product"]
    return {
        "matched": True,
        "message": "تم التعرف على المنتج بنجاح",
        "product": product,
        "confidence": match["confidence"],
        "matched_reference": match["matched_reference"],
    }
