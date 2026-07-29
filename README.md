# 🛒 AI-Powered Grocery Management & POS System

A smart, hybrid web application designed to streamline grocery store operations, inventory management, and sales logging using **Computer Vision (YOLOv8)** and **Real-time Cloud Databases (Supabase)**.

---

## 🌟 Key Features

### 📱 Dual-Role Interface (Role-Based Access)

* **Employee POS View (Store Mobile):**
  * **Instant Camera Scanning:** Leverages AI vision to recognize items (single units or cartons) via camera frames and auto-adds them to the cart.
  * **Quick Cashier Workflow:** Shift selection per employee with one-tap sales logging.
  * **Restricted Access:** Hides financial data, purchase prices, and admin settings from store staff.

* **Admin Dashboard (Owner Mobile):**
  * **Real-time Analytics:** Track daily/weekly/monthly revenue and profit from anywhere.
  * **Staff Performance Monitoring:** Break down sales reports by individual employee shifts.
  * **Dynamic Inventory Control:** One-tap stock replenishment (`+1 Carton`) and instant price adjustments.
  * **Low-Stock Alerts:** Automated notifications when inventory reaches reorder thresholds.

---

## 🛠️ Tech Stack

* **Frontend:** React.js (Vite), Tailwind CSS / Lucide Icons
* **Backend API:** Python (FastAPI)
* **AI & Computer Vision:** YOLOv8 (Ultralytics), OpenCV
* **Database & Auth:** Supabase (PostgreSQL, Realtime, Row Level Security)
* **API Communication:** Axios / REST APIs

---

## 📁 Repository Structure

```text
grocery-app/
├── backend/                   # FastAPI Server + YOLO Model Engine
│   ├── app/
│   │   ├── ai/                # Computer Vision & Object Detection Logic
│   │   ├── api/               # API Endpoints (Auth, Products, Sales, Vision)
│   │   ├── core/              # Configs & Database Connections
│   │   └── main.py            # FastAPI Entry Point
│   ├── requirements.txt
│   └── .env
│
└── frontend/                  # React Web Application
    ├── src/
    │   ├── components/        # Reusable UI Components (CameraScanner, Navbar, etc.)
    │   ├── pages/             # App Screens (Login, POS, AdminDash, Inventory)
    │   ├── services/          # Supabase Client & API Handlers
    │   ├── App.jsx            # Routing Logic
    │   └── main.jsx
    ├── package.json
    └── .env
