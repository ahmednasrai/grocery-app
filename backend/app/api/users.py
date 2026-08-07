from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import (
    ALL_PERMISSIONS,
    DEFAULT_EMPLOYEE_PERMISSIONS,
    get_current_profile,
    require_permission,
)
from app.core import gotrue

router = APIRouter()


class UserCreate(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=6)


class UserUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|employee)$")
    permissions: list[str] | None = None
    is_active: bool | None = None


def _profile_from_auth_user(user: dict, current_user_id: str) -> dict:
    meta = user.get("user_metadata") or {}
    permissions = meta.get("permissions")
    if not isinstance(permissions, list):
        permissions = list(DEFAULT_EMPLOYEE_PERMISSIONS)

    role = meta.get("role", "employee")
    if role not in ("admin", "employee"):
        role = "employee"

    is_active = bool(meta.get("is_active", True))
    if user.get("banned_until") is not None:
        is_active = False

    return {
        "id": user.get("id"),
        "email": user.get("email", ""),
        "role": role,
        "is_active": is_active,
        "permissions": [p for p in permissions if isinstance(p, str)],
        "is_self": str(user.get("id")) == str(current_user_id),
    }


@router.get("/api/auth/me")
def get_me(profile: dict = Depends(get_current_profile)):
    return profile


@router.get("/api/users")
def list_users(_profile: dict = Depends(require_permission("users"))):
    current = _profile["id"]
    try:
        users = []
        for page in range(1, 20):
            batch = gotrue.admin_list_users(page=page, per_page=200)
            users.extend(batch)
            if len(batch) < 200:
                break
        return [_profile_from_auth_user(u, current) for u in users]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to fetch users: {exc}") from exc


@router.post("/api/users", status_code=201)
def create_user(
    payload: UserCreate,
    _profile: dict = Depends(require_permission("users")),
):
    email = str(payload.email).strip().lower()
    metadata = {
        "role": "employee",
        "permissions": list(DEFAULT_EMPLOYEE_PERMISSIONS),
        "is_active": True,
    }
    try:
        auth_user = gotrue.admin_create_user(email, payload.password, metadata)
    except HTTPException as exc:
        if "already registered" in str(exc.detail).lower():
            raise HTTPException(status_code=409, detail="هذا البريد مسجل مسبقاً")
        raise

    return _profile_from_auth_user(auth_user, _profile["id"])


@router.put("/api/users/{user_id}")
def update_user(
    user_id: str,
    payload: UserUpdate,
    _profile: dict = Depends(require_permission("users")),
):
    uid = str(user_id)

    if uid == str(_profile["id"]):
        if payload.role is not None and payload.role != "admin":
            raise HTTPException(status_code=400, detail="لا يمكنك تغيير دورك من مشرف")
        if payload.is_active is False:
            raise HTTPException(status_code=400, detail="لا يمكنك تعطيل حسابك الحالي")

    if payload.permissions is not None:
        invalid = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid permissions: {invalid}")

    try:
        existing = gotrue.admin_get_user(uid)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to find user: {exc}") from exc

    meta = dict(existing.get("user_metadata") or {})
    if payload.role is not None:
        meta["role"] = payload.role
    if payload.permissions is not None:
        meta["permissions"] = list(payload.permissions)
    if payload.is_active is not None:
        meta["is_active"] = bool(payload.is_active)
        gotrue.admin_set_user_active(uid, payload.is_active)

    gotrue.admin_update_user(uid, meta)
    updated = gotrue.admin_get_user(uid)
    return _profile_from_auth_user(updated, _profile["id"])