from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.products import router as products_router
from app.api.sales import router as sales_router
from app.api.vision import router as vision_router

app = FastAPI(title="Grocery Store AI & Management System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products_router)
app.include_router(sales_router)
app.include_router(vision_router)


@app.get("/")
def read_root():
    return {"status": "Backend Server Running Successfully"}
