import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getEvent } from "../lib/api";

export interface EventModule {
  module_id: string;
  type: string;
  config: Record<string, any>;
  sort_order: number;
}

export interface EventData {
  id: string;
  title: string;
  type: string;
  date_from: string;
  date_to: string;
  location: string;
  status: string;
  cover_image?: string;
}

interface EventContextValue {
  event: EventData | null;
  modules: EventModule[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEvent must be inside EventProvider");
  return ctx;
}

/** Maps module types to tab configuration */
export const MODULE_TAB_MAP: Record<string, { path: string; label: string }> = {
  golf: { path: "/golf", label: "Golf" },
  leaderboard: { path: "/ranking", label: "Ranking" },
  chat: { path: "/chat", label: "Chat" },
  media: { path: "/photos", label: "Fotos" },
  flights: { path: "/more", label: "Mehr" },
  masters_pool: { path: "/more", label: "Mehr" },
};

export function EventProvider({ eventId, children }: { eventId: string; children: ReactNode }) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [modules, setModules] = useState<EventModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getEvent(eventId)
      .then((data) => {
        setEvent(data.screen?.event || null);
        setModules(data.screen?.sections || []);
      })
      .catch((err) => {
        setError(err.message || "Event konnte nicht geladen werden");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [eventId]);

  return (
    <EventContext.Provider value={{ event, modules, loading, error, reload: load }}>
      {children}
    </EventContext.Provider>
  );
}
