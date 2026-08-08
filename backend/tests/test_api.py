import pytest
import threading
from concurrent.futures import ThreadPoolExecutor
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
EMPLOYEE_INV_USER = {
    "id": "33333333-3333-3333-3333-333333333333",
    "email": "inv@example.com",
    "user_metadata": {"role": "employee", "permissions": ["pos", "inventory"], "is_active": True},
    "banned_until": None,
}


class FakeTable:
    def __init__(self, rows=None, name="products"):
        self.rows = rows if rows is not None else []
        self.name = name
        self._client = None
        self._last_select = []
        self._pending_update = None
        self._pending_eq = None
        self._pending_delete = False
        self._pending_inserted = None
        self._pending_updated = None
        self._pending_range = []

    def select(self, *_args, **_kwargs):
        self._last_select = list(_args)
        return self

    def limit(self, *_args, **_kwargs):
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

    def gte(self, column, value):
        self._pending_range.append((column, "gte", value))
        return self

    def lte(self, column, value):
        self._pending_range.append((column, "lte", value))
        return self

    def in_(self, column, values):
        self._pending_range.append((column, "in", values))
        return self

    def _apply_range(self, rows):
        result = rows
        for column, op, value in self._pending_range:
            if op == "in":
                result = [row for row in result if row.get(column) in value]
            elif op == "gte":
                result = [row for row in result if (row.get(column) or "") >= value]
            elif op == "lte":
                result = [row for row in result if (row.get(column) or "") <= value]
        return result

    def execute(self):
        if self._client is not None:
            if self.name == "returns" and self._client.schema_returns_missing:
                raise RuntimeError(
                    'rpc failed: [{"code":"PGRST205","message":"Could not find the table \'public.returns\' in the schema cache"}]'
                )
            if (
                self.name == "sales"
                and self._client.schema_returned_missing
                and any(isinstance(a, str) and "returned_amount" in a for a in self._last_select)
            ):
                raise RuntimeError(
                    'rpc failed: [{"code":"42703","message":"column sales.returned_amount does not exist"}]'
                )
        if self._pending_eq is not None and self._pending_update is None and not self._pending_delete:
            column, value = self._pending_eq
            self._pending_eq = None
            filtered = [row for row in self.rows if row.get(column) == value]
            return type("Resp", (), {"data": self._apply_range(filtered)})()
        if self._pending_inserted is not None:
            data, self._pending_inserted = self._pending_inserted, None
            return type("Resp", (), {"data": data})()
        if self._pending_updated is not None:
            data, self._pending_updated = self._pending_updated, None
            return type("Resp", (), {"data": data})()
        return type("Resp", (), {"data": self._apply_range(list(self.rows))})()


class FakeClient:
    def __init__(self):
        self.tables = {
            "products": FakeTable(
                [{"id": 1, "name": "شوكولاتة", "price": 10, "unit_price": 10, "stock": 20, "stock_qty": 20, "carton_price": None, "image_url": None,
                  "sell_type": "piece", "units_per_carton": None, "kg_per_sack": None, "minimum_stock": 10, "stock_in_base": True},
                 {"id": 2, "name": "مياه", "price": 5, "unit_price": 5, "stock": 2, "stock_qty": 2, "carton_price": None, "image_url": None,
                  "sell_type": "piece", "units_per_carton": None, "kg_per_sack": None, "minimum_stock": 2, "stock_in_base": True},
                 {"id": 3, "name": "برجر", "price": 10, "unit_price": 10, "stock": 216, "stock_qty": 216, "carton_price": None, "image_url": None,
                  "sell_type": "carton", "units_per_carton": 24, "kg_per_sack": None, "minimum_stock": 48, "stock_in_base": True},
                 {"id": 4, "name": "أرز", "price": 20, "unit_price": 20, "stock": 125, "stock_qty": 125, "carton_price": None, "image_url": None,
                  "sell_type": "sack", "units_per_carton": None, "kg_per_sack": 25, "minimum_stock": 100, "stock_in_base": True}],
                name="products",
            ),
            "sales": FakeTable([], name="sales"),
            "sale_items": FakeTable([], name="sale_items"),
            "returns": FakeTable([], name="returns"),
            "return_items": FakeTable([], name="return_items"),
        }
        self._rpc_lock = threading.Lock()
        self.schema_returned_missing = False
        self.schema_returns_missing = False

    def table(self, name):
        self.tables[name]._client = self
        return self.tables[name]

    def _to_base(self, row, unit, qty):
        pid = row["id"]
        rule = (row.get("sell_type") or "piece").strip().lower()
        if rule in ("piece", "kg", "liter"):
            if unit is not None and unit != rule:
                raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))
            return float(qty)
        if rule == "carton":
            if unit not in ("carton", "piece"):
                raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))
            capacity = float(row.get("units_per_carton") or 0)
            if capacity <= 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_capacity:%d"}]' % pid)
            return float(qty) * capacity if unit == "carton" else float(qty)
        if rule == "sack":
            if unit not in ("sack", "kg"):
                raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))
            capacity = float(row.get("kg_per_sack") or 0)
            if capacity <= 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_capacity:%d"}]' % pid)
            return float(qty) * capacity if unit == "sack" else float(qty)
        raise RuntimeError('rpc failed: [{"message":"invalid_unit:%d:%s"}]' % (pid, unit))

    def _find_product(self, pid, raise_missing=True):
        row = next((p for p in self.tables["products"].rows if p["id"] == pid), None)
        if row is None and raise_missing:
            raise RuntimeError('rpc failed: [{"message":"product_not_found:%d"}]' % pid)
        return row

    def _set_stock(self, row, new_stock):
        row["stock"] = new_stock
        row["stock_qty"] = new_stock

    def rpc(self, name, args):
        if name == "receive_stock":
            row = self._find_product(args["p_product_id"])
            qty = args.get("p_qty")
            if qty is None or qty <= 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_quantity"}]')
            unit = args.get("p_unit") or (row.get("sell_type") or "piece").strip().lower()
            added = self._to_base(row, unit, qty)
            self._set_stock(row, float(row.get("stock_qty") if row.get("stock_qty") is not None else row.get("stock") or 0) + added)
            return dict(row)

        if name == "adjust_stock":
            row = self._find_product(args["p_product_id"])
            op = args.get("p_operation")
            qty = args.get("p_qty")
            if op not in ("add", "subtract", "set"):
                raise RuntimeError('rpc failed: [{"message":"invalid_operation:%s"}]' % op)
            if qty is None or qty < 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_quantity"}]')
            current = float(row.get("stock_qty") if row.get("stock_qty") is not None else row.get("stock") or 0)
            if op in ("add", "subtract"):
                unit = args.get("p_unit") or (row.get("sell_type") or "piece").strip().lower()
                delta = self._to_base(row, unit, qty)
                new_stock = current + delta if op == "add" else current - delta
            else:
                new_stock = float(qty)
            if new_stock < 0:
                raise RuntimeError('rpc failed: [{"message":"negative_stock_not_allowed:%d:%s"}]' % (row["id"], new_stock))
            self._set_stock(row, new_stock)
            return dict(row)

        if name != "create_sale" and name != "create_return":
            raise RuntimeError("unknown rpc")

        if name == "create_return":
            with self._rpc_lock:
                return self._fake_create_return(args)

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
            {"id": sale_id, "employee_name": emp, "total_amount": total,
             "returned_amount": 0, "client_request_id": request_key}
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

    def _fake_create_return(self, args):
        """Mirror of migration 008 v2 create_return RPC (money + aggregation +
        serialization via self._rpc_lock, standing in for the row locks)."""
        p_sale_id = args["p_sale_id"]
        emp = args["p_employee_name"]
        request_key = args.get("p_client_request_id")
        reason = args.get("p_reason")
        lines = args["p_items"]

        sales_rows = self.tables["sales"].rows
        items_rows = self.tables["sale_items"].rows
        returns_rows = self.tables["returns"].rows
        ret_items_rows = self.tables["return_items"].rows

        if request_key:
            for r in returns_rows:
                if r.get("client_request_id") == request_key:
                    return {"id": r["id"], "sale_id": p_sale_id,
                            "employee_name": emp, "idempotent": True,
                            "client_request_id": request_key}

        if not any(s.get("id") == p_sale_id for s in sales_rows):
            raise RuntimeError('rpc failed: [{"message":"sale_not_found:%d"}]' % p_sale_id)

        return_of = {r["id"]: r.get("sale_id") for r in returns_rows}

        prepared = []
        agg = {}
        for line in lines:
            iid, qty = line["sale_item_id"], line["quantity"]
            unit = line.get("unit")
            if iid is None or qty is None or qty <= 0:
                raise RuntimeError('rpc failed: [{"message":"invalid_quantity"}]')
            item = next((i for i in items_rows if i["id"] == iid), None)
            if item is None:
                raise RuntimeError('rpc failed: [{"message":"sale_item_not_found:%d"}]' % iid)
            if item.get("sale_id") != p_sale_id:
                raise RuntimeError('rpc failed: [{"message":"sale_item_not_in_sale:%d"}]' % iid)
            row = self._find_product(item["product_id"], raise_missing=False)
            if row is None:
                raise RuntimeError('rpc failed: [{"message":"product_not_found:%d"}]' % item["product_id"])
            if unit is None:
                unit = item.get("selling_unit") or (row.get("sell_type") or "piece").strip().lower()
            base = self._to_base(row, unit, qty)
            agg[iid] = agg.get(iid, 0.0) + base
            prepared.append((item, qty, unit, base, row))

        # Aggregated check per sale_item_id (duplicates in one request summed)
        for iid, agg_base in agg.items():
            item = next(i for i in items_rows if i["id"] == iid)
            sold = float(item.get("base_qty") if item.get("base_qty") is not None else item.get("quantity") or 0)
            returned = float(
                sum(
                    ri.get("base_qty") or 0
                    for ri in ret_items_rows
                    if ri.get("sale_item_id") == iid
                    and return_of.get(ri.get("return_id")) == p_sale_id
                )
            )
            if returned + agg_base > sold:
                raise RuntimeError('rpc failed: [{"message":"return_exceeds:%d:%s"}]' % (iid, sold - returned))

        ret_id = len(returns_rows) + 1
        returns_rows.append({
            "id": ret_id, "sale_id": p_sale_id, "employee_name": emp,
            "reason": reason, "client_request_id": request_key,
        })

        sale_row = next(s for s in sales_rows if s["id"] == p_sale_id)
        money = 0.0
        for item, qty, unit, base, row in prepared:
            sold = float(item.get("base_qty") if item.get("base_qty") is not None else item.get("quantity") or 0)
            subtotal = float(item.get("subtotal") if item.get("subtotal") is not None
                             else (float(item.get("unit_price") or 0) * float(item.get("quantity") or 0)))
            amount = round(subtotal * base / sold, 2) if sold else 0.0
            money += amount
            ret_items_rows.append({
                "id": len(ret_items_rows) + 1, "return_id": ret_id,
                "sale_item_id": item["id"], "product_id": item["product_id"],
                "quantity": qty, "unit": unit, "base_qty": base, "amount": amount,
            })
            self._set_stock(row, float(row.get("stock_qty") if row.get("stock_qty") is not None else row.get("stock") or 0) + base)

        sale_row = next(s for s in sales_rows if s["id"] == p_sale_id)
        sale_row["returned_amount"] = round(float(sale_row.get("returned_amount") or 0) + money, 2)

        return {"id": ret_id, "sale_id": p_sale_id, "employee_name": emp,
                "returned_amount": round(money, 2), "client_request_id": request_key}


# ---------------- In-memory GoTrue admin store ----------------

class FakeAdminStore:
    def __init__(self):
        self.users = {ADMIN_ID: dict(ADMIN_USER), EMPLOYEE_ID: dict(EMPLOYEE_USER),
                      EMPLOYEE_INV_USER["id"]: dict(EMPLOYEE_INV_USER)}
        self.next_id = 1000

    def reset(self):
        self.__init__()

    def verify(self, token):
        if token == "admin-token":
            return dict(ADMIN_USER)
        if token == "employee-token":
            return dict(EMPLOYEE_USER)
        if token == "employee-inv-token":
            return dict(EMPLOYEE_INV_USER)
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
        json={"name": "أرز", "unit_type": "sack", "kg_per_sack": 25, "price": 500, "stock": 0},
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


def test_delete_product_blocked_when_sales_exist(app_client):
    app_client.app.state.fake.tables["sale_items"].rows = [{"id": 1, "product_id": 1, "sale_id": 1}]
    r = app_client.delete("/api/products/1", headers=_h("admin-token"))
    assert r.status_code == 409
    body = r.json()
    assert "مبيعات مسجلة سابقًا" in body["detail"]
    ids = [p["id"] for p in app_client.app.state.fake.tables["products"].rows]
    assert 1 in ids  # product must NOT be removed


def test_delete_product_allowed_without_sale_items(app_client):
    r = app_client.delete("/api/products/2", headers=_h("admin-token"))
    assert r.status_code == 200
    ids = [p["id"] for p in app_client.app.state.fake.tables["products"].rows]
    assert 2 not in ids


def test_delete_product_not_found(app_client):
    r = app_client.delete("/api/products/9999", headers=_h("admin-token"))
    assert r.status_code == 404


def test_archive_product_with_sales(app_client):
    app_client.app.state.fake.tables["sale_items"].rows = [{"id": 1, "product_id": 3, "sale_id": 1}]
    r = app_client.put("/api/products/3", json={"is_active": False}, headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["is_active"] is False
    stored = next(p for p in app_client.app.state.fake.tables["products"].rows if p["id"] == 3)
    assert stored["is_active"] is False


def test_restore_archived_product(app_client):
    r = app_client.put("/api/products/2", json={"is_active": False}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    r = app_client.put("/api/products/2", json={"is_active": True}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["is_active"] is True


def test_list_products_has_sales_flag(app_client):
    app_client.app.state.fake.tables["sale_items"].rows = [{"id": 1, "product_id": 3, "sale_id": 1}]
    products = app_client.get("/api/products", headers=_h("admin-token")).json()
    by_id = {p["id"]: p for p in products}
    assert by_id[3]["has_sales"] is True
    assert by_id[1]["has_sales"] is False
    assert by_id[1]["is_active"] is True


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


# ---------------- Employee sales performance ----------------

def _seed_performance_data(app_client):
    fake = app_client.app.state.fake
    fake.tables["sales"].rows = [
        {"id": 101, "employee_name": "مريم", "total_amount": 100.0, "created_at": "2026-08-08T10:00:00+00:00"},
        {"id": 102, "employee_name": "مريم", "total_amount": 50.0, "created_at": "2026-08-08T11:00:00+00:00"},
        {"id": 103, "employee_name": "فاطمة", "total_amount": 150.0, "created_at": "2026-08-08T12:00:00+00:00"},
        {"id": 104, "employee_name": "مريم", "total_amount": 200.0, "created_at": "2026-06-01T10:00:00+00:00"},
    ]
    fake.tables["sale_items"].rows = [
        {"id": 1, "sale_id": 101, "product_id": 1, "quantity": 1, "base_qty": 10, "selling_unit": "piece"},
        {"id": 2, "sale_id": 101, "product_id": 3, "quantity": 1, "base_qty": 24, "selling_unit": "carton"},
        {"id": 3, "sale_id": 102, "product_id": 2, "quantity": 5, "base_qty": 5, "selling_unit": "piece"},
        {"id": 4, "sale_id": 103, "product_id": 1, "quantity": 3, "base_qty": 15, "selling_unit": "piece"},
        {"id": 5, "sale_id": 104, "product_id": 1, "quantity": 2, "base_qty": 20, "selling_unit": "piece"},
    ]


def test_employee_summary_aggregates_real_data(app_client):
    _seed_performance_data(app_client)
    r = app_client.get("/api/sales/employee-summary", headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["total_amount"] == 500.0
    assert body["invoice_count"] == 4
    assert body["units_sold"] == 74  # 10+24+5+15+20

    by_name = {e["name"]: e for e in body["employees"]}
    assert set(by_name) == {"مريم", "فاطمة"}
    maryam = by_name["مريم"]
    assert maryam["invoice_count"] == 3
    assert maryam["total_amount"] == 350.0
    assert maryam["units_sold"] == 59
    fatma = by_name["فاطمة"]
    assert fatma["total_amount"] == 150.0

    # accuracy: employee totals sum = grand total, percentages sum ~ 100
    assert sum(e["total_amount"] for e in body["employees"]) == body["total_amount"]
    assert abs(sum(e["percentage"] for e in body["employees"]) - 100.0) < 0.01
    assert maryam["percentage"] == 70.0  # 350/500
    assert fatma["percentage"] == 30.0

    # sorted by total desc
    assert body["employees"][0]["name"] == "مريم"


def test_employee_summary_requires_reports(app_client):
    r = app_client.get("/api/sales/employee-summary", headers=_h("employee-token"))
    assert r.status_code == 403


def test_employee_summary_date_filter(app_client):
    _seed_performance_data(app_client)
    # June invoice (id 104) excluded when filtering to August
    r = app_client.get(
        "/api/sales/employee-summary",
        params={"from": "2026-08-01T00:00:00+00:00", "to": "2026-08-31T23:59:59+00:00"},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["invoice_count"] == 3
    assert body["total_amount"] == 300.0
    by_name = {e["name"]: e for e in body["employees"]}
    assert by_name["مريم"]["total_amount"] == 150.0
    assert by_name["فاطمة"]["percentage"] == 50.0  # 150/300
    assert abs(sum(e["percentage"] for e in body["employees"]) - 100.0) < 0.01


def test_employee_summary_invalid_date(app_client):
    r = app_client.get("/api/sales/employee-summary", params={"from": "not-a-date"}, headers=_h("admin-token"))
    assert r.status_code == 422


def test_employee_summary_no_sales(app_client):
    r = app_client.get("/api/sales/employee-summary", headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["total_amount"] == 0
    assert body["invoice_count"] == 0
    assert body["employees"] == []


def test_employee_detail_only_own_sales(app_client):
    _seed_performance_data(app_client)
    r = app_client.get("/api/sales/employees/فاطمة", headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["employee_name"] == "فاطمة"
    assert body["invoice_count"] == 1
    assert body["total_amount"] == 150.0
    assert body["avg_invoice"] == 150.0
    assert body["units_sold"] == 15
    sale = body["sales"][0]
    assert sale["id"] == 103
    assert sale["items"][0]["product_name"] == "شوكولاتة"  # joined from products table
    assert sale["items"][0]["selling_unit"] == "piece"
    assert sale["items"][0]["base_qty"] == 15

    # مريم detail shows 3 invoices only (never فاطمة's)
    r2 = app_client.get("/api/sales/employees/مريم", headers=_h("admin-token"))
    body2 = r2.json()
    assert body2["invoice_count"] == 3
    assert all(s["id"] in (101, 102, 104) for s in body2["sales"])


def test_employee_detail_with_date_filter(app_client):
    _seed_performance_data(app_client)
    r = app_client.get(
        "/api/sales/employees/مريم",
        params={"from": "2026-08-01T00:00:00+00:00"},
        headers=_h("admin-token"),
    )
    body = r.json()
    assert body["invoice_count"] == 2  # June invoice excluded
    assert body["total_amount"] == 150.0


def test_employee_detail_requires_reports(app_client):
    r = app_client.get("/api/sales/employees/مريم", headers=_h("employee-token"))
    assert r.status_code == 403


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


def test_carton_price_always_derived_from_base_price(app_client):
    # Part 13: container price always follows the base price (10 -> 240; 12 -> 288)
    c = app_client.app.state.fake.tables["products"].rows
    burger = next(p for p in c if p["id"] == 3)
    burger["carton_price"] = 300.0  # stored override must be ignored

    r = app_client.get("/api/products", headers=_h("employee-token"))
    carton = next(p for p in r.json() if p["id"] == 3)
    assert carton["carton_price"] == 240.0  # 10 x 24, not the stored 300

    r2 = app_client.put("/api/products/3", json={"price": 12, "unit_price": 12}, headers=_h("admin-token"))
    assert r2.status_code == 200
    assert r2.json()["carton_price"] == 288.0
    assert r2.json()["stock"] == 216  # price update does NOT touch stock


# ---------------- Stock receiving / adjustment / minimum stock ----------------

def _set_minimum(app_client, pid, value):
    app_client.put(f"/api/products/{pid}", json={"minimum_stock": value}, headers=_h("admin-token"))


def test_products_api_reports_minimum_stock_and_status(app_client):
    r = app_client.get("/api/products", headers=_h("employee-token"))
    products = {p["id"]: p for p in r.json()}
    assert products[1]["minimum_stock"] == 10
    assert products[1]["stock_status"] == "ok"      # 20 > 10
    assert products[2]["stock_status"] == "low"     # 2 <= 2
    assert products[3]["stock_status"] == "ok"      # 216 > 48
    assert products[4]["stock_status"] == "ok"      # 125 > 100


def test_out_of_stock_status_when_zero(app_client):
    r = app_client.get("/api/products", headers=_h("employee-token"))
    products = {p["id"]: p for p in r.json()}
    # id=2 has stock 2, min 2 -> low now; force to 0 via adjust
    app_client.post("/api/products/2/adjust-stock", json={"operation": "set", "qty": 0}, headers=_h("admin-token"))
    r = app_client.get("/api/products", headers=_h("employee-token"))
    m = next(p for p in r.json() if p["id"] == 2)
    assert m["stock_status"] == "out"


def test_low_stock_status_live_after_sale(app_client):
    # sell 5 pieces from id=1 (stock 20 -> 15) — still above min 10: ok
    app_client.post("/api/sales", json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 5}]}, headers=_h("employee-token"))
    r = app_client.get("/api/products", headers=_h("employee-token"))
    assert next(p for p in r.json() if p["id"] == 1)["stock_status"] == "ok"

    # sell down to 10 -> exactly minimum -> low
    app_client.post("/api/sales", json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 5}]}, headers=_h("employee-token"))
    r = app_client.get("/api/products", headers=_h("employee-token"))
    assert next(p for p in r.json() if p["id"] == 1)["stock_status"] == "low"

    # sell the last 10 -> 0 -> out
    app_client.post("/api/sales", json={"cashier_name": "مريم", "items": [{"id": 1, "qty": 10}]}, headers=_h("employee-token"))
    r = app_client.get("/api/products", headers=_h("employee-token"))
    assert next(p for p in r.json() if p["id"] == 1)["stock_status"] == "out"


def test_receive_carton_conversion(app_client):
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 2, "unit": "carton"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 216 + 48  # 2 cartons x 24 pieces
    assert r.json()["stock_qty"] == 264
    # price untouched by stock receiving
    assert r.json()["price"] == 10


def test_receive_piece_conversion(app_client):
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 20, "unit": "piece"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 216 + 20


def test_receive_sack_conversion(app_client):
    r = app_client.post("/api/products/4/receive-stock", json={"qty": 4, "unit": "sack"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 125 + 100  # 4 sacks x 25 kg


def test_receive_kg_conversion_for_sack(app_client):
    r = app_client.post("/api/products/4/receive-stock", json={"qty": 30, "unit": "kg"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 125 + 30


def test_receive_defaults_to_selling_unit(app_client):
    # default = the product's base selling unit (carton for carton products), like POS
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 7}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 216 + 7 * 24


def test_receive_invalid_quantity(app_client):
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 0}, headers=_h("admin-token"))
    assert r.status_code == 422  # pydantic gt=0

    r = app_client.post("/api/products/3/receive-stock", json={"qty": -5}, headers=_h("admin-token"))
    assert r.status_code == 422


def test_receive_invalid_unit(app_client):
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 1, "unit": "sack"}, headers=_h("admin-token"))
    assert r.status_code == 400
    assert "وحدة القياس" in r.json()["detail"]
    # no stock mutation on failure
    p = next(p for p in app_client.get("/api/products", headers=_h("admin-token")).json() if p["id"] == 3)
    assert p["stock"] == 216


def test_receive_unknown_product_404(app_client):
    r = app_client.post("/api/products/9999/receive-stock", json={"qty": 5}, headers=_h("admin-token"))
    assert r.status_code == 404


def test_receive_requires_inventory_permission(app_client):
    r = app_client.post("/api/products/3/receive-stock", json={"qty": 5}, headers=_h("employee-token"))
    assert r.status_code == 403


def test_adjust_add_uses_unit(app_client):
    r = app_client.post("/api/products/3/adjust-stock", json={"operation": "add", "qty": 1, "unit": "carton"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 216 + 24


def test_adjust_subtract_uses_unit(app_client):
    r = app_client.post("/api/products/3/adjust-stock", json={"operation": "subtract", "qty": 1, "unit": "carton"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 216 - 24


def test_adjust_set_absolute(app_client):
    r = app_client.post("/api/products/1/adjust-stock", json={"operation": "set", "qty": 7}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == 7


def test_adjust_subtract_below_zero_blocked(app_client):
    r = app_client.post("/api/products/2/adjust-stock", json={"operation": "subtract", "qty": 3}, headers=_h("admin-token"))
    assert r.status_code == 409
    assert "سالب" in r.json()["detail"]
    p = next(p for p in app_client.get("/api/products", headers=_h("admin-token")).json() if p["id"] == 2)
    assert p["stock"] == 2  # unchanged


def test_adjust_set_never_negative(app_client):
    r = app_client.post("/api/products/2/adjust-stock", json={"operation": "set", "qty": -1}, headers=_h("admin-token"))
    assert r.status_code == 422  # pydantic ge=0


def test_adjust_invalid_operation(app_client):
    r = app_client.post("/api/products/1/adjust-stock", json={"operation": "multiply", "qty": 5}, headers=_h("admin-token"))
    assert r.status_code == 400


def test_adjust_employee_forbidden(app_client):
    r = app_client.post("/api/products/1/adjust-stock", json={"operation": "add", "qty": 5}, headers=_h("employee-token"))
    assert r.status_code == 403


# ---------------- Product update (edit + capacity lock) ----------------

def test_update_minimum_stock_and_name(app_client):
    r = app_client.put("/api/products/3", json={"name": "برجر طازج", "minimum_stock": 60}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["name"] == "برجر طازج"
    assert r.json()["minimum_stock"] == 60
    assert r.json()["stock"] == 216  # untouched


def test_update_minimum_stock_negative_rejected(app_client):
    r = app_client.put("/api/products/3", json={"minimum_stock": -5}, headers=_h("admin-token"))
    assert r.status_code == 422


def test_update_price_does_not_change_stock(app_client):
    p = next(p for p in app_client.get("/api/products", headers=_h("admin-token")).json() if p["id"] == 3)
    r = app_client.put("/api/products/3", json={"price": 12}, headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert body["price"] == 12
    assert body["stock"] == p["stock"] == 216


def test_update_name_does_not_change_stock(app_client):
    before = next(p for p in app_client.get("/api/products", headers=_h("admin-token")).json() if p["id"] == 3)
    r = app_client.put("/api/products/3", json={"name": "برجر مميز"}, headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["stock"] == before["stock"]


def test_capacity_change_allowed_when_no_stock_no_sales(app_client):
    r = app_client.post("/api/products", json={"name": "علبة", "unit_type": "carton", "pieces_per_carton": 6, "price": 12, "stock": 0}, headers=_h("admin-token"))
    pid = r.json()["id"]
    r2 = app_client.put(f"/api/products/{pid}", json={"unit_type": "carton", "pieces_per_carton": 8}, headers=_h("admin-token"))
    assert r2.status_code == 200
    assert r2.json()["pieces_per_carton"] == 8


def test_capacity_change_locked_with_stock(app_client):
    r = app_client.put("/api/products/3", json={"unit_type": "carton", "pieces_per_carton": 12}, headers=_h("admin-token"))
    assert r.status_code == 409
    assert "سعة" in r.json()["detail"]


def test_capacity_change_locked_with_sales(app_client):
    # create fresh product, sell one piece (sale exists, stock becomes 0)
    r = app_client.post("/api/products", json={"name": "شاي2", "unit_type": "carton", "pieces_per_carton": 10, "price": 5, "stock": 10}, headers=_h("admin-token"))
    pid = r.json()["id"]
    app_client.post("/api/sales", json={"cashier_name": "مريم", "items": [{"id": pid, "qty": 1, "selling_unit": "piece"}]}, headers=_h("employee-token"))
    r2 = app_client.put(f"/api/products/{pid}", json={"unit_type": "carton", "pieces_per_carton": 12}, headers=_h("admin-token"))
    assert r2.status_code == 409
    assert "مبيعات" in r2.json()["detail"]


def test_capacity_not_locked_when_nothing_changes(app_client):
    # same values re-sent -> no lock (no effective change)
    r = app_client.put("/api/products/3", json={"unit_type": "carton", "pieces_per_carton": 24}, headers=_h("admin-token"))
    assert r.status_code == 200


def test_products_api_reports_capacity_locked(app_client):
    r = app_client.get("/api/products", headers=_h("employee-token"))
    products = {p["id"]: p for p in r.json()}
    assert products[3]["capacity_locked"] is True    # has stock
    assert products[2]["capacity_locked"] is True    # has stock


# ---------------- Dashboard data cycle (products + sales + summary) ----------------

def test_list_sales_admin_only_with_date_filter(app_client):
    _seed_performance_data(app_client)
    r = app_client.get("/api/sales", params={"from": "2026-08-01T00:00:00+00:00"}, headers=_h("admin-token"))
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3  # June invoice excluded
    assert all(s["id"] != 104 for s in body)

    r2 = app_client.get("/api/sales", params={"from": "not-a-date"}, headers=_h("admin-token"))
    assert r2.status_code == 422


def test_dashboard_employee_percentages_real(app_client):
    _seed_performance_data(app_client)
    body = app_client.get("/api/sales/employee-summary", headers=_h("admin-token")).json()
    by_name = {e["name"]: e for e in body["employees"]}
    assert abs(sum(e["percentage"] for e in body["employees"]) - 100.0) < 0.01
    expected = round(by_name["مريم"]["total_amount"] / body["total_amount"] * 100, 2)
    assert by_name["مريم"]["percentage"] == expected


def test_dashboard_products_match_pos_products(app_client):
    # same backend source: one GET drives Dashboard + POS + Inventory
    app_client.post("/api/products/3/receive-stock", json={"qty": 1, "unit": "carton"}, headers=_h("admin-token"))
    r = app_client.get("/api/products", headers=_h("admin-token"))
    p = next(x for x in r.json() if x["id"] == 3)
    assert p["stock"] == 240
    assert p["stock_qty"] == 240


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


# ---------------- Returns (إرجاع المبيعات واستعادة المخزون) ----------------

def _sell_carton(app_client, qty=1, product_id=3, emp="employee-token"):
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": product_id, "qty": qty, "selling_unit": "carton"}]},
        headers=_h(emp),
    )
    assert r.status_code == 200
    items = app_client.app.state.fake.tables["sale_items"].rows
    return r.json()["id"], items[-1]["id"]


def test_return_full_carton_restores_stock_exactly(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    carton = next(p for p in products if p["id"] == 3)  # carton 24 pcs, stock 216
    sale_id, item_id = _sell_carton(app_client)  # stock -> 192

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 1, "unit": "carton"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert r.json()["return_id"] == 1
    assert carton["stock_qty"] == 216  # exactly back to pre-sale value

    listed = app_client.get("/api/sales", headers=_h("admin-token")).json()
    row = next(s for s in listed if s["id"] == sale_id)
    assert row["return_status"] == "full"
    assert row["returned_base_qty"] == 24


def test_return_partial_pieces_keeps_remaining(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    carton = next(p for p in products if p["id"] == 3)
    sale_id, item_id = _sell_carton(app_client)  # stock 192

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 5, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert carton["stock_qty"] == 197  # 216 - 24 + 5

    detail = app_client.get(f"/api/sales/{sale_id}", headers=_h("admin-token")).json()
    line = detail["items"][0]
    assert line["returned_base_qty"] == 5
    assert line["remaining_base_qty"] == 19
    assert detail["sale"]["return_status"] == "partial"


def test_return_sack_full_and_kg_partial(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    sack = next(p for p in products if p["id"] == 4)  # sack 25 kg, stock 125
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "مريم", "items": [{"id": 4, "qty": 1, "selling_unit": "sack"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200
    sale_id = r.json()["id"]
    item_id = app_client.app.state.fake.tables["sale_items"].rows[-1]["id"]
    assert sack["stock_qty"] == 100

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 10, "unit": "kg"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert sack["stock_qty"] == 110  # kg partial

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 15, "unit": "kg"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert sack["stock_qty"] == 125  # fully back


def test_return_over_sold_409_arabic_message(app_client):
    sale_id, item_id = _sell_carton(app_client)  # remaining 24 base
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 5, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200  # 5 returned -> remaining 19

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 20, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 409
    body = r.json()
    assert "أكبر من المباع" in body["detail"]
    assert "19" in body["detail"]


def test_double_return_same_item_exceeding_is_409(app_client):
    sale_id, item_id = _sell_carton(app_client)
    for qty in (10, 10):
        r = app_client.post(
            f"/api/sales/{sale_id}/return",
            json={"items": [{"sale_item_id": item_id, "qty": qty, "unit": "piece"}]},
            headers=_h("admin-token"),
        )
    # 10 + 10 = 20 <= 24 -> OK; a third return of 10 would exceed
    assert r.status_code == 200
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 10, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 409
    assert "4" in r.json()["detail"]  # remaining = 24 - 20 = 4


def test_return_idempotent_same_key_single_row(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    carton = next(p for p in products if p["id"] == 3)
    sale_id, item_id = _sell_carton(app_client)
    payload = {
        "items": [{"sale_item_id": item_id, "qty": 1, "unit": "carton"}],
        "client_request_id": "ret-key-1",
        "reason": "اختبار",
    }
    r1 = app_client.post(f"/api/sales/{sale_id}/return", json=payload, headers=_h("admin-token"))
    r2 = app_client.post(f"/api/sales/{sale_id}/return", json=payload, headers=_h("admin-token"))
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["return_id"] == r2.json()["return_id"]
    assert r2.json()["idempotent"] is True
    returns = app_client.app.state.fake.tables["returns"].rows
    assert len([x for x in returns if x.get("client_request_id") == "ret-key-1"]) == 1
    assert carton["stock_qty"] == 216  # restored exactly once


def test_return_concurrent_race_one_wins_one_409(app_client):
    products = app_client.app.state.fake.tables["products"].rows
    carton = next(p for p in products if p["id"] == 3)
    sale_id, item_id = _sell_carton(app_client)  # 192 left; remaining 24

    def do_return(tag):
        return app_client.post(
            f"/api/sales/{sale_id}/return",
            json={"items": [{"sale_item_id": item_id, "qty": 24, "unit": "piece"}],
                  "client_request_id": f"race-{tag}"},
            headers=_h("admin-token"),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(do_return, ["a", "b"]))

    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409]
    assert carton["stock_qty"] == 216  # restored exactly once, no lost update
    assert len(app_client.app.state.fake.tables["returns"].rows) == 1


def test_return_requires_inventory_permission(app_client):
    sale_id, item_id = _sell_carton(app_client)
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 1, "unit": "carton"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 403

    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 1, "unit": "carton"}]},
        headers=_h("employee-inv-token"),
    )
    assert r.status_code == 200


def test_return_detail_requires_reports(app_client):
    sale_id, item_id = _sell_carton(app_client)
    assert app_client.get(f"/api/sales/{sale_id}", headers=_h("employee-token")).status_code == 403
    r = app_client.get(f"/api/sales/{sale_id}", headers=_h("admin-token"))
    assert r.status_code == 200
    assert r.json()["sale"]["id"] == sale_id
    assert r.json()["items"][0]["unit_type"] == "carton"
    assert r.json()["items"][0]["pieces_per_carton"] == 24


def test_return_item_from_other_sale_rejected(app_client):
    sale_a, item_a = _sell_carton(app_client)
    sale_b, item_b = _sell_carton(app_client)
    r = app_client.post(
        f"/api/sales/{sale_a}/return",
        json={"items": [{"sale_item_id": item_b, "qty": 1, "unit": "carton"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 400
    assert "لا ينتمي" in r.json()["detail"]


def test_return_unknown_sale_404(app_client):
    sale_a, item_a = _sell_carton(app_client)
    r = app_client.post(
        "/api/sales/99999/return",
        json={"items": [{"sale_item_id": item_a, "qty": 1, "unit": "carton"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 404


def test_invoice_return_statuses_in_list(app_client):
    sale_a, item_a = _sell_carton(app_client)
    sale_b, item_b = _sell_carton(app_client)
    sale_c, item_c = _sell_carton(app_client)
    app_client.post(
        f"/api/sales/{sale_a}/return",
        json={"items": [{"sale_item_id": item_a, "qty": 5, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    app_client.post(
        f"/api/sales/{sale_b}/return",
        json={"items": [{"sale_item_id": item_b, "qty": 24, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    listed = app_client.get("/api/sales", headers=_h("admin-token")).json()
    by_id = {s["id"]: s for s in listed}
    assert by_id[sale_a]["return_status"] == "partial"
    assert by_id[sale_b]["return_status"] == "full"
    assert by_id[sale_c]["return_status"] == "none"


def _net_employee_total(app_client, name):
    data = app_client.get("/api/sales/employee-summary", headers=_h("admin-token")).json()
    for emp in data["employees"]:
        if emp["name"] == name:
            return emp["total_amount"], emp["percentage"]
    return None, None


def test_return_partial_net_revenue(app_client):
    fake = app_client.app.state.fake
    sale_id, item_id = _sell_carton(app_client)  # carton 24 -> 240.00, base 24
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 5, "unit": "piece"}],
              "reason": "كسر"},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert r.json()["returned_amount"] == 50.0  # 240 x 5/24

    detail = app_client.get(f"/api/sales/{sale_id}", headers=_h("admin-token")).json()
    assert detail["sale"]["total_amount"] == 240.0  # original NEVER changes
    assert detail["sale"]["returned_amount"] == 50.0
    assert detail["sale"]["net_total"] == 190.0

    listed = app_client.get("/api/sales", headers=_h("admin-token")).json()
    row = next(s for s in listed if s["id"] == sale_id)
    assert row["net_total"] == 190.0
    assert row["returned_amount"] == 50.0
    assert row["return_status"] == "partial"

    emp_total, _ = _net_employee_total(app_client, "مريم")
    assert emp_total == 190.0

    sale_row = next(s for s in fake.tables["sales"].rows if s["id"] == sale_id)
    assert sale_row["total_amount"] == 240.0
    assert sale_row["returned_amount"] == 50.0


def test_return_full_zeros_employee_contribution(app_client):
    fake = app_client.app.state.fake
    sale_id, item_id = _sell_carton(app_client)  # 240.00
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [{"sale_item_id": item_id, "qty": 24, "unit": "piece"}]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    assert r.json()["returned_amount"] == 240.0

    detail = app_client.get(f"/api/sales/{sale_id}", headers=_h("admin-token")).json()
    assert detail["sale"]["total_amount"] == 240.0
    assert detail["sale"]["returned_amount"] == 240.0
    assert detail["sale"]["net_total"] == 0.0
    assert detail["sale"]["return_status"] == "full"

    emp_total, emp_pct = _net_employee_total(app_client, "مريم")
    assert emp_total == 0.0
    assert emp_pct == 0.0

    sale_row = next(s for s in fake.tables["sales"].rows if s["id"] == sale_id)
    assert sale_row["total_amount"] == 240.0  # untouched forever


def test_return_duplicate_line_same_item_aggregated(app_client):
    fake = app_client.app.state.fake
    sale_id, item_id = _sell_carton(app_client)
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [
            {"sale_item_id": item_id, "qty": 6, "unit": "piece"},
            {"sale_item_id": item_id, "qty": 6, "unit": "piece"},
        ]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 200
    # 6 + 6 = 12 <= 24; each line worth 240 x 6/24 = 60 -> 120 total
    assert r.json()["returned_amount"] == 120.0
    ret_items = fake.tables["return_items"].rows
    assert len([i for i in ret_items if i.get("return_id") == r.json()["return_id"]]) == 2

    detail = app_client.get(f"/api/sales/{sale_id}", headers=_h("admin-token")).json()
    assert detail["sale"]["returned_amount"] == 120.0
    assert detail["sale"]["net_total"] == 120.0


def test_return_duplicate_line_aggregation_exceeds_409(app_client):
    fake = app_client.app.state.fake
    sale_id, item_id = _sell_carton(app_client)
    r = app_client.post(
        f"/api/sales/{sale_id}/return",
        json={"items": [
            {"sale_item_id": item_id, "qty": 20, "unit": "piece"},
            {"sale_item_id": item_id, "qty": 20, "unit": "piece"},
        ]},
        headers=_h("admin-token"),
    )
    assert r.status_code == 409
    assert "24" in r.json()["detail"]  # remaining before any return = 24
    assert fake.tables["returns"].rows == []  # atomic: nothing written
    assert fake.tables["return_items"].rows == []


def test_dashboard_analytics_without_returns_schema(app_client):
    """Live DB has NOT run migration 008 yet: no sales.returned_amount column
    and no returns/return_items tables. Analytics must still work."""
    fake = app_client.app.state.fake
    fake.schema_returned_missing = True
    fake.schema_returns_missing = True

    _sell_carton(app_client)  # مريم 240
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "كاشير عام", "items": [{"id": 3, "qty": 1, "selling_unit": "carton"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200

    resp = app_client.get("/api/sales/employee-summary", headers=_h("admin-token"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["invoice_count"] == 2
    assert body["total_amount"] == 480.0
    by_name = {e["name"]: e for e in body["employees"]}
    assert "مريم" in by_name and "كاشير عام" in by_name
    assert by_name["مريم"]["total_amount"] == 240.0
    assert by_name["كاشير عام"]["total_amount"] == 240.0
    assert abs(by_name["مريم"]["percentage"] - 50.0) < 0.01

    listed = app_client.get("/api/sales", headers=_h("admin-token")).json()
    assert len(listed) >= 2
    for s in listed:
        assert s["returned_amount"] == 0.0
        assert s["net_total"] == s["total_amount"]
        assert s["return_status"] == "none"

    detail = app_client.get(f"/api/sales/{listed[0]['id']}", headers=_h("admin-token"))
    assert detail.status_code == 200
    assert detail.json()["returns"] == []
    assert detail.json()["sale"]["net_total"] == detail.json()["sale"]["total_amount"]


def test_employee_summary_percentages_sum_100(app_client):
    _sell_carton(app_client)  # مريم 240
    r = app_client.post(
        "/api/sales",
        json={"cashier_name": "فاطمة", "items": [{"id": 3, "qty": 2, "selling_unit": "carton"}]},
        headers=_h("employee-token"),
    )
    assert r.status_code == 200

    body = app_client.get("/api/sales/employee-summary", headers=_h("admin-token")).json()
    pct_sum = round(sum(e["percentage"] for e in body["employees"]), 2)
    assert pct_sum == 100.0
    by_name = {e["name"]: e for e in body["employees"]}
    assert by_name["مريم"]["total_amount"] == 240.0
    assert by_name["فاطمة"]["total_amount"] == 480.0


def test_sales_today_filter_boundary_inclusive_utc(app_client):
    """created_at is stored as tz-aware UTC; the frontend sends naive ISO
    ranges. End boundary is INCLUSIVE; 00:00:00 of the next day is excluded."""
    fake = app_client.app.state.fake
    fake.tables["sales"].rows.append(
        {"id": 900, "employee_name": "مريم", "total_amount": 100.0,
         "returned_amount": 0, "created_at": "2026-08-08T23:59:59.999999+00:00"}
    )
    fake.tables["sales"].rows.append(
        {"id": 901, "employee_name": "فاطمة", "total_amount": 200.0,
         "returned_amount": 0, "created_at": "2026-08-09T00:00:00+00:00"}
    )
    qs = "from=2026-08-08T00:00:00&to=2026-08-08T23:59:59.999999"
    resp = app_client.get(f"/api/sales?{qs}", headers=_h("admin-token"))
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert 900 in ids and 901 not in ids

    summary = app_client.get(f"/api/sales/employee-summary?{qs}", headers=_h("admin-token"))
    assert summary.status_code == 200
    body = summary.json()
    assert body["invoice_count"] == 1
    assert body["total_amount"] == 100.0