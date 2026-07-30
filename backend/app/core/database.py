import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL", "https://pvcvfzslwxapryagsdzc.supabase.co")
    supabase_key = os.getenv("SUPABASE_KEY", "sb_publishable_iV7jz3ZI8QlmBvYD8urDGw_ib70WvDN")
    return create_client(supabase_url, supabase_key)
