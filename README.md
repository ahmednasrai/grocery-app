# 🛒 Rushdy Mart — Grocery Management & POS System

A hybrid web application for grocery store operations, inventory management, and sales logging using **React**, **FastAPI**, and **Supabase (PostgreSQL + Auth)**.

---

## 🌟 Key Features

* **Role-Based Access (Admin / Employee):**
  * Authentication via **Supabase Auth** (email + password). Passwords are never stored in the browser.
  * The role and permissions are stored in the **database** and enforced on the **backend** — the frontend only hides irrelevant UI.
* **Employee POS View:**
  * Search products + quick cart.
  * One-tap sales logging and automatic stock deduction.
* **Admin Dashboard & Inventory:**
  * Real-time revenue, invoice count, per-employee sales breakdown, and low-stock alerts.
  * Product management (add / edit / delete) with multi-image upload.
* **User Management:**
  * Create employees (email + password), enable/disable accounts, and grant/revoke permissions (POS, Inventory, Reports, Users).

---

## 🛠️ Tech Stack

* **Frontend:** React.js (Vite), Tailwind CSS / Lucide Icons
* **Backend API:** Python (FastAPI)
* **Database & Auth:** Supabase (PostgreSQL, GoTrue Auth, Row Level Security)
* **API Communication:** Browser `fetch` wrapped in `src/services/api.js` (REST)

---

## 🔐 Authentication & Authorization

* Login: `supabase.auth.signInWithPassword({ email, password })`
* The user's JWT is attached to every backend call as `Authorization: Bearer <token>`.
* The backend verifies the token against GoTrue and loads the user profile (role + permissions) from the `profiles` table.
* Decision makers:
  * `GET /api/products` → authenticated
  * `POST /api/products` , `PUT /api/products/:id`, `DELETE /api/products/:id`, `POST /api/products/upload-image` → `inventory` permission (admin by default)
  * `GET /api/sales` → `reports` permission
  * `POST /api/sales` → `pos` permission (employee default)
  * `GET/POST/PUT /api/users`, `GET /api/auth/me → users` permission (admin only by default)
* Admin has full access regardless of the permission list.

---

## 📁 Repository Structure

```text
grocery-app/
├── backend/                   # FastAPI Server
│   ├── app/
│   │   ├── api/               # API Endpoints (deps, products, sales, users)
│   │   ├── core/              # Config, Database & GoTrue (auth) clients
│   │   └── main.py            # FastAPI Entry Point
│   ├── tests/                 # pytest suite (mocked Supabase)
│   ├── supabase_setup.sql     # One-time Supabase SQL setup (profiles + RLS + first admin)
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/                  # React Web Application
    ├── src/
    │   ├── components/        # Reusable UI Components (Navbar)
    │   ├── context/           # AuthContext (session + profile)
    │   ├── pages/             # App Screens (Login, POS, AdminDash, Inventory, Users)
    │   ├── services/          # Supabase Client & API Handlers
    │   ├── App.jsx            # Routing + route guards
    │   └── main.jsx
    ├── package.json
    └── .env
```

---

## 🚀 Setup

1. Run `backend/supabase_setup.sql` in the Supabase SQL Editor (creates `profiles`, RLS, first admin promotion).
2. Backend: copy `backend/.env.example` → `backend/.env` and fill `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
3. Frontend: create `frontend/.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Run the backend (`uvicorn app.main:app --reload --port 8000` from `backend/`) and frontend (`npm run dev` from `frontend/`).