import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { login as apiLogin, register as apiRegister, joinGroup as apiJoinGroup, storeAuth, getStoredAuth, clearToken, getGroup } from "../lib/api";

export interface AuthData {
  token: string;
  member: { id: string; display_name: string; is_admin: boolean; avatar_emoji: string };
  group: { id: string; name: string; invite_code?: string };
  event: { id: string; title: string; date_from: string; date_to: string; location: string; status: string };
}

interface AuthContextValue {
  auth: AuthData | null;
  loading: boolean;
  loginError: string;
  login: (name: string, password: string) => Promise<void>;
  register: (name: string, password: string, groupName: string, emoji?: string) => Promise<void>;
  join: (inviteCode: string, name: string, password: string, emoji?: string, pin?: string) => Promise<void>;
  logout: () => void;
  updateMember: (member: Partial<AuthData["member"]>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState("");

  // Restore auth from localStorage on mount
  useEffect(() => {
    const stored = getStoredAuth();
    if (stored?.token && stored?.member) {
      setAuth(stored as AuthData);
    }
    setLoading(false);
  }, []);

  // Refresh group data (invite_code, is_admin) when auth changes
  useEffect(() => {
    if (!auth?.group?.id) return;
    getGroup(auth.group.id).then((groupData) => {
      let needsUpdate = false;
      let updatedAuth = { ...auth };

      if (groupData?.invite_code && !auth.group.invite_code) {
        updatedAuth.group = { ...updatedAuth.group, invite_code: groupData.invite_code };
        needsUpdate = true;
      }

      if (groupData?.members) {
        const me = groupData.members.find((m: any) => m.id === auth.member.id);
        if (me && me.is_admin !== auth.member.is_admin) {
          updatedAuth.member = { ...updatedAuth.member, is_admin: me.is_admin };
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        localStorage.setItem("crew_group", JSON.stringify(updatedAuth.group));
        localStorage.setItem("crew_member", JSON.stringify(updatedAuth.member));
        setAuth(updatedAuth);
      }
    }).catch((err) => {
      if (err?.message === "Unauthorized") {
        clearToken();
        setAuth(null);
      }
    });
  }, [auth?.group?.id]);

  const login = useCallback(async (name: string, password: string) => {
    setLoginError("");
    try {
      const data = await apiLogin(name, password);
      storeAuth(data);
      setAuth(data);
    } catch (err: any) {
      setLoginError(err.message || "Login fehlgeschlagen");
      throw err;
    }
  }, []);

  const register = useCallback(async (name: string, password: string, groupName: string, emoji?: string) => {
    setLoginError("");
    try {
      const data = await apiRegister(name, password, groupName, emoji);
      storeAuth(data);
      setAuth(data);
    } catch (err: any) {
      setLoginError(err.message || "Registrierung fehlgeschlagen");
      throw err;
    }
  }, []);

  const join = useCallback(async (inviteCode: string, name: string, password: string, emoji?: string, pin?: string) => {
    setLoginError("");
    try {
      const data = await apiJoinGroup(inviteCode, name, password, emoji, pin);
      storeAuth(data);
      setAuth(data);
    } catch (err: any) {
      setLoginError(err.message || "Beitritt fehlgeschlagen");
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAuth(null);
  }, []);

  const updateMember = useCallback((member: Partial<AuthData["member"]>) => {
    setAuth((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, member: { ...prev.member, ...member } };
      localStorage.setItem("crew_member", JSON.stringify(updated.member));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ auth, loading, loginError, login, register, join, logout, updateMember }}>
      {children}
    </AuthContext.Provider>
  );
}
