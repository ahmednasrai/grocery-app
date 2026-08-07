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
                [{"id": 1, "name": "شوكولاتة", "price": 10, "unit_price": 10, "stock": 20, "stock_qty": 20, "carton_price": None, "image_url": None,
                  "sell_type": "piece", "units_per_carton": None, "kg_per_sack": None},
                 {"id": 2, "name": "مياه", "price": 5, "unit_price": 5, "stock": 2, "stock_qty": 2, "carton_price": None, "image_url": None,
                  "sell_type": "piece", "units_per_carton": None, "kg_per_sack": None},
                 {"id": 3, "name": "برجر", "price": 10, "unit_price": 10, "stock": 216, "stock_qty": 216, "carton_price": None, "image_url": None,
                  "sell_type": "carton", "units_per_carton": 24, "kg_per_sack": None},
                 {"id": 4, "name": "أرز", "price": 20, "unit_price": 20, "stock": 125, "stock_qty": 125, "carton_price": None, "image_url": None,
                  "sell_type": "sack", "units_per_carton": None, "kg_per_sack": 25}],
                name="products",
            ),
            "sales": FakeTable([], name="sales"),
            "sale_items": FakeTable([], name="sale_items"),
        }

    def table(self, name):
        return self.tables[name]

    def rpc(self, name, args):
        if name != "create_sale":
            raise RuntimeError("unknown rpc")

        emp = args["p_employee_name"]
        request_key = args.get("p_client_request_id")
        lines = args["p_items"]
        products = self.tables["products"].rows
        sales_rows = self.tables["sales"].rows
        items_rows = self.tables["sale_items"].rows

        # idempotency: a repeated client_request_id returns the stored sale
        if request_key:
            for s in sales_rows:
                if s.get("client_request_id") == request_key:
                    return {
                        "id": s["id"],
                        "employee_name": emp,
                        "total_amount": s["total_amount"],
                        "idempotent": True,
                        "client_request_id": request_key,
                    }

        def rule_of(row):
            return (row.get("sell_type") or "piece").strip().lower()

        def base_unit_of(row):
            r = rule_of(row)
            if r == "carton":
                return "piece"
            if r == "sack":
                return "kg"
            return r

        # validate + compute totals before writing anything
        total = 0.0
        prepared = []
        for line in lines:
            pid, qty = line["product_id"], line["quantity"]
            unit = line.get("selling_unit")
            row = next((p for p in products if p["id"] == pid), None)
            if row is None:
                raise RuntimeError('rpc failed: [{"message":"product_not_found:%d"}]' % pid)
            if qty is None or qty <= 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_quantity"}]')

            rule = rule_of(row)
            if unit is None:
                unit = base_unit_of(row)

            capacity = 1
            if rule == "carton":
                if unit == "carton":
                    capacity = int(row.get("units_per_carton") or 0)
                    if capacity <= 0:
                        raise RuntimeError('rpc failed: [{"message":"invalid_capacity:%d"}]' % pid)
                elif unit != "piece":
                    raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))
            elif rule == "sack":
                if unit == "sack":
                    capacity = float(row.get("kg_per_sack") or 0)
                    if capacity <= 0:
                        raise RuntimeError('rpc failed: [{"message":"invalid_capacity:%d"}]' % pid)
                elif unit != "kg":
                    raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))
            elif unit != rule:
                raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))

            base_qty = round(qty * capacity)
            unit_price = round(float(row.get("price") or 0) * capacity, 4)
            current = int(row.get("stock_qty") if row.get("stock_qty") is not None else row.get("stock") or 0)
            if base_qty > current:
                raise RuntimeError('rpc failed: [{"message":"insufficient_stock:%d:%d"}]' % (pid, current))
            total += round(qty * unit_price, 2)
            prepared.append((row, pid, qty, unit, capacity, base_qty, round(unit_price, 2)))

        sale_id = len(sales_rows) + 1
        sales_rows.append(
            {"id": sale_id, "employee_name": emp, "total_amount": total, "client_request_id": request_key}
        )
        for row, pid, qty, unit, _capacity, base_qty, unit_price in prepared:
            stock = int(row.get("stock_qty") if row.get("stock_qty") is not None else row.get("stock") or 0) - base_qty
            row["stock_qty"] = stock
            row["stock"] = stock
            items_rows.append(
                {"id": len(items_rows) + 1, "sale_id": sale_id, "product_id": pid,
                 "quantity": qty, "unit_price": unit_price, "subtotal": round(qty * unit_price, 2),
                 "selling_unit": unit, "base_qty": base_qty}
            )

        return {"id": sale_id, "employee_name": emp, "total_amount": total,
                "client_request_id": request_key}


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
    app.state.fake = fake_client

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


def test_create_product_defaults_to_piece(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "كرانشي", "price": 190, "stock": 40},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["unit_type"] == "piece"
    assert body["unit_label"] == "قطعة"
    assert body["pieces_per_carton"] is None
    assert body["kg_per_sack"] is None


def test_create_carton_product_requires_pieces(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "unit_type": "carton", "price": 120, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 422

    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "unit_type": "carton", "pieces_per_carton": 24, "price": 120, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["unit_type"] == "carton"
    assert body["pieces_per_carton"] == 24


def test_create_sack_product_requires_kg(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "أرز", "unit_type": "sack", "price": 500, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 422

    r = app_client.post(
        "/api/products",
        json={"name": "أرز", "unit_type": "sack", "kg_per_sack": 25, "price": 500, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["unit_type"] == "sack"
    assert body["kg_per_sack"] == 25


def test_storage_keeps_units_per_carton_and_kg_per_sack_separate(app_client):
    c = app_client.app.state.fake.tables["products"].rows

    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "unit_type": "carton", "pieces_per_carton": 24, "price": 120, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    carton = c[-1]
    assert carton["sell_type"] == "carton"
    assert carton["units_per_carton"] == 24
    assert carton["kg_per_sack"] is None

    r = app_client.post(
        "/api/products",
        json={"name": "أرز", "unit_type": "sack", "kg_per_sack": 25, "price": 500, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    sack = c[-1]
    assert sack["sell_type"] == "sack"
    assert sack["units_per_carton"] is None
    assert sack["kg_per_sack"] == 25

    r = app_client.post(
        "/api/products",
        json={"name": "برتقال", "unit_type": "kg", "price": 30, "stock": 40},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    kg = c[-1]
    assert kg["sell_type"] == "kg"
    assert kg["units_per_carton"] is None
    assert kg["kg_per_sack"] is None


def test_update_changes_unit_maps_to_dedicated_column(app_client):
    c = app_client.app.state.fake.tables["products"].rows
    r = app_client.post(
        "/api/products",
        json={"name": "أرز", "unit_type": "sack", "kg_per_sack": 25, "price": 500, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 201
    pid = r.json()["id"]

    r = app_client.put(
        f"/api/products/{pid}",
        json={"unit_type": "carton", "pieces_per_carton": 12, "price": 250},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    row = next(x for x in c if x["id"] == pid)
    assert row["sell_type"] == "carton"
    assert row["units_per_carton"] == 12
    assert row["kg_per_sack"] is None
    body = r.json()
    assert body["pieces_per_carton"] == 12
    assert body["kg_per_sack"] is None


def test_create_product_invalid_unit_type(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "خبز", "unit_type": "box", "price": 5, "stock": 10},
        headers=_h("admin-token"),
    )
    assert r.status_code == 422


def test_create_product_negative_stock_rejected(app_client):
    r = app_client.post(
        "/api/products",
        json={"name": "مياه", "price": 5, "stock": -2},
        headers=_h("admin-token"),
    )
    assert r.status_code == 422


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


def test_create_sale_items_and_stock_in_same_rpc(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 2, "price": 10}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    items = app_client.app.state.fake.tables["sale_items"].rows
    assert len(items) == 1
    assert items[0]["sale_id"] == r.json()["id"]
    assert items[0]["quantity"] == 2
    assert items[0]["subtotal"] == 20.0


def test_overselling_fails_with_message_and_no_stock_change(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    before = products[1]["stock_qty"]  # id=2: stock=2

    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 2, "qty": 3, "price": 5}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 409
    body = r.json()
    assert "الكمية المطلوبة غير متوفرة" in body["detail"]
    assert "2" in body["detail"]

    after = products[1]["stock_qty"]
    assert after == before == 2
    assert app_client.app.state.fake.tables["sales"].rows == []
    assert app_client.app.state.fake.tables["sale_items"].rows == []


def test_exact_stock_sale_succeeds(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 2, "qty": 2, "price": 5}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    products = app_client.get("/api/products", headers=_h("employee-token")).json()
    assert products[1]["stock"] == 0


def test_duplicate_client_request_id_is_idempotent(app_client):
    key = "dupe-key-123"
    payload = {"cashier_name": "مريم", "client_request_id": key, "items": [{"id": 1, "qty": 1, "price": 10}]}
    r1 = app_client.post("/api/sales", json=payload, headers=_h("employee-token"))
    assert r1.status_code == 200
    r2 = app_client.post("/api/sales", json=payload, headers=_h("employee-token"))
    assert r2.status_code == 200
    assert r2.json()["id"] == r1.json()["id"]
    assert r2.json().get("idempotent") is True

    sales = app_client.app.state.fake.tables["sales"].rows
    matching = [s for s in sales if s.get("client_request_id") == key]
    assert len(matching) == 1
    products = app_client.get("/api/products", headers=_h("employee-token")).json()
    assert products[0]["stock"] == 19  # deducted exactly once


def test_double_submit_without_key_creates_two_invoices(app_client):
    # The frontend always sends a client_request_id; without it two physical
    # submissions are two distinct sales (documenting the server behavior).
    payload = {"cashier_name": "مريم", "items": [{"id": 1, "qty": 1, "price": 10}]}
    r1 = app_client.post("/api/sales", json=payload, headers=_h("employee-token"))
    r2 = app_client.post("/api/sales", json=payload, headers=_h("employee-token"))
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]


def test_sale_with_unknown_product_404(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 9999, "qty": 1, "price": 5}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 404
    assert app_client.app.state.fake.tables["sales"].rows == []


def test_list_sales_admin_only(app_client):
    assert app_client.get("/api/sales", headers=_h("employee-token")).status_code == 403
    r = app_client.get("/api/sales", headers=_h("admin-token"))
    assert r.status_code == 200


# ---------------- Partial-unit sales (carton -> pieces, sack -> kg) ----------------

def test_carton_sold_in_pieces_deducts_base_units(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 3, "qty": 5, "selling_unit": "piece"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 50.0  # 5 pieces x 10

    products = app_client.app.state.fake.tables["products"].rows
    burger = next(p for p in products if p["id"] == 3)
    assert burger["stock_qty"] == 216 - 5  # base units (pieces)

    item = app_client.app.state.fake.tables["sale_items"].rows[0]
    assert item["selling_unit"] == "piece"
    assert item["base_qty"] == 5
    assert item["unit_price"] == 10


def test_carton_sold_as_full_boxes_uses_derived_price(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 3, "qty": 2, "selling_unit": "carton"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 480.0  # 2 boxes x (10 x 24)

    burger = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 3)
    assert burger["stock_qty"] == 216 - 48

    items = app_client.app.state.fake.tables["sale_items"].rows
    assert items[0]["selling_unit"] == "carton"
    assert items[0]["base_qty"] == 48
    assert items[0]["unit_price"] == 240
    assert items[0]["subtotal"] == 480.0


def test_sack_sold_in_kg_deducts_base_units(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 4, "qty": 3, "selling_unit": "kg"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 60.0  # 3 kg x 20

    rice = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 4)
    assert rice["stock_qty"] == 125 - 3
    item = app_client.app.state.fake.tables["sale_items"].rows[0]
    assert item["selling_unit"] == "kg"
    assert item["base_qty"] == 3


def test_sack_sold_as_full_sack_uses_derived_price(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 4, "qty": 1, "selling_unit": "sack"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 500.0  # 1 sack x (20 x 25)

    rice = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 4)
    assert rice["stock_qty"] == 100
    item = app_client.app.state.fake.tables["sale_items"].rows[0]
    assert item["selling_unit"] == "sack"
    assert item["base_qty"] == 25


def test_mixed_units_in_one_invoice(app_client):
    r = app_client.post(
        "/api/sales",
        json={
            "cashier_name": "مريم",
            "items": [
                {"id": 3, "qty": 2, "selling_unit": "carton"},
                {"id": 3, "qty": 5, "selling_unit": "piece"},
                {"id": 4, "qty": 1, "selling_unit": "sack"},
            ],
        },
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    assert r.json()["total_amount"] == 480.0 + 50.0 + 500.0

    burger = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 3)
    rice = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 4)
    assert burger["stock_qty"] == 216 - 48 - 5
    assert rice["stock_qty"] == 125 - 25

    items = app_client.app.state.fake.tables["sale_items"].rows
    assert len(items) == 3
    assert all(i["sale_id"] == r.json()["id"] for i in items)


def test_invalid_selling_unit_rejected(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 3, "qty": 1, "selling_unit": "kg"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 400
    assert "وحدة البيع" in r.json()["detail"]
    assert app_client.app.state.fake.tables["sales"].rows == []


def test_overselling_carton_in_base_units(app_client):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 3, "qty": 10, "selling_unit": "carton"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 409
    assert "216" in r.json()["detail"]  # available base units
    burger = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 3)
    assert burger["stock_qty"] == 216


def test_products_api_returns_derived_container_prices(app_client):
    r = app_client.get("/api/products", headers=_h("employee-token"))
    products = r.json()
    burger = next(p for p in products if p["id"] == 3)
    assert burger["unit_type"] == "carton"
    assert burger["pieces_per_carton"] == 24
    assert burger["carton_price"] == 240.0  # 10 x 24
    rice = next(p for p in products if p["id"] == 4)
    assert rice["unit_type"] == "sack"
    assert rice["kg_per_sack"] == 25
    assert rice["sack_price"] == 500.0  # 20 x 25


def test_carton_price_explicit_override_wins(app_client):
    c = app_client.app.state.fake.tables["products"].rows
    burger = next(p for p in c if p["id"] == 3)
    burger["carton_price"] = 300.0

    r = app_client.get("/api/products", headers=_h("employee-token"))
    carton = next(p for p in r.json() if p["id"] == 3)
    assert carton["carton_price"] == 300.0


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