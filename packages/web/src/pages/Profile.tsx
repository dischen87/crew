import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { IconArrowLeft, IconGolf, IconPlane } from "../components/Icons";
import Emoji from "../components/Emoji";
import { getHandicap, getFlights } from "../lib/api";

const EMOJI_OPTIONS = [
  "🏌️", "⛳", "🏆", "🎯", "💪", "🔥", "🎳", "⚡",
  "🦅", "🎿", "🏎️", "🎲", "🃏", "🍺", "🇬🇷", "🐯",
  "🦁", "🐺", "🦈", "🐻", "🦊", "🐉", "🎸", "⭐",
  "💎", "🚀", "🌊", "🍀", "🎪", "🧊", "☀️", "🌙",
];

interface Props {
  auth: {
    member: { id: string; display_name: string; avatar_emoji: string };
    event: { id: string };
  };
  onClose: () => void;
  onLogout: () => void;
  onUpdate: (member: { display_name: string; avatar_emoji: string }) => void;
}

export default function Profile({ auth, onClose, onLogout, onUpdate }: Props) {
  const [emoji, setEmoji] = useState(auth.member.avatar_emoji);
  const [displayName, setDisplayName] = useState(auth.member.display_name);
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [handicap, setHandicap] = useState<number | null>(null);
  const [flightInfo, setFlightInfo] = useState<any>(null);
  const [preferredTee, setPreferredTee] = useState("white");
  const [savingTee, setSavingTee] = useState(false);
  const token = localStorage.getItem("crew_token");
  const API_BASE = import.meta.env.VITE_API_URL || "/v2";

  const TEE_OPTIONS = [
    { value: "black", label: "Championship", color: "bg-gray-900 text-white" },
    { value: "white", label: "Herren", color: "bg-white border-2 border-dark/20" },
    { value: "yellow", label: "Herren Gelb", color: "bg-yellow-400" },
    { value: "red", label: "Damen", color: "bg-red-500 text-white" },
  ];

  useEffect(() => {
    getHandicap(auth.event.id)
      .then((d) => setHandicap(d.handicap ?? null))
      .catch(() => {});
    getFlights(auth.event.id)
      .then((d) => {
        const myFlight = d.flights?.find((f: any) =>
          f.direction === "outbound" && f.passengers?.some((p: any) => p.member_id === auth.member.id)
        );
        if (myFlight) setFlightInfo(myFlight);
      })
      .catch(() => {});
  }, [auth.event.id, auth.member.id]);

  const saveProfile = async (newEmoji?: string, newName?: string) => {
    setSaving(true);
    const updates: any = {};
    if (newEmoji !== undefined) updates.avatar_emoji = newEmoji;
    if (newName !== undefined) updates.display_name = newName;
    try {
      await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updatedMember = {
        display_name: newName ?? displayName,
        avatar_emoji: newEmoji ?? emoji,
      };
      onUpdate(updatedMember);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Save profile failed:", err);
    }
    setSaving(false);
  };

  const handleEmojiSelect = (e: string) => {
    setEmoji(e);
    saveProfile(e);
  };

  const handleNameSave = () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === auth.member.display_name) {
      setDisplayName(auth.member.display_name);
      setEditingName(false);
      return;
    }
    setEditingName(false);
    saveProfile(undefined, trimmed);
  };

  const firstName = displayName.split(" ")[0];

  return (
    <motion.div
      className="fixed inset-0 z-[9999] bg-surface-0 bg-grid safe-top safe-bottom overflow-y-auto"
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div className="max-w-lg mx-auto px-5 py-6 pb-20">
        {/* Back Button */}
        <motion.button
          onClick={onClose}
          className="w-10 h-10 bg-white border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs mb-6"
          whileTap={{ scale: 0.9 }}
        >
          <IconArrowLeft className="w-5 h-5 text-dark" />
        </motion.button>

        {/* Avatar & Name */}
        <div className="text-center mb-6">
          <motion.div
            className="w-24 h-24 mx-auto bg-white border-3 border-dark rounded-3xl shadow-brutal flex items-center justify-center mb-4"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.1 }}
          >
            <Emoji emoji={emoji} size={52} />
          </motion.div>
          {editingName ? (
            <div className="flex items-center justify-center gap-2 mx-auto max-w-[240px]">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") { setDisplayName(auth.member.display_name); setEditingName(false); } }}
                className="input-soft px-3 py-2 text-center font-extrabold text-lg w-full"
                autoFocus
              />
              <motion.button
                onClick={handleNameSave}
                className="btn-dark text-xs px-3 py-2 shrink-0"
                whileTap={{ scale: 0.9 }}
              >
                OK
              </motion.button>
            </div>
          ) : (
            <motion.button
              onClick={() => setEditingName(true)}
              className="group"
              whileTap={{ scale: 0.97 }}
            >
              <h2 className="text-3xl font-extrabold tracking-tight">
                {firstName}<span className="text-gold-400">.</span>
              </h2>
              <p className="text-xs text-dark/40 mt-1 font-bold group-hover:text-dark/60 transition-colors">
                {displayName} · Tippen zum Bearbeiten
              </p>
            </motion.button>
          )}
          {saved && (
            <motion.p
              className="text-xs font-bold text-emerald-600 mt-2"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Gespeichert!
            </motion.p>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="card p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <IconGolf className="w-4 h-4 text-dark/40" />
              <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Handicap</p>
            </div>
            <p className="text-2xl font-extrabold">
              {handicap != null ? handicap : <span className="text-dark/20">–</span>}
            </p>
          </div>
          <div className="card p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <IconPlane className="w-4 h-4 text-dark/40" />
              <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Flug</p>
            </div>
            {flightInfo ? (
              <>
                <p className="text-sm font-extrabold">{flightInfo.flight_number}</p>
                <p className="text-[10px] text-dark/40 font-medium mt-0.5">
                  {flightInfo.departure_airport} → {flightInfo.arrival_airport}
                </p>
              </>
            ) : (
              <p className="text-2xl font-extrabold text-dark/20">–</p>
            )}
          </div>
        </div>

        {/* Emoji Picker */}
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em]">
              Avatar ändern
            </p>
          </div>
          <div className="grid grid-cols-8 gap-2">
            {EMOJI_OPTIONS.map((e) => (
              <motion.button
                key={e}
                type="button"
                onClick={() => handleEmojiSelect(e)}
                disabled={saving}
                className={`w-11 h-11 flex items-center justify-center rounded-xl border-2 transition-all ${
                  emoji === e
                    ? "border-dark bg-gold-400 scale-110 shadow-brutal-xs"
                    : "border-dark/10 bg-white hover:border-dark/30"
                }`}
                whileTap={{ scale: 0.9 }}
              >
                <Emoji emoji={e} size={22} />
              </motion.button>
            ))}
          </div>
        </div>

        {/* Tee Preference */}
        <div className="card p-5 mb-4">
          <p className="text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-3">
            Bevorzugter Abschlag
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TEE_OPTIONS.map((tee) => (
              <motion.button
                key={tee.value}
                onClick={async () => {
                  setPreferredTee(tee.value);
                  setSavingTee(true);
                  try {
                    await fetch(`${API_BASE}/auth/profile`, {
                      method: "PUT",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ preferred_tee: tee.value }),
                    });
                  } catch {}
                  setSavingTee(false);
                }}
                disabled={savingTee}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                  preferredTee === tee.value
                    ? "border-dark bg-dark text-white shadow-brutal-xs"
                    : "border-dark/15 bg-white text-dark/60"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <span className={`w-4 h-4 rounded-full shrink-0 ${tee.color}`} />
                {tee.label}
              </motion.button>
            ))}
          </div>
          <p className="text-[10px] text-dark/30 mt-2 font-medium">
            Loch-Distanzen in der Scorecard werden fuer diesen Abschlag angezeigt.
          </p>
        </div>

        {/* Details Card */}
        <div className="card p-4">
          <p className="text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-3">
            Details
          </p>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-dark/40 font-medium">Name</span>
              <span className="font-bold">{displayName}</span>
            </div>
            {handicap != null && (
              <div className="flex justify-between items-center">
                <span className="text-dark/40 font-medium">Handicap</span>
                <span className="font-bold">{handicap}</span>
              </div>
            )}
            {flightInfo && (
              <div className="flex justify-between items-center">
                <span className="text-dark/40 font-medium">Hinflug</span>
                <span className="font-bold text-xs">
                  {flightInfo.flight_number} · {new Date(flightInfo.departure_time).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-dark/40 font-medium">Event</span>
              <span className="font-bold text-dark/40">{auth.event.id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        {/* Add Flight */}
        <FlightCard auth={auth} token={token} existingFlight={flightInfo} onUpdate={setFlightInfo} />

        {/* Logout Button */}
        <motion.button
          onClick={() => { if (confirm("Wirklich ausloggen?")) onLogout(); }}
          className="w-full mt-4 py-4 rounded-xl border-2 border-red-300 bg-red-50 text-red-600 font-bold text-sm"
          whileTap={{ scale: 0.98 }}
        >
          Ausloggen
        </motion.button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Flight Card                                                         */
/* ------------------------------------------------------------------ */

function FlightCard({ auth, token, existingFlight, onUpdate }: {
  auth: Props["auth"];
  token: string | null;
  existingFlight: any;
  onUpdate: (flight: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flight, setFlight] = useState({
    flight_number: existingFlight?.flight_number || "",
    departure_airport: existingFlight?.departure_airport || "",
    arrival_airport: existingFlight?.arrival_airport || "",
    departure_time: existingFlight?.departure_time?.slice(0, 16) || "",
    arrival_time: existingFlight?.arrival_time?.slice(0, 16) || "",
  });

  const API_BASE = import.meta.env.VITE_API_URL || "/v2";

  const handleSave = async () => {
    if (!flight.flight_number.trim()) return;
    setSaving(true);
    try {
      // Get or create outbound flight
      const res = await fetch(`${API_BASE}/flights/event/${auth.event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const flights = data.flights || [];

      // Check if outbound flight exists
      let flightId = flights.find((f: any) => f.direction === "outbound")?.id;

      if (!flightId) {
        // Create outbound flight
        const createRes = await fetch(`${API_BASE}/flights/event/${auth.event.id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            direction: "outbound",
            flight_number: flight.flight_number.trim(),
            departure_airport: flight.departure_airport.trim(),
            arrival_airport: flight.arrival_airport.trim(),
            departure_time: flight.departure_time || undefined,
            arrival_time: flight.arrival_time || undefined,
          }),
        });
        const created = await createRes.json();
        flightId = created.flight?.id;
      }

      onUpdate(flight);
      setEditing(false);
    } catch (err) {
      console.error("Save flight error:", err);
    }
    setSaving(false);
  };

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <IconPlane className="w-4 h-4 text-dark/40" />
          <p className="text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em]">Flug</p>
        </div>
        <motion.button
          onClick={() => setEditing(!editing)}
          className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark bg-gold-400"
          whileTap={{ scale: 0.9 }}
        >
          {editing ? "Abbrechen" : existingFlight ? "Bearbeiten" : "+ Flug"}
        </motion.button>
      </div>

      {!editing && existingFlight && (
        <div className="text-sm">
          <p className="font-extrabold">{existingFlight.flight_number}</p>
          <p className="text-dark/40 font-medium mt-0.5">
            {existingFlight.departure_airport} → {existingFlight.arrival_airport}
          </p>
        </div>
      )}

      {!editing && !existingFlight && (
        <p className="text-xs text-dark/30 font-medium">Noch kein Flug hinterlegt.</p>
      )}

      {editing && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="space-y-2.5"
        >
          <input
            type="text"
            value={flight.flight_number}
            onChange={(e) => setFlight({ ...flight, flight_number: e.target.value.toUpperCase() })}
            placeholder="Flugnr. (z.B. LX1810)"
            className="w-full px-3 py-2.5 input-soft text-sm font-bold"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={flight.departure_airport}
              onChange={(e) => setFlight({ ...flight, departure_airport: e.target.value.toUpperCase() })}
              placeholder="Von (ZRH)"
              className="px-3 py-2.5 input-soft text-sm font-bold text-center"
            />
            <input
              type="text"
              value={flight.arrival_airport}
              onChange={(e) => setFlight({ ...flight, arrival_airport: e.target.value.toUpperCase() })}
              placeholder="Nach (AYT)"
              className="px-3 py-2.5 input-soft text-sm font-bold text-center"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-dark/30 uppercase">Abflug</label>
              <input
                type="datetime-local"
                value={flight.departure_time}
                onChange={(e) => setFlight({ ...flight, departure_time: e.target.value })}
                className="w-full px-3 py-2 input-soft text-xs"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-dark/30 uppercase">Ankunft</label>
              <input
                type="datetime-local"
                value={flight.arrival_time}
                onChange={(e) => setFlight({ ...flight, arrival_time: e.target.value })}
                className="w-full px-3 py-2 input-soft text-xs"
              />
            </div>
          </div>
          <motion.button
            onClick={handleSave}
            disabled={!flight.flight_number.trim() || saving}
            className="w-full py-3 rounded-xl border-2 border-dark bg-gold-400 text-sm font-extrabold shadow-brutal-xs disabled:opacity-30"
            whileTap={{ scale: 0.98 }}
          >
            {saving ? "Speichern..." : "Flug speichern"}
          </motion.button>
        </motion.div>
      )}
    </div>
  );
}
