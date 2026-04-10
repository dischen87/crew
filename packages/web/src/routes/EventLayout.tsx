import { useState, useMemo, useEffect } from "react";
import { Outlet, useNavigate, useParams, useMatchRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { EventProvider, useEvent } from "../contexts/EventContext";
import { IconHome, IconGolf, IconTrophy, IconChat, IconCamera, IconMenu } from "../components/Icons";
import Emoji from "../components/Emoji";
import { Spinner } from "../components/Motion";
import Profile from "../pages/Profile";
import LiveTracker from "../components/LiveTracker";
import FlightEditor from "../components/FlightEditor";

/** Icon mapping for module types */
const MODULE_ICONS: Record<string, any> = {
  golf: IconGolf,
  leaderboard: IconTrophy,
  chat: IconChat,
  media: IconCamera,
  flights: IconMenu,
  masters_pool: IconMenu,
};

/** Route path mapping for module types */
const MODULE_PATHS: Record<string, string> = {
  golf: "/golf",
  leaderboard: "/ranking",
  chat: "/chat",
  media: "/photos",
  flights: "/more",
  masters_pool: "/more",
};

/** Display labels for module types */
const MODULE_LABELS: Record<string, string> = {
  golf: "Golf",
  leaderboard: "Ranking",
  chat: "Chat",
  media: "Fotos",
  flights: "Mehr",
  masters_pool: "Mehr",
};

export default function EventLayout() {
  const { eventId } = useParams({ from: "/events/$eventId" });

  return (
    <EventProvider eventId={eventId}>
      <EventLayoutInner />
    </EventProvider>
  );
}

function EventLayoutInner() {
  const { auth, logout, updateMember } = useAuth();
  const { modules, loading: eventLoading, error: eventError } = useEvent();
  const navigate = useNavigate();
  const { eventId } = useParams({ from: "/events/$eventId" });
  const matchRoute = useMatchRoute();
  const [showProfile, setShowProfile] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [flightEditorRound, setFlightEditorRound] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<any[]>([]);

  // Load members for flight editor
  useEffect(() => {
    if (!auth?.group?.id) return;
    import("../lib/api").then(({ getGroup }) => {
      getGroup(auth.group.id).then((g: any) => setAllMembers(g.members || [])).catch(() => {});
    });
  }, [auth?.group?.id]);

  // Listen for tracker navigation from child pages
  useEffect(() => {
    const trackerHandler = () => setShowTracker(true);
    const flightHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.roundId) setFlightEditorRound(detail.roundId);
    };
    window.addEventListener("open-tracker", trackerHandler);
    window.addEventListener("open-flight-editor", flightHandler);
    return () => {
      window.removeEventListener("open-tracker", trackerHandler);
      window.removeEventListener("open-flight-editor", flightHandler);
    };
  }, []);

  // Build tabs dynamically from event modules
  const tabs = useMemo(() => {
    // Always show Home first
    const result = [{ id: "home", path: "/", Icon: IconHome, label: "Home" }];

    if (modules.length === 0) {
      // Fallback: show all tabs when modules haven't loaded yet
      return [
        { id: "home", path: "/", Icon: IconHome, label: "Home" },
        { id: "golf", path: "/golf", Icon: IconGolf, label: "Golf" },
        { id: "ranking", path: "/ranking", Icon: IconTrophy, label: "Ranking" },
        { id: "chat", path: "/chat", Icon: IconChat, label: "Chat" },
        { id: "photos", path: "/photos", Icon: IconCamera, label: "Fotos" },
        { id: "more", path: "/more", Icon: IconMenu, label: "Mehr" },
      ];
    }

    // Deduplicate tabs (flights + masters_pool both map to /more)
    const seenPaths = new Set<string>(["/"]); // home already added
    for (const mod of modules) {
      const path = MODULE_PATHS[mod.type];
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);

      result.push({
        id: mod.type,
        path,
        Icon: MODULE_ICONS[mod.type] || IconMenu,
        label: MODULE_LABELS[mod.type] || mod.type,
      });
    }

    return result;
  }, [modules]);

  // Determine active tab from current route
  const getActiveTab = () => {
    if (matchRoute({ to: "/events/$eventId/golf/$roundId", fuzzy: true })) return "golf";
    for (const tab of tabs) {
      if (tab.path === "/") continue;
      if (matchRoute({ to: `/events/$eventId${tab.path}` as any, fuzzy: true })) return tab.id;
    }
    return "home";
  };

  const activeTab = getActiveTab();

  const handleTabClick = (tab: typeof tabs[number]) => {
    navigate({ to: `/events/${eventId}${tab.path}` });
  };

  // Auth guard — redirect to login if not authenticated
  if (!auth) {
    navigate({ to: "/login" });
    return null;
  }

  // Event loading state
  if (eventLoading) {
    return (
      <div className="h-full bg-surface-0 bg-grid flex items-center justify-center">
        <Spinner size={40} />
      </div>
    );
  }

  // Event error state
  if (eventError) {
    return (
      <div className="h-full bg-surface-0 bg-grid flex items-center justify-center px-6">
        <div className="card p-8 text-center max-w-sm">
          <p className="text-4xl mb-4">😔</p>
          <p className="font-extrabold text-lg mb-2">Event nicht gefunden</p>
          <p className="text-dark/50 text-sm mb-6">{eventError}</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="btn-gold px-6 py-3 text-sm"
          >
            Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface-0 bg-grid text-dark font-sans flex flex-col overflow-hidden">
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
            <Emoji emoji={auth.member.avatar_emoji} size={18} />
            <span className="text-[11px] font-bold">
              {auth.member.display_name.split(" ")[0]}
            </span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-y-auto overscroll-none max-w-lg mx-auto w-full px-5 py-6 pb-28" style={{ WebkitOverflowScrolling: 'touch' as any }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.16, 0.84, 0.44, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Tab Bar — dynamic from event modules */}
      <nav className="fixed bottom-0 inset-x-0 z-[9999] bg-white border-t-3 border-dark safe-bottom" style={{ transform: 'translateZ(0)' }}>
        <div className="max-w-lg mx-auto flex">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleTabClick(t)}
                type="button"
                className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-all duration-150 relative"
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

      {/* Profile overlay */}
      <AnimatePresence>
        {showProfile && (
          <Profile
            auth={auth}
            onClose={() => setShowProfile(false)}
            onLogout={logout}
            onUpdate={(member) => updateMember(member)}
          />
        )}
      </AnimatePresence>

      {/* Live Tracker overlay */}
      <AnimatePresence>
        {showTracker && (
          <LiveTracker auth={auth} onClose={() => setShowTracker(false)} />
        )}
      </AnimatePresence>

      {/* Flight Editor overlay */}
      <AnimatePresence>
        {flightEditorRound && (
          <FlightEditor
            roundId={flightEditorRound}
            members={allMembers}
            onClose={() => setFlightEditorRound(null)}
            onSaved={() => window.dispatchEvent(new CustomEvent("flights-updated"))}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
