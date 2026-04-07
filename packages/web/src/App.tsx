import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { login, storeAuth, getStoredAuth, clearToken } from "./lib/api";
import { IconHome, IconGolf, IconTrophy, IconChat, IconCamera, IconMenu } from "./components/Icons";
import { Spinner } from "./components/Motion";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Golf from "./pages/Golf";
import Leaderboard from "./pages/Leaderboard";
import Chat from "./pages/Chat";
import More from "./pages/More";
import Photos from "./pages/Photos";
import Profile from "./pages/Profile";

type Tab = "home" | "golf" | "ranking" | "chat" | "photos" | "more";

export interface AuthData {
  token: string;
  member: { id: string; display_name: string; is_admin: boolean; avatar_emoji: string };
  group: { id: string; name: string };
  event: { id: string; title: string; date_from: string; date_to: string; location: string; status: string };
}

export default function App() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored?.token && stored?.member && stored?.event) {
      setAuth(stored as AuthData);
    }
    setLoading(false);
  }, []);

  const handleLogin = useCallback(async (name: string, password: string, emoji?: string) => {
    setLoginError("");
    try {
      const data = await login(name, password, emoji);
      storeAuth(data);
      setAuth(data);
    } catch (err: any) {
      setLoginError(err.message || "Login fehlgeschlagen");
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    setAuth(null);
    setTab("home");
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 bg-grid flex items-center justify-center">
        <Spinner size={40} />
      </div>
    );
  }

  if (!auth) {
    return <Login onLogin={handleLogin} error={loginError} />;
  }

  const renderTab = () => {
    switch (tab) {
      case "home": return <Home auth={auth} onNavigate={(t) => setTab(t as Tab)} />;
      case "golf": return <Golf auth={auth} />;
      case "ranking": return <Leaderboard auth={auth} />;
      case "chat": return null;
      case "photos": return <Photos auth={auth} />;
      case "more": return <More auth={auth} onLogout={handleLogout} />;
    }
  };

  const tabs: { id: Tab; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
    { id: "home", Icon: IconHome, label: "Home" },
    { id: "golf", Icon: IconGolf, label: "Golf" },
    { id: "ranking", Icon: IconTrophy, label: "Ranking" },
    { id: "chat", Icon: IconChat, label: "Chat" },
    { id: "photos", Icon: IconCamera, label: "Fotos" },
    { id: "more", Icon: IconMenu, label: "Mehr" },
  ];

  return (
    <div className="min-h-screen bg-surface-0 bg-grid text-dark font-sans flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 header-glass safe-top">
        <div className="flex items-center justify-between max-w-lg mx-auto px-5 py-3">
          <h1 className="text-xl font-extrabold tracking-tight">
            CREW<span className="text-gold-400">.</span>
          </h1>
          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-2 bg-white border-2 border-dark px-3.5 py-1.5 rounded-full shadow-brutal-xs transition-all active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#2d2d2d]"
          >
            <span className="text-sm">{auth.member.avatar_emoji}</span>
            <span className="text-[11px] font-bold">
              {auth.member.display_name.split(" ")[0]}
            </span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto overscroll-contain max-w-lg mx-auto w-full px-5 py-6 pb-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.16, 0.84, 0.44, 1] }}
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-[9999] bg-white border-t-3 border-dark safe-bottom">
        <div className="max-w-lg mx-auto flex">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                type="button"
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-all duration-150 relative ${
                  active ? "" : ""
                }`}
              >
                {active && (
                  <motion.div
                    className="absolute -top-[3px] left-2 right-2 h-[4px] bg-gold-400 rounded-b-full"
                    layoutId="tab-indicator"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <t.Icon className={`w-6 h-6 ${active ? "text-dark" : "text-dark/30"}`} />
                <span className={`text-[9px] font-extrabold tracking-wider ${
                  active ? "text-dark" : "text-dark/30"
                }`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Chat overlay */}
      <AnimatePresence>
        {tab === "chat" && (
          <Chat auth={auth} onClose={() => setTab("home")} />
        )}
      </AnimatePresence>

      {/* Profile overlay */}
      <AnimatePresence>
        {showProfile && (
          <Profile
            auth={auth}
            onClose={() => setShowProfile(false)}
            onUpdate={(member) => {
              setAuth({ ...auth, member: { ...auth.member, ...member } });
              localStorage.setItem("crew_member", JSON.stringify({ ...auth.member, ...member }));
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
