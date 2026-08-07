import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getMe } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      try {
        const me = await getMe();
        if (active) setProfile(me);
        return me;
      } catch {
        if (active) {
          await supabase.auth.signOut();
          setProfile(null);
        }
        return null;
      }
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) {
        await loadProfile();
      }
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;
      if (event === 'SIGNED_IN' && session) {
        setLoading(true);
        await loadProfile();
        if (active) setLoading(false);
      } else if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        setProfile(null);
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const hasPermission = (permission) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return (profile.permissions || []).includes(permission);
  };

  return (
    <AuthContext.Provider value={{ profile, loading, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}