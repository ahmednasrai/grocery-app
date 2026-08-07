from app.core.config import SUPABASE_SERVICE_KEY, SUPABASE_URL, require_config
from app.core.pgrest import SupabaseClient


def get_supabase_client() -> SupabaseClient:
    require_config()
    return SupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)