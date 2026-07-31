import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai import matcher as matcher_module
from app.api import products as products_module
from app.api import sales as sales_module
from app.api import vision as vision_module


class FakeTable:
    def __init__(self, rows=None, name="products"):
        self.rows = rows if rows is not None else []
        self.name = name
        self._pending_update = None
        self._pending_eq = None
        self._pending_delete = False

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, rows):
        if self.name == "products":
            for row in rows:
                new_row = dict(row)
                new_row.setdefault("id", len(self.rows) + 1)
                self.rows.append(new_row)
        elif self.name == "sales":
            for row in rows:
                new_row = dict(row)
                new_row.setdefault("id", len(self.rows) + 1)
                self.rows.append(new_row)
        elif self.name == "sale_items":
            self.rows.extend(rows)
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
        elif self._pending_update is not None:
            for row in self.rows:
                if row.get(column) == value:
                    row.update(self._pending_update)
            self._pending_update = None
        return self

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self._pending_eq and self._pending_update is None and not self._pending_delete:
            column, value = self._pending_eq
            filtered = [row for row in self.rows if row.get(column) == value]
            return type("Resp", (), {"data": filtered})()
        return type("Resp", (), {"data": list(self.rows)})()


class FakeClient:
    def __init__(self):
        self.tables = {
            "products": FakeTable(
                [{"id": 1, "name": "شوكولاتة", "price": 10, "unit_price": 10, "stock": 20, "stock_qty": 20, "image_url": None, "ai_images": []}],
                name="products",
            ),
            "sales": FakeTable([], name="sales"),
            "sale_items": FakeTable([], name="sale_items"),
        }

    def table(self, name):
        return self.tables[name]


@pytest.fixture
def app_client(monkeypatch):
    fake_client = FakeClient()

    monkeypatch.setattr(products_module, "get_supabase_client", lambda: fake_client)
    monkeypatch.setattr(sales_module, "get_supabase_client", lambda: fake_client)
    monkeypatch.setattr(vision_module, "get_supabase_client", lambda: fake_client)

    app = FastAPI()
    app.include_router(products_module.router)
    app.include_router(sales_module.router)
    app.include_router(vision_module.router)

    return TestClient(app)


def test_list_products(app_client):
    response = app_client.get("/api/products")
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["name"] == "شوكولاتة"
    assert payload[0]["stock"] == 20


def test_create_sale_reduces_stock(app_client):
    response = app_client.post(
        "/api/sales",
        json={
            "cashier_name": "مريم",
            "items": [{"id": 1, "qty": 2, "price": 10}],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_amount"] == 20
    assert payload["employee_name"] == "مريم"
    assert payload["items"][0]["qty"] == 2

    products = app_client.get("/api/products").json()
    assert products[0]["stock"] == 18


def test_delete_product(app_client):
    response = app_client.delete("/api/products/1")
    assert response.status_code == 200
    assert response.json()["deleted"] is True

    products = app_client.get("/api/products").json()
    assert products == []


def test_identify_without_training_images(app_client, monkeypatch):
    def fake_identify(*_args, **_kwargs):
        return None, "لم يتم التعرف على المنتج"

    monkeypatch.setattr(matcher_module, "identify_product_from_image", fake_identify)

    fake_client = FakeClient()
    fake_client.tables["products"].rows = [
        {
            "id": 2,
            "name": "مياه",
            "price": 5,
            "unit_price": 5,
            "stock": 10,
            "stock_qty": 10,
            "image_url": None,
            "ai_images": [],
        }
    ]
    monkeypatch.setattr(vision_module, "get_supabase_client", lambda: fake_client)

    response = app_client.post(
        "/api/scan/identify",
        files={"file": ("test.jpg", b"fake-image-bytes", "image/jpeg")},
    )
    assert response.status_code == 404
