import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Permission } from '../../shared/permissions';

export interface Me {
  id: string;
  email: string;
  full_name: string;
  role: string;
  role_id: string;
  max_discount_bp: number | null;
  must_change_password: boolean;
  permissions: string[];
}

interface AuthCtx {
  me: Me | null;
  settings: Record<string, string>;
  loading: boolean;
  can: (...p: Permission[]) => boolean;
  refresh: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await api.get('/api/settings'));
    } catch {
      /* ignoré */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/api/me');
      setMe(m);
      await reloadSettings();
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [reloadSettings]);

  useEffect(() => {
    refresh();
    const onUnauth = () => setMe(null);
    window.addEventListener('ndc:unauthorized', onUnauth);
    return () => window.removeEventListener('ndc:unauthorized', onUnauth);
  }, [refresh]);

  const can = useCallback((...p: Permission[]) => !!me && p.some((x) => me.permissions.includes(x)), [me]);
  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setMe(null);
    }
  };
  return <Ctx.Provider value={{ me, settings, loading, can, refresh, reloadSettings, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
