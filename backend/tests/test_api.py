import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import products as products_module
from app.api import sales as sales_module


class FakeTable:
    def __init__(self, rows=None):
        self.rows = rows or []
        self._last_select = None

    def select(self, *_args, **_kwargs):
        self._last_select = ("select", _args, _kwargs)
        return self

    def insert(self, rows):
        self.rows.extend(rows)
        return self

    def update(self, values):
        self._updated_values = values
        return self

    def eq(self, column, value):
        self._eq = (column, value)
        return self

    def delete(self):
        return self

    def execute(self):
        return type("Resp", (), {"data": list(self.rows)})()


class FakeClient:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.tables = {}

    def table(self, name):
        if name not in self.tables:
            self.tables[name] = FakeTable(list(self.rows))
        return self.tables[name]


@pytest.fixture
def app_client(monkeypatch):
    fake_client = FakeClient([
        {"id": 1, "name": "شوكولاتة", "price": 10, "stock": 20, "image_url": None},
    ])

    monkeypatch.setattr(products_module, "get_supabase_client", lambda: fake_client)
    monkeypatch.setattr(sales_module, "get_supabase_client", lambda: fake_client)

    app = FastAPI()
    app.include_router(products_module.router)
    app.include_router(sales_module.router)

    return TestClient(app)


def test_list_products(app_client):
    response = app_client.get("/api/products")
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["name"] == "شوكولاتة"


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
    assert payload["items"][0]["qty"] == 2
