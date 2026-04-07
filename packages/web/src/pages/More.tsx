import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { getFlights, getLocations } from "../lib/api";
import { IconPlane, IconGolf, IconMapPin, IconStar, IconInfo, IconLogout, IconHotel, IconCalendar, IconUsers } from "../components/Icons";
import { Spinner } from "../components/Motion";
import LocationMap from "../components/LocationMap";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

interface Props {
  auth: {
    member: { id: string; display_name: string; is_admin: boolean };
    event: { id: string; title: string };
    group: { id: string; invite_code?: string };
  };
  onLogout: () => void;
}

export default function More({ auth, onLogout }: Props) {
  const [tab, setTab] = useState<"flights" | "handicap" | "location" | "masters" | "info">("flights");
  const [flightData, setFlightData] = useState<any>(null);
  const [flightsLoading, setFlightsLoading] = useState(true);
  const [handicap, setHandicap] = useState("");
  const [handicapSaved, setHandicapSaved] = useState(false);
  const [handicapSaving, setHandicapSaving] = useState(false);
  const [locations, setLocations] = useState<any[]>([]);
  const [locationSharing, setLocationSharing] = useState(false);
  const token = localStorage.getItem("crew_token");

  useEffect(() => {
    getFlights(auth.event.id)
      .then((d) => { setFlightData(d); setFlightsLoading(false); })
      .catch(() => setFlightsLoading(false));
    loadHandicap();
    getLocations(auth.event.id).then((locs) => {
      setLocations(locs);
      // Auto-update location if user has shared before
      const hasShared = locs.some((l: any) => l.member_id === auth.member.id);
      if (hasShared && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              await fetch(`${API_BASE}/locations/${auth.event.id}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              });
              loadLocations();
            } catch {}
          },
          () => {}, // silently fail
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    });
  }, [auth.event.id]);

  const loadHandicap = async () => {
    try {
      const res = await fetch(`${API_BASE}/golf/handicap/${auth.event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.handicap !== null && data.handicap !== undefined) {
          setHandicap(String(data.handicap));
        }
      }
    } catch {}
  };

  const saveHandicap = async () => {
    const val = parseFloat(handicap);
    if (isNaN(val) || val < -5 || val > 54) return;
    setHandicapSaving(true);
    try {
      await fetch(`${API_BASE}/golf/handicap/${auth.event.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ handicap: val }),
      });
      setHandicapSaved(true);
      setTimeout(() => setHandicapSaved(false), 2000);
    } catch (err) {
      console.error("Save handicap failed:", err);
    }
    setHandicapSaving(false);
  };

  const loadLocations = async () => {
    try {
      const res = await fetch(`${API_BASE}/locations/${auth.event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
      }
    } catch {}
  };

  const shareLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocationSharing(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          await fetch(`${API_BASE}/locations/${auth.event.id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(loc),
          });
          localStorage.setItem("crew_location_shared", "1");
          await loadLocations();
        } catch (err) {
          console.error("Share location failed:", err);
        }
        setLocationSharing(false);
      },
      (err) => {
        console.error("Geolocation error:", err);
        setLocationSharing(false);
      },
      { enableHighAccuracy: true }
    );
  }, [auth.event.id, token]);

  const formatLocationTime = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (diffMin < 1) return "gerade eben";
    if (diffMin < 60) return `vor ${diffMin} Min`;
    if (diffMin < 1440) return `vor ${Math.floor(diffMin / 60)} Std`;
    return date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
  };

  const tabs = [
    { id: "flights" as const, Icon: IconPlane, label: "Flüge" },
    { id: "handicap" as const, Icon: IconGolf, label: "HCP" },
    { id: "location" as const, Icon: IconMapPin, label: "Standort" },
    { id: "masters" as const, Icon: IconStar, label: "Masters" },
    { id: "info" as const, Icon: IconInfo, label: "Info" },
  ];

  return (
    <div className="space-y-5">
      <div className="pt-2 pb-2">
        <div className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
          Extras
        </div>
        <h2 className="text-5xl font-extrabold tracking-tight leading-[1.05]">
          Mehr<span className="text-gold-400">.</span>
        </h2>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap py-2 px-3.5 text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 rounded-full border-2 border-dark ${
              tab === t.id ? "bg-dark text-white shadow-brutal-xs" : "bg-white text-dark/40"
            }`}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Flights Tab */}
      {tab === "flights" && (
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {flightsLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <>
              {(!flightData?.flights || flightData.flights.length === 0) ? (
                <div className="card p-8 text-center">
                  <div className="w-14 h-14 mx-auto bg-accent-mint border-2 border-dark rounded-2xl flex items-center justify-center mb-3">
                    <IconPlane className="w-7 h-7 text-dark" />
                  </div>
                  <p className="font-extrabold tracking-tight mb-1">Keine Flüge eingetragen</p>
                  <p className="text-sm text-dark/30 font-medium">Flugdaten werden hier angezeigt, sobald sie hinterlegt sind.</p>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-bold text-dark/40 uppercase tracking-[0.12em]">Hinflüge</p>
                  {flightData.flights
                    .filter((f: any) => f.direction === "outbound")
                    .map((flight: any) => <FlightCard key={flight.id} flight={flight} myId={auth.member.id} />)}

                  <p className="text-[11px] font-bold text-dark/40 uppercase tracking-[0.12em] mt-4">Rückflüge</p>
                  {flightData.flights
                    .filter((f: any) => f.direction === "return")
                    .map((flight: any) => <FlightCard key={flight.id} flight={flight} myId={auth.member.id} color="return" />)}
                </>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* Handicap Tab */}
      {tab === "handicap" && (
        <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="card p-5">
            <h3 className="font-extrabold tracking-tight mb-1">Dein Handicap</h3>
            <p className="text-sm text-dark/30 mb-4 font-medium">
              Gib dein aktuelles Handicap ein, damit die Stableford-Punkte korrekt berechnet werden.
            </p>
            <div className="flex gap-3">
              <input
                type="number"
                step="0.1"
                min="-5"
                max="54"
                value={handicap}
                onChange={(e) => { setHandicap(e.target.value); setHandicapSaved(false); }}
                placeholder="z.B. 18.4"
                className="flex-1 px-4 py-3 input-soft text-lg font-bold text-center"
                inputMode="decimal"
              />
              <motion.button
                onClick={saveHandicap}
                disabled={handicapSaving || !handicap}
                className={`px-5 py-3 text-sm ${
                  handicapSaved
                    ? "btn-mint"
                    : "btn-gold disabled:opacity-30"
                }`}
                whileTap={{ scale: 0.97 }}
              >
                {handicapSaving ? "..." : handicapSaved ? "OK!" : "Speichern"}
              </motion.button>
            </div>
          </div>

          <div className="card p-4 text-xs text-dark/30">
            <p className="font-bold text-dark/40 mb-1.5 uppercase tracking-wider text-[10px]">Stableford mit Handicap:</p>
            <ul className="space-y-1 list-disc list-inside font-medium">
              <li>Dein Handicap bestimmt die Vorgabe-Schläge pro Loch</li>
              <li>Löcher mit niedrigerem HCP-Index geben zuerst Extra-Schläge</li>
              <li>Fair für alle Spielstärken</li>
            </ul>
          </div>
        </motion.div>
      )}

      {/* Location Tab */}
      {tab === "location" && (
        <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {/* Map */}
          <LocationMap locations={locations} myId={auth.member.id} />

          {/* Share Button */}
          <motion.button
            onClick={shareLocation}
            disabled={locationSharing}
            className="w-full btn-gold disabled:opacity-30 py-3.5 text-sm flex items-center justify-center gap-2"
            whileTap={{ scale: 0.98 }}
          >
            {locationSharing ? (
              <><Spinner size={16} className="mr-1" /> Standort wird ermittelt...</>
            ) : (
              <><IconMapPin className="w-4 h-4" /> Meinen Standort teilen</>
            )}
          </motion.button>

          {/* Member List */}
          {locations.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Standorte</p>
              {locations.map((loc: any, i: number) => (
                <motion.a
                  key={loc.member_id}
                  href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card p-3.5 flex items-center justify-between block"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 bg-white border-2 border-dark rounded-lg flex items-center justify-center text-sm">
                      {loc.avatar_emoji || "👤"}
                    </span>
                    <div>
                      <p className="text-sm font-bold tracking-tight">{loc.display_name}</p>
                      <p className="text-[10px] text-dark/40 font-medium">{formatLocationTime(loc.updated_at)}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">
                    Maps →
                  </span>
                </motion.a>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Masters Tab */}
      {tab === "masters" && (
        <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="card-mint p-5">
            <h3 className="text-lg font-extrabold tracking-tight mb-1">Masters Pool 2026</h3>
            <p className="text-[11px] text-dark/40 font-bold mb-4">
              Jeder wählt 6 Golfer. Beste 4 von 6 Scores zählen.
            </p>
            <div className="space-y-2 mb-4">
              {[
                { label: "Einsatz", value: "20 CHF" },
                { label: "1. Platz", value: "50%" },
                { label: "2. Platz", value: "30%" },
                { label: "3. Platz", value: "20%" },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between px-3 py-2 bg-white border-2 border-dark rounded-xl">
                  <span className="text-sm text-dark/50 font-medium">{r.label}</span>
                  <span className="font-bold">{r.value}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <a href="http://www.easyofficepools.com/join/?p=464087&e=wlld" target="_blank" rel="noopener noreferrer"
                className="block w-full btn-dark py-3 text-center text-[11px] uppercase tracking-wider">
                Team wählen →
              </a>
              <a href="http://www.easyofficepools.com/leaderboard/?p=464087" target="_blank" rel="noopener noreferrer"
                className="block w-full bg-white border-2 border-dark rounded-full font-bold py-3 text-center text-[11px] uppercase tracking-wider">
                Live Leaderboard
              </a>
            </div>
          </div>
        </motion.div>
      )}

      {/* Info Tab */}
      {tab === "info" && (
        <motion.div className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-accent-mint border-2 border-dark rounded-xl flex items-center justify-center">
                <IconHotel className="w-3.5 h-3.5 text-dark" />
              </div>
              <span className="pill bg-accent-mint">Hotel</span>
            </div>
            <p className="font-extrabold tracking-tight">Cornelia Diamond Golf Resort & Spa</p>
            <p className="text-sm text-dark/30 mt-0.5 font-medium">Belek, Antalya, Türkei</p>
            <div className="mt-3 space-y-1.5 text-sm text-dark/40 font-medium">
              <p>Check-in: 08.04.2026</p>
              <p>Check-out: 15.04.2026 (7 Nächte)</p>
              <p>All-Inclusive / DIAI</p>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center">
                <IconCalendar className="w-3.5 h-3.5 text-dark" />
              </div>
              <span className="pill bg-gold-400">Buchung</span>
            </div>
            <div className="space-y-1.5 text-sm text-dark/40 font-medium">
              <p>Referenz: BLED-000008458</p>
              <p>Organisator: Benjamin Konzett</p>
              <p>Greenfee: ca. €403 pro Golfer</p>
            </div>
          </div>

          {/* Invite Link */}
          <InviteCard auth={auth} />

          <motion.button
            onClick={onLogout}
            className="w-full bg-red-500 text-white font-bold py-3 border-2 border-dark rounded-full shadow-brutal-sm text-sm mt-4 flex items-center justify-center gap-2 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_0px_#2d2d2d] transition-all"
            whileTap={{ scale: 0.98 }}
          >
            <IconLogout className="w-4 h-4" />
            Ausloggen
          </motion.button>
        </motion.div>
      )}
    </div>
  );
}

/* Flight Card */
function FlightCard({ flight, myId, color = "primary" }: { flight: any; myId: string; color?: string }) {
  const dep = (() => { const d = new Date(flight.departure_time); return {
    date: d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" }),
    time: d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
  }; })();
  const arr = (() => { const d = new Date(flight.arrival_time); return {
    date: d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" }),
    time: d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
  }; })();
  const isMyFlight = flight.passengers.some((p: any) => p.member_id === myId);
  const isReturn = color === "return";

  return (
    <motion.div
      className={`card p-4 ${isMyFlight ? "ring-2 ring-gold-400 ring-offset-2" : ""}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`pill ${isReturn ? "bg-accent-mint" : "bg-gold-400"}`}>{flight.flight_number}</span>
          <span className="text-xs text-dark/25 font-medium">{flight.airline}</span>
        </div>
        <span className="text-xs text-dark/20 font-medium">{dep.date}</span>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <p className="text-lg font-extrabold tabular-nums">{dep.time}</p>
          <p className="text-[10px] text-dark/25 font-medium">{flight.departure_airport}</p>
        </div>
        <div className="flex-1 flex items-center">
          <div className="h-[2px] bg-dark/10 flex-1" />
          <IconPlane className="w-4 h-4 mx-2 text-dark/20" />
          <div className="h-[2px] bg-dark/10 flex-1" />
        </div>
        <div className="text-center">
          <p className="text-lg font-extrabold tabular-nums">{arr.time}</p>
          <p className="text-[10px] text-dark/25 font-medium">{flight.arrival_airport}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {flight.passengers.map((p: any) => (
          <span key={p.member_id} className={`text-[10px] px-2 py-0.5 font-bold rounded-full border-2 ${
            p.member_id === myId
              ? "border-dark bg-gold-400"
              : "border-dark/15 bg-white text-dark/30"
          }`}>{p.display_name}</span>
        ))}
      </div>
    </motion.div>
  );
}

/* Invite Link Card — share invite link with friends */
function InviteCard({ auth }: { auth: Props["auth"] }) {
  const [copied, setCopied] = useState(false);
  const [guestName, setGuestName] = useState("");
  const inviteCode = auth.group.invite_code;

  if (!inviteCode) return null;

  const baseUrl = `https://crew-home.com/join/${inviteCode}`;
  const personalUrl = guestName.trim()
    ? `${baseUrl}?name=${encodeURIComponent(guestName.trim())}`
    : baseUrl;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("input");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const name = guestName.trim();
    if (navigator.share) {
      try {
        await navigator.share({
          title: "CREW — Tritt unserer Gruppe bei!",
          text: name
            ? `Hey ${name.split(" ")[0]}! Tritt unserer CREW bei:`
            : "Hey! Tritt unserer CREW bei:",
          url: personalUrl,
        });
        return;
      } catch {}
    }
    copyToClipboard(personalUrl);
  };

  return (
    <div className="card-mint p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 bg-white border-2 border-dark rounded-xl flex items-center justify-center">
          <IconUsers className="w-3.5 h-3.5 text-dark" />
        </div>
        <span className="pill bg-white">Einladen</span>
      </div>
      <p className="font-extrabold tracking-tight mb-1">Leute einladen</p>
      <p className="text-sm text-dark/50 font-medium mb-3">
        Gib den Namen ein, damit der Gast nur noch sein Passwort eingeben muss.
      </p>

      {/* Guest name input for personalized link */}
      <div className="mb-3">
        <input
          type="text"
          value={guestName}
          onChange={(e) => { setGuestName(e.target.value); setCopied(false); }}
          placeholder="Name des Gastes (optional)"
          className="w-full px-4 py-3 input-soft"
        />
      </div>

      {/* Generated link display */}
      <div className="bg-white border-2 border-dark rounded-xl px-3 py-2.5 flex items-center gap-2 mb-3">
        <p className="flex-1 text-[11px] font-bold text-dark/50 truncate select-all">
          {personalUrl}
        </p>
        <motion.button
          onClick={() => copyToClipboard(personalUrl)}
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark transition-all ${
            copied ? "bg-accent-mint" : "bg-gold-400"
          }`}
          whileTap={{ scale: 0.9 }}
        >
          {copied ? "Kopiert!" : "Kopieren"}
        </motion.button>
      </div>

      <motion.button
        onClick={handleShare}
        className="w-full btn-dark py-3 text-sm flex items-center justify-center gap-2"
        whileTap={{ scale: 0.98 }}
      >
        {guestName.trim()
          ? `Link an ${guestName.trim().split(" ")[0]} senden`
          : "Invite-Link teilen"}
      </motion.button>

      <p className="text-[10px] text-dark/40 font-medium mt-3 text-center">
        Code: <span className="font-bold">{inviteCode}</span> · Das Passwort separat senden
      </p>
    </div>
  );
}
