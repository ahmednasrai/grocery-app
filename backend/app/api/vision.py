from fastapi import APIRouter, File, UploadFile
import cv2
import numpy as np
from ultralytics import YOLO

router = APIRouter()

try:
    model = YOLO("yolov8n.pt")
except Exception:
    model = None


@router.post("/api/scan")
async def scan_product(file: UploadFile = File(...)):
    if model is None:
        return {"detected_products": [], "warning": "Vision model is unavailable"}

    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            return {"detected_products": [], "warning": "Unable to decode image"}

        results = model(image)
        detections = []
        for result in results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                label = model.names[class_id]
                confidence = round(float(box.conf[0]), 2)
                detections.append({"label": label, "confidence": confidence})

        return {"detected_products": detections}
    except Exception as exc:
        return {"detected_products": [], "warning": str(exc)}
