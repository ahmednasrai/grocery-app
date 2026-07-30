import cv2
import numpy as np
from ultralytics import YOLO

class GroceryDetector:
    def __init__(self, model_path: str = "yolov8n.pt"):
        # تحميل نموذج YOLOv8
        self.model = YOLO(model_path)

    def predict_frame(self, image_bytes: bytes):
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        results = self.model(img)
        detections = []

        for r in results:
            for box in r.boxes:
                class_id = int(box.cls[0])
                label = self.model.names[class_id]
                confidence = float(box.conf[0])
                detections.append({
                    "name": label,
                    "confidence": round(confidence, 2)
                })

        return detections