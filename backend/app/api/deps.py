from fastapi import Depends, HTTPException, Request

from app.core import gotrue

DEFAULT_EMPLOYEE_PERMISSIONS = ["pos"]

PERMISSION_POS = "pos"
PERMISSION_INVENTORY = "inventory"
PERMISSION_REPORTS = "reports"
PERMISSION_USERS = "users"

ALL_PERMISSIONS = [
    PERMISSION_POS,
    PERMISSION_INVENTORY,
    PERMISSION_REPORTS,
    PERMISSION_USERS,
]


def _extract_token(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    if not authorization.lower().startswith("bearer "):
        return ""
    return authorization[7:].strip()


def get_auth_user(request: Request) -> dict:
    """Validate the JWT from the Authorization header and return the auth user."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = gotrue.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def _normalize_permissions(raw) -> list:
    permissions = raw if isinstance(raw, list) else []
    if not permissions and isinstance(raw, str):
        permissions = [raw]
    return [p for p in permissions if isinstance(p, str)]


def get_current_profile(user: dict = Depends(get_auth_user)) -> dict:
    """Build the application profile (role + permissions) from the validated
    Supabase Auth user. Role/permissions are stored in user_metadata, which can
    only be written by the backend (GoTrue admin API with the secret key)."""
    meta = user.get("user_metadata") or {}

    role = meta.get("role", "employee")
    if role not in ("admin", "employee"):
        role = "employee"

    permissions = _normalize_permissions(meta.get("permissions"))
    if not permissions:
        permissions = list(DEFAULT_EMPLOYEE_PERMISSIONS)

    return {
        "id": user.get("id"),
        "email": user.get("email") or (user.get("user_metadata") or {}).get("email", ""),
        "role": role,
        "permissions": permissions,
    }


def require_admin(profile: dict = Depends(get_current_profile)) -> dict:
    if profile["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return profile


def require_permission(permission: str):
    def checker(profile: dict = Depends(get_current_profile)) -> dict:
        if profile["role"] == "admin":
            return profile
        if permission not in profile.get("permissions", []):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return profile

    return checker