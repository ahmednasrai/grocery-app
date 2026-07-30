import os
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from dotenv import load_dotenv
from ultralytics import YOLO

load_dotenv()

app = FastAPI(title="Grocery Store AI & Management System")

# إعدادات الـ CORS للاتصال بالفرونت إند
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# الربط بـ Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://pvcvfzslwxapryagsdzc.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "sb_publishable_iV7jz3ZI8QlmBvYD8urDGw_ib70WvDN")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# تحميل موديل YOLO للتعرف على المنتجات
model = YOLO("yolov8n.pt") 

@app.get("/")
def read_root():
    return {"status": "Backend Server Running Successfully"}

@app.get("/api/products")
def get_products():
    response = supabase.table("products").select("*").execute()
    return response.data

@app.post("/api/scan")
async def scan_product(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        results = model(img)
        detected_items = []
        
        for r in results:
            for box in r.boxes:
                class_id = int(box.cls[0])
                label = model.names[class_id]
                confidence = float(box.conf[0])
                detected_items.append({"label": label, "confidence": confidence})
                
        return {"detected_products": detected_items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
