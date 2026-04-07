import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LocationData {
  member_id: string;
  display_name: string;
  avatar_emoji: string;
  lat: number;
  lng: number;
  updated_at: string;
}

interface Props {
  locations: LocationData[];
  myId: string;
  className?: string;
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
        width: 44px;
        height: 44px;
        background: ${isMe ? "#f5d565" : "#fff"};
        border: 3px solid #2d2d2d;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        box-shadow: 3px 3px 0px 0px #2d2d2d;
        position: relative;
        cursor: pointer;
        transition: transform 0.15s;
      ">
        ${emoji}
        <div style="
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          width: 12px;
          height: 12px;
          background: ${isMe ? "#f5d565" : "#fff"};
          border-right: 3px solid #2d2d2d;
          border-bottom: 3px solid #2d2d2d;
          transform: translateX(-50%) rotate(45deg);
        "></div>
      </div>
    `,
    iconSize: [44, 56],
    iconAnchor: [22, 56],
    popupAnchor: [0, -58],
  });
}

export default function LocationMap({ locations, myId, className = "" }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Default center: Belek, Turkey (golf resort area)
    const defaultCenter: L.LatLngTuple = [36.86, 31.06];

    mapInstance.current = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    // Sleek dark map tiles
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(mapInstance.current);

    // Zoom control bottom right
    L.control.zoom({ position: "bottomright" }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (locations.length === 0) return;

    const bounds = L.latLngBounds([]);

    locations.forEach((loc) => {
      if (!loc.lat || !loc.lng) return;
      const isMe = loc.member_id === myId;
      const icon = createEmojiIcon(loc.avatar_emoji || "👤", isMe);

      const marker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: isMe ? 1000 : 0 })
        .addTo(mapInstance.current!);

      const popup = L.popup({
        closeButton: false,
        className: "crew-popup",
        offset: [0, -4],
      }).setContent(`
        <div style="
          background: #fff;
          border: 2px solid #2d2d2d;
          border-radius: 14px;
          padding: 10px 14px;
          font-family: 'DM Sans', sans-serif;
          min-width: 120px;
          text-align: center;
          box-shadow: 3px 3px 0px 0px #2d2d2d;
        ">
          <p style="font-weight: 800; font-size: 14px; margin: 0 0 2px 0; color: #2d2d2d;">
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
      mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [locations, myId]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={mapRef}
        className="w-full rounded-2xl border-3 border-dark overflow-hidden shadow-brutal"
        style={{ height: 320 }}
      />
      {locations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark/50 rounded-2xl border-3 border-dark">
          <p className="text-white font-bold text-sm">Noch keine Standorte geteilt</p>
        </div>
      )}
      <style>{`
        .crew-popup .leaflet-popup-content-wrapper {
          background: transparent;
          border: none;
          box-shadow: none;
          padding: 0;
          margin: 0;
        }
        .crew-popup .leaflet-popup-content {
          margin: 0;
        }
        .crew-popup .leaflet-popup-tip {
          display: none;
        }
        .custom-emoji-marker {
          background: none !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}
