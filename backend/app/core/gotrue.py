import httpx
from fastapi import HTTPException

from app.core.config import (
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
    require_config,
)

_AUTH_TIMEOUT = 15.0


def _admin_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def verify_token(token: str) -> dict | None:
    """Validate a user's JWT against GoTrue. Returns the auth user dict or None."""
    require_config()
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"}
    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user", headers=headers, timeout=_AUTH_TIMEOUT
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    return response.json()


def _error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        return str(body.get("msg") or body.get("message") or response.text[:300])
    except Exception:
        return response.text[:300]


def admin_create_user(email: str, password: str, metadata: dict | None = None) -> dict:
    require_config()
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
    }
    if metadata:
        payload["user_metadata"] = metadata
    response = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=_admin_headers(),
        json=payload,
        timeout=_AUTH_TIMEOUT,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to create user: {_error_detail(response)}",
        )
    return response.json()


def admin_update_user(user_id: str, metadata: dict) -> dict:
    require_config()
    response = httpx.put(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers=_admin_headers(),
        json={"user_metadata": metadata},
        timeout=_AUTH_TIMEOUT,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to update user: {_error_detail(response)}",
        )
    return response.json()


def admin_set_user_active(user_id: str, active: bool) -> None:
    require_config()
    payload = {"ban_duration": "none" if active else "876000h"}
    response = httpx.put(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers=_admin_headers(),
        json=payload,
        timeout=_AUTH_TIMEOUT,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to update user status: {_error_detail(response)}",
        )


def admin_get_user(user_id: str) -> dict:
    require_config()
    response = httpx.get(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers=_admin_headers(),
        timeout=_AUTH_TIMEOUT,
    )
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
    if response.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to fetch user: {_error_detail(response)}",
        )
    return response.json()


def admin_list_users(page: int = 1, per_page: int = 200) -> list[dict]:
    require_config()
    response = httpx.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=_admin_headers(),
        params={"page": page, "per_page": per_page},
        timeout=_AUTH_TIMEOUT,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to list users: {_error_detail(response)}",
        )
    return response.json().get("users", [])