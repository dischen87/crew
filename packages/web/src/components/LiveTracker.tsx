import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { IconArrowLeft, IconMapPin } from "./Icons";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

interface LocationData {
  member_id: string;
  display_name: string;
  avatar_emoji: string;
  lat: number;
  lng: number;
  updated_at: string;
}

interface Props {
  auth: {
    member: { id: string; display_name: string; avatar_emoji: string };
    event: { id: string };
  };
  onClose: () => void;
}

function formatTimeAgo(d: string): string {
  const diffMin = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  if (diffMin < 1440) return `vor ${Math.floor(diffMin / 60)} Std`;
  return new Date(d).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

function createEmojiIcon(emoji: string, isMe: boolean): L.DivIcon {
  return L.divIcon({
    className: "custom-emoji-marker",
    html: `
      <div style="
        width: 48px; height: 48px;
        background: ${isMe ? "#f5d565" : "#fff"};
        border: 3px solid #2d2d2d;
        border-radius: 16px;
        display: flex; align-items: center; justify-content: center;
        font-size: 24px;
        box-shadow: 3px 3px 0px 0px #2d2d2d;
        position: relative;
      ">
        ${emoji}
        <div style="
          position: absolute; bottom: -6px; left: 50%;
          width: 12px; height: 12px;
          background: ${isMe ? "#f5d565" : "#fff"};
          border-right: 3px solid #2d2d2d;
          border-bottom: 3px solid #2d2d2d;
          transform: translateX(-50%) rotate(45deg);
        "></div>
      </div>
    `,
    iconSize: [48, 60],
    iconAnchor: [24, 60],
    popupAnchor: [0, -62],
  });
}

export default function LiveTracker({ auth, onClose }: Props) {
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [sharing, setSharing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const token = localStorage.getItem("crew_token");

  const loadLocations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/locations/${auth.event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
        setLastRefresh(new Date());
      }
    } catch {}
  }, [auth.event.id, token]);

  const shareLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setSharing(true);

    // Use watchPosition for continuous high-accuracy updates
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        try {
          await fetch(`${API_BASE}/locations/${auth.event.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          });
          localStorage.setItem("crew_location_shared", "1");
          await loadLocations();
        } catch {}
        setSharing(false);
      },
      () => setSharing(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    // Store watchId for cleanup
    return () => navigator.geolocation.clearWatch(watchId);
  }, [auth.event.id, token, loadLocations]);

  // Initial load + auto-refresh every 15s
  useEffect(() => {
    loadLocations();
    const interval = setInterval(loadLocations, 15_000);
    return () => clearInterval(interval);
  }, [loadLocations]);

  // Auto-share if user has shared before
  useEffect(() => {
    if (localStorage.getItem("crew_location_shared")) {
      shareLocation();
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current, {
      center: [36.86, 31.06],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(mapInstance.current);

    L.control.zoom({ position: "bottomright" }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapInstance.current) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (locations.length === 0) return;

    const bounds = L.latLngBounds([]);

    locations.forEach((loc) => {
      if (!loc.lat || !loc.lng) return;
      const isMe = loc.member_id === auth.member.id;
      const icon = createEmojiIcon(loc.avatar_emoji || "👤", isMe);

      const marker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: isMe ? 1000 : 0 })
        .addTo(mapInstance.current!);

      const popup = L.popup({
        closeButton: false,
        className: "crew-popup",
        offset: [0, -4],
      }).setContent(`
        <div style="
          background: #fff; border: 2px solid #2d2d2d; border-radius: 14px;
          padding: 10px 14px; font-family: 'DM Sans', sans-serif;
          min-width: 120px; text-align: center; box-shadow: 3px 3px 0px 0px #2d2d2d;
        ">
          <p style="font-weight: 800; font-size: 14px; margin: 0 0 2px; color: #2d2d2d;">
            ${loc.display_name}${isMe ? " (Du)" : ""}
          </p>
          <p style="font-size: 11px; color: rgba(45,45,45,0.4); margin: 0; font-weight: 600;">
            ${formatTimeAgo(loc.updated_at)}
          </p>
        </div>
      `);

      marker.bindPopup(popup);
      marker.on("click", () => marker.openPopup());
      markersRef.current.push(marker);
      bounds.extend([loc.lat, loc.lng]);
    });

    if (bounds.isValid()) {
      mapInstance.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [locations, auth.member.id]);

  return (
    <motion.div
      className="fixed inset-0 z-[10000] bg-dark flex flex-col"
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {/* Header */}
      <div className="shrink-0 bg-dark/90 backdrop-blur-md border-b border-white/10" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}>
        <div className="px-4 py-2.5 flex items-center gap-3">
          <motion.button
            onClick={onClose}
            className="w-10 h-10 bg-white/10 border-2 border-white/20 rounded-xl flex items-center justify-center shrink-0"
            whileTap={{ scale: 0.9 }}
          >
            <IconArrowLeft className="w-5 h-5 text-white" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-white leading-tight">Live Tracker</h2>
            <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
              {locations.length} Spieler · Aktualisiert {formatTimeAgo(lastRefresh.toISOString())}
            </p>
          </div>
          <motion.button
            onClick={shareLocation}
            disabled={sharing}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-xs font-bold ${
              sharing
                ? "border-white/20 bg-white/10 text-white/50"
                : "border-gold-400 bg-gold-400 text-dark"
            }`}
            whileTap={{ scale: 0.9 }}
          >
            <IconMapPin className="w-3.5 h-3.5" />
            {sharing ? "..." : "Teilen"}
          </motion.button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0 relative">
        <div ref={mapRef} className="w-full h-full" />

        {locations.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark/80">
            <span className="text-4xl mb-3">📍</span>
            <p className="text-white font-bold text-sm mb-1">Noch keine Standorte</p>
            <p className="text-white/40 text-xs font-medium mb-4">Teile deinen Standort, damit andere dich sehen</p>
            <motion.button
              onClick={shareLocation}
              disabled={sharing}
              className="px-6 py-3 bg-gold-400 border-2 border-dark rounded-xl text-sm font-extrabold shadow-brutal-xs"
              whileTap={{ scale: 0.95 }}
            >
              {sharing ? "Wird geteilt..." : "Standort teilen"}
            </motion.button>
          </div>
        )}
      </div>

      {/* Bottom player list */}
      {locations.length > 0 && (
        <div className="shrink-0 bg-dark/90 backdrop-blur-md border-t border-white/10" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)" }}>
          <div className="px-4 py-2.5 flex gap-2 overflow-x-auto no-scrollbar">
            {locations.map((loc) => {
              const isMe = loc.member_id === auth.member.id;
              return (
                <div
                  key={loc.member_id}
                  className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border-2 ${
                    isMe ? "border-gold-400 bg-gold-400/20" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className="text-lg">{loc.avatar_emoji || "👤"}</span>
                  <div>
                    <p className={`text-xs font-bold ${isMe ? "text-gold-400" : "text-white"}`}>
                      {loc.display_name.split(" ")[0]}
                    </p>
                    <p className="text-[9px] text-white/30 font-medium">{formatTimeAgo(loc.updated_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        .crew-popup .leaflet-popup-content-wrapper { background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; }
        .crew-popup .leaflet-popup-content { margin: 0; }
        .crew-popup .leaflet-popup-tip { display: none; }
        .custom-emoji-marker { background: none !important; border: none !important; }
      `}</style>
    </motion.div>
  );
}
