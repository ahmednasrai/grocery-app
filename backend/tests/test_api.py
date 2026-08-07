import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import products as products_module
from app.api import sales as sales_module
from app.api import users as users_module
from app.core import gotrue

ADMIN_ID = "11111111-1111-1111-1111-111111111111"
EMPLOYEE_ID = "22222222-2222-2222-2222-222222222222"

ADMIN_USER = {
    "id": ADMIN_ID,
    "email": "admin@example.com",
    "user_metadata": {"role": "admin", "permissions": ["pos", "inventory", "reports", "users"], "is_active": True},
    "banned_until": None,
}
EMPLOYEE_USER = {
    "id": EMPLOYEE_ID,
    "email": "emp@example.com",
    "user_metadata": {"role": "employee", "permissions": ["pos"], "is_active": True},
    "banned_until": None,
}


class FakeTable:
    def __init__(self, rows=None, name="products"):
        self.rows = rows if rows is not None else []
        self.name = name
        self._pending_update = None
        self._pending_eq = None
        self._pending_delete = False
        self._pending_inserted = None
        self._pending_updated = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, rows):
        inserted = []
        if self.name == "sale_items":
            self.rows.extend(rows)
        else:
            for row in rows:
                new_row = dict(row)
                new_row.setdefault("id", len(self.rows) + 1)
                self.rows.append(new_row)
                inserted.append(new_row)
        self._pending_inserted = inserted
        return self

    def update(self, values):
        self._pending_update = values
        return self

    def delete(self):
        self._pending_delete = True
        return self

    def eq(self, column, value):
        self._pending_eq = (column, value)
        if self._pending_delete:
            self.rows = [row for row in self.rows if row.get(column) != value]
            self._pending_delete = False
            self._pending_eq = None
        elif self._pending_update is not None:
            affected = []
            for row in self.rows:
                if row.get(column) == value:
                    row.update(self._pending_update)
                    affected.append(row)
            self._pending_update = None
            self._pending_eq = None
            self._pending_updated = affected
        return self

    def order(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self._pending_eq is not None and self._pending_update is None and not self._pending_delete:
            column, value = self._pending_eq
            self._pending_eq = None
            filtered = [row for row in self.rows if row.get(column) == value]
            return type("Resp", (), {"data": filtered})()
        if self._pending_inserted is not None:
            data, self._pending_inserted = self._pending_inserted, None
            return type("Resp", (), {"data": data})()
        if self._pending_updated is not None:
            data, self._pending_updated = self._pending_updated, None
            return type("Resp", (), {"data": data})()
        return type("Resp", (), {"data": list(self.rows)})()


class FakeClient:
    def __init__(self):
        self.tables = {
            "products": FakeTable(
                [{"id": 1, "name": "شوكولاتة", "price": 10, "unit_price": 10, "stock": 20, "stock_qty": 20, "carton_price": None, "image_url": None, "ai_images": []}],
                name="products",
            ),
            "sales": FakeTable([], name="sales"),
            "sale_items": FakeTable([], name="sale_items"),
        }

    def table(self, name):
        return self.tables[name]


# ---------------- In-memory GoTrue admin store ----------------

class FakeAdminStore:
    def __init__(self):
        self.users = {ADMIN_ID: dict(ADMIN_USER), EMPLOYEE_ID: dict(EMPLOYEE_USER)}
        self.next_id = 1000

    def reset(self):
        self.__init__()

    def verify(self, token):
        if token == "admin-token":
            return dict(ADMIN_USER)
        if token == "employee-token":
            return dict(EMPLOYEE_USER)
        return None

    def list_users(self, page=1, per_page=200):
        return list(self.users.values())

    def get_user(self, uid):
        user = self.users.get(str(uid))
        if not user:
            raise Exception("not found")
        return dict(user)

    def create_user(self, email, password, metadata=None):
        user = {
            "id": f"{self.next_id}-0000-0000-0000-000000000000",
            "email": email,
            "user_metadata": metadata or {},
            "banned_until": None,
        }
        self.next_id += 1
        self.users[user["id"]] = user
        return dict(user)

    def update_user(self, uid, metadata):
        if str(uid) not in self.users:
            raise Exception("not found")
        self.users[str(uid)]["user_metadata"] = metadata
        return dict(self.users[str(uid)])

    def set_active(self, uid, active):
        if str(uid) not in self.users:
            raise Exception("not found")
        self.users[str(uid)]["banned_until"] = None if active else "9999-01-01T00:00:00+00:00"
        self.users[str(uid)]["user_metadata"]["is_active"] = active


@pytest.fixture
def app_client(monkeypatch):
    store = FakeAdminStore()
    fake_client = FakeClient()

    monkeypatch.setattr(gotrue, "verify_token", store.verify)
    monkeypatch.setattr(gotrue, "admin_list_users", store.list_users)
    monkeypatch.setattr(gotrue, "admin_get_user", store.get_user)
    monkeypatch.setattr(gotrue, "admin_create_user", store.create_user)
    monkeypatch.setattr(gotrue, "admin_update_user", store.update_user)
    monkeypatch.setattr(gotrue, "admin_set_user_active", store.set_active)

    monkeypatch.setattr(products_module, "get_supabase_client", lambda: fake_client)
    monkeypatch.setattr(sales_module, "get_supabase_client", lambda: fake_client)

    app = FastAPI()
    app.include_router(products_module.router)
    app.include_router(sales_module.router)
    app.include_router(users_module.router)

    return TestClient(app)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Authentication ----------------

def test_products_requires_auth(app_client):
    assert app_client.get("/api/products").status_code == 401


def test_invalid_token_rejected(app_client):
    r = app_client.get("/api/products", headers=_h("wrong-token"))
    assert r.status_code == 401


def test_me_returns_profile(app_client):
    r = app_client.get("/api/auth/me", headers=_h("employee-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "employee"
    assert body["permissions"] == ["pos"]

    r = app_client.get("/api/auth/me", headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_banned_user_cannot_authenticate(app_client, monkeypatch):
    banned = dict(EMPLOYEE_USER)
    banned["banned_until"] = "9999-01-01T00:00:00+00:00"

    def verify(token):
        if token == "employee-token":
            return None  # GoTrue rejects tokens of banned users
        if token == "admin-token":
            return dict(ADMIN_USER)
        return None

    monkeypatch.setattr(gotrue, "verify_token", verify)
    r = app_client.get("/api/auth/me", headers=_h("employee-token"))
    assert r.status_code == 401
    r = app_client.get("/api/auth/me", headers=_h("admin-token"))
    assert r.status_code == 200


# ---------------- Products ----------------

def test_list_products_authenticated(app_client):
    r = app_client.get("/api/products", headers=_h("employee-token"))
    assert r.status_code == 200
    assert r.json()[0]["name"] == "شوكولاتة"
    assert r.json()[0]["stock"] == 20


def test_create_product_employee_forbidden(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "price": 5, "stock": 10},
        headers=_h("employee-token"),
    )
    assert r.status_code == 403


def test_create_product_admin(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "price": 5, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    assert r.json()["name"] == "مياه"


def test_update_product_admin(app_client):
    r = app_client.put(
        "/api/products/1",
        json={"price": 12, "stock": 5},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert r.json()["price"] == 12
    assert r.json()["stock"] == 5


def test_update_product_employee_forbidden(app_client):
    r = app_client.put("/api/products/1", json={"price": 12}, headers=_h("employee-token"))
    assert r.status_code == 403


def test_delete_product_employee_forbidden(app_client):
    assert app_client.delete("/api/products/1", headers=_h("employee-token")).status_code == 403


def test_delete_product_admin(app_client):
    r = app_client.delete("/api/products/1", headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["deleted"] is True


# ---------------- Sales ----------------

def test_create_sale_unauthenticated(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 2, "price": 10}]},
    )
    assert r.status_code == 401


def test_create_sale_employee_reduces_stock(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 2, "price": 10}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 20

    products = app_client.get("/api/products", headers=_h("employee-token")).json()
    assert products[0]["stock"] == 18


def test_list_sales_admin_only(app_client):
    assert app_client.get("/api/sales", headers=_h("employee-token")).status_code == 403
    r = app_client.get("/api/sales", headers=_h("admin-token"))
    assert r.status_code == 200


# ---------------- User management ----------------

def test_list_users_admin_only(app_client):
    assert app_client.get("/api/users", headers=_h("employee-token")).status_code == 403
    r = app_client.get("/api/users", headers=_h("admin-token"))
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "admin@example.com" in emails
    assert "emp@example.com" in emails


def test_create_user_admin(app_client):
    r = app_client.post(
        "/api/users",
        json={"email": "new@example.com", "password": "secret123"},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    assert r.json()["email"] == "new@example.com"
    assert r.json()["role"] == "employee"
    assert r.json()["permissions"] == ["pos"]


def test_create_user_employee_forbidden(app_client):
    r = app_client.post(
        "/api/users",
        json={"email": "new@example.com", "password": "secret123"},
        headers=_h("employee-token"),
    )
    assert r.status_code == 403


def test_update_user_permissions_admin(app_client):
    r = app_client.put(
        f"/api/users/{EMPLOYEE_ID}",
        json={"permissions": ["pos", "inventory"], "is_active": True},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert r.json()["permissions"] == ["pos", "inventory"]


def test_admin_cannot_disable_self(app_client):
    r = app_client.put(
        f"/api/users/{ADMIN_ID}",
        json={"is_active": False},
        headers=_h("admin-token"),
    )
    assert r.status_code == 400


def test_update_user_employee_forbidden(app_client):
    r = app_client.put(
        f"/api/users/{EMPLOYEE_ID}",
        json={"permissions": ["inventory"]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 403


def test_employee_permissions_listed_only(app_client):
    me = app_client.get("/api/auth/me", headers=_h("employee-token")).json()
    assert sorted(me["permissions"]) == ["pos"]