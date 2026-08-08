"""Minimal synchronous PostgREST client.

Supabase's new API keys (sb_publishable/sb_secret) are not JWTs, so the legacy
`supabase-py` client rejects them. PostgREST itself accepts these keys when they
are sent ONLY on the `apikey` header (never on Authorization: Bearer). This thin
client speaks the small subset of PostgREST that this app uses.
"""

import httpx


class Response:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, client, base, name, key):
        self._http = client
        self._base = base
        self._name = name
        self._key = key
        self._verb = "select"
        self._select = "*"
        self._payload = None
        self._filters = {}
        self._orders = []
        self._limit = None

    def select(self, *cols):
        self._verb = "select"
        if cols:
            self._select = ",".join(cols)
        return self

    def insert(self, rows):
        self._verb = "insert"
        self._payload = rows
        return self

    def update(self, values):
        self._verb = "update"
        self._payload = values
        return self

    def delete(self):
        self._verb = "delete"
        return self

    def eq(self, column, value):
        if isinstance(value, bool):
            value = "true" if value else "false"
        self._filters[column] = f"eq.{value}"
        return self

    def in_(self, column, values):
        self._filters[column] = "in.(" + ",".join(str(v) for v in values) + ")"
        return self

    def order(self, column, desc=False):
        direction = "desc" if desc else "asc"
        existing = [o for o in self._orders if o[0] != column]
        existing.append((column, direction))
        self._orders = existing
        return self

    def limit(self, count):
        self._limit = count
        return self

    def execute(self):
        url = f"{self._base}/{self._name}"
        headers = {
            "apikey": self._key,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        params = {}
        if self._verb == "select":
            params["select"] = self._select
        elif self._verb in ("update", "delete"):
            params["select"] = "*"

        for column, op_value in self._filters.items():
            params[column] = op_value

        if self._orders:
            params["order"] = ",".join(
                f"{col}.{dir_}" for col, dir_ in self._orders
            )

        if self._limit is not None:
            params["limit"] = self._limit

        method = {
            "select": "GET",
            "insert": "POST",
            "update": "PATCH",
            "delete": "DELETE",
        }[self._verb]

        try:
            res = self._http.request(
                method,
                url,
                headers=headers,
                params=params,
                json=self._payload,
                timeout=20,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"PostgREST request failed: {exc}") from exc

        if res.status_code >= 400:
            detail = res.text[:300]
            raise RuntimeError(f"PostgREST {res.status_code}: {detail}")

        body = res.json() if res.content else []
        if isinstance(body, dict):
            if "message" in body:
                raise RuntimeError(f"PostgREST error: {body['message']}")
            body = [body]
        if body is None:
            body = []
        return Response(body)


class SupabaseClient:
    def __init__(self, base_url: str, key: str):
        self._base = f"{base_url.rstrip('/')}/rest/v1"
        self._key = key
        # One shared HTTP client: connections are kept alive (TLS handshake
        # once) and reused across requests AND across threads - a large part
        # of dashboard latency was per-request reconnect overhead.
        self._http = httpx.Client(timeout=30)

    def table(self, name):
        return _Table(self._http, self._base, name, self._key)

    def rpc(self, name: str, params: dict | None = None):
        """Call a PostgREST RPC function (e.g. an atomic DB transaction).

        Returns the parsed JSON body. Raises RuntimeError carrying the
        PostgREST error message on failure.
        """
        url = f"{self._base}/rpc/{name}"
        headers = {
            "apikey": self._key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        try:
            res = self._http.post(
                url,
                headers=headers,
                json=params or {},
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"RPC request failed: {exc}") from exc

        if res.status_code >= 400:
            detail = res.text[:500]
            raise RuntimeError(f"RPC {res.status_code}: {detail}")

        if not res.content:
            return None
        return res.json()