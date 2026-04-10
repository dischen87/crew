import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconUsers, IconCrown } from "./Icons";
import { Spinner } from "./Motion";
import Emoji from "./Emoji";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

const GAME_MODES = [
  { value: "individual", label: "Einzel", desc: "Jeder spielt fuer sich" },
  { value: "2v2", label: "2 vs 2", desc: "Zweier-Teams gegeneinander" },
  { value: "4v4", label: "4 vs 4", desc: "Vierer-Teams gegeneinander" },
  { value: "scramble", label: "Scramble", desc: "Team waehlt besten Ball" },
  { value: "best_ball", label: "Best Ball", desc: "Bester Score pro Team zaehlt" },
];

const FORMATS = [
  { value: "stableford", label: "Stableford" },
  { value: "strokeplay", label: "Strokeplay" },
  { value: "matchplay", label: "Matchplay" },
];

const TEE_COLORS: Record<string, string> = {
  black: "bg-gray-900", blue: "bg-blue-600", white: "bg-white border-2 border-dark/20",
  yellow: "bg-yellow-400", red: "bg-red-500", orange: "bg-orange-400", green: "bg-green-500",
};

interface Props {
  auth: {
    member: { id: string; display_name: string; is_admin: boolean };
    group: { id: string; invite_code?: string };
    event: { id: string };
  };
}

interface Member {
  id: string;
  display_name: string;
  avatar_emoji: string;
  is_admin: boolean;
  joined_at: string;
}

// Known members from the Belek trip (seeded list)
const EXPECTED_MEMBERS = [
  "Benjamin Konzett",
  "Patrick Widmer",
  "Michael Widmer",
  "David Widmer",
  "Kevin Amacker",
  "Constantine Lagoudakis",
  "Dominik Bohren",
  "Dygis Winkler",
  "Mathias Inäbnit",
  "Martin Steffen",
  "Christof Schaub",
  "Mathias Graf",
  "Roger Forrer",
  "David Grossenbacher",
  "Kevin Neuhaus",
];

export default function AdminPanel({ auth }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const token = localStorage.getItem("crew_token");

  const inviteCode = auth.group.invite_code || "";
  const defaultPassword = "BelekGolf4ever";

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch {}
    setLoading(false);
  };

  const removeMember = async (id: string, name: string) => {
    if (!confirm(`${name} wirklich aus der Gruppe entfernen?`)) return;
    setRemoving(id);
    try {
      await fetch(`${API_BASE}/admin/members/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch {}
    setRemoving(null);
  };

  const copyText = async (text: string, label: string) => {
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
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // Find members from expected list who haven't joined yet
  const joinedNames = members.map((m) => m.display_name.toLowerCase().trim());
  const pendingMembers = EXPECTED_MEMBERS.filter(
    (name) => !joinedNames.includes(name.toLowerCase().trim())
  );

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  if (loading) {
    return <div className="flex justify-center py-10"><Spinner /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Password & Invite Info */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center">
            <IconCrown className="w-3.5 h-3.5 text-dark" />
          </div>
          <span className="pill bg-gold-400">Admin</span>
        </div>
        <p className="font-extrabold tracking-tight mb-3">Einladungs-Daten</p>

        {/* Invite Code */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between bg-surface-0 border-2 border-dark/10 rounded-xl px-4 py-3">
            <div>
              <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Einladungscode</p>
              <p className="text-lg font-extrabold tracking-tight mt-0.5">{inviteCode}</p>
            </div>
            <motion.button
              onClick={() => copyText(inviteCode, "code")}
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark ${
                copied === "code" ? "bg-accent-mint" : "bg-gold-400"
              }`}
              whileTap={{ scale: 0.9 }}
            >
              {copied === "code" ? "Kopiert!" : "Kopieren"}
            </motion.button>
          </div>

          {/* Password */}
          <div className="flex items-center justify-between bg-surface-0 border-2 border-dark/10 rounded-xl px-4 py-3">
            <div>
              <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Passwort</p>
              <p className="text-lg font-extrabold tracking-tight mt-0.5">
                {showPassword ? defaultPassword : "••••••••••••"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="text-[10px] font-bold text-dark/30 uppercase tracking-wider"
              >
                {showPassword ? "Verstecken" : "Zeigen"}
              </button>
              <motion.button
                onClick={() => copyText(defaultPassword, "pw")}
                className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark ${
                  copied === "pw" ? "bg-accent-mint" : "bg-gold-400"
                }`}
                whileTap={{ scale: 0.9 }}
              >
                {copied === "pw" ? "Kopiert!" : "Kopieren"}
              </motion.button>
            </div>
          </div>

          {/* Invite Link */}
          {inviteCode && (
            <div className="flex items-center justify-between bg-surface-0 border-2 border-dark/10 rounded-xl px-4 py-3">
              <div className="min-w-0 flex-1 mr-3">
                <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Einladungslink</p>
                <p className="text-xs font-bold text-dark/50 truncate mt-0.5">
                  crew-haus.com/join/{inviteCode}?pw=...
                </p>
              </div>
              <motion.button
                onClick={() => copyText(`https://crew-haus.com/join/${inviteCode}?pw=${encodeURIComponent(defaultPassword)}`, "link")}
                className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark ${
                  copied === "link" ? "bg-accent-mint" : "bg-gold-400"
                }`}
                whileTap={{ scale: 0.9 }}
              >
                {copied === "link" ? "Kopiert!" : "Kopieren"}
              </motion.button>
            </div>
          )}
        </div>

        <p className="text-[11px] text-dark/40 font-medium mt-3 leading-relaxed">
          Sende den Einladungslink + Passwort an neue Teilnehmer.
          Unter <span className="font-bold">Info → Einladen</span> kannst du personalisierte Links mit Namen erstellen.
        </p>
      </div>

      {/* Member List */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-accent-mint border-2 border-dark rounded-xl flex items-center justify-center">
              <IconUsers className="w-3.5 h-3.5 text-dark" />
            </div>
            <span className="pill bg-accent-mint">Teilnehmer</span>
          </div>
          <span className="text-xs font-bold text-dark/30">{members.length} Mitglieder</span>
        </div>

        <div className="space-y-1.5">
          {members.map((m, i) => (
            <motion.div
              key={m.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-surface-0 rounded-xl"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <span className="w-8 h-8 bg-white border-2 border-dark rounded-lg flex items-center justify-center text-sm shrink-0">
                {m.avatar_emoji || "👤"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm truncate">{m.display_name}</span>
                  {m.is_admin && (
                    <span className="text-[9px] font-bold bg-gold-400 border border-dark/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-dark/30 font-medium">
                  Beigetreten {formatDate(m.joined_at)}
                </p>
              </div>
              {/* Remove button (not for self or other admins) */}
              {m.id !== auth.member.id && !m.is_admin && (
                <motion.button
                  onClick={() => removeMember(m.id, m.display_name)}
                  disabled={removing === m.id}
                  className="shrink-0 text-[10px] text-red-500 font-bold px-2 py-1.5 rounded-lg border border-red-200 bg-red-50 disabled:opacity-30"
                  whileTap={{ scale: 0.9 }}
                >
                  {removing === m.id ? "..." : "Entfernen"}
                </motion.button>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Create Round */}
      <CreateRoundCard auth={auth} members={members} token={token} />

      {/* Manage Flights for existing rounds */}
      <FlightManager auth={auth} members={members} token={token} />

      {/* Pending Members */}
      {pendingMembers.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="pill bg-amber-100 border-amber-300">⏳ Ausstehend</span>
            </div>
            <span className="text-xs font-bold text-dark/30">{pendingMembers.length} offen</span>
          </div>
          <p className="text-xs text-dark/40 font-medium mb-3">
            Diese Teilnehmer haben sich noch nicht angemeldet:
          </p>
          <div className="space-y-1.5">
            {pendingMembers.map((name, i) => {
              const personalUrl = `https://crew-haus.com/join/${inviteCode}?pw=${encodeURIComponent(defaultPassword)}&name=${encodeURIComponent(name)}`;
              return (
                <motion.div
                  key={name}
                  className="flex items-center gap-3 px-3 py-2.5 bg-amber-50/50 border border-amber-200/50 rounded-xl"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <span className="w-8 h-8 bg-white border-2 border-dark/10 rounded-lg flex items-center justify-center text-sm shrink-0 text-dark/20">
                    ?
                  </span>
                  <span className="flex-1 font-bold text-sm text-dark/50">{name}</span>
                  <motion.button
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({
                          title: "CREW — Tritt bei!",
                          text: `Hey ${name.split(" ")[0]}! Tritt unserer CREW bei. Passwort: ${defaultPassword}`,
                          url: personalUrl,
                        }).catch(() => copyText(personalUrl, `invite-${name}`));
                      } else {
                        copyText(personalUrl, `invite-${name}`);
                      }
                    }}
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark ${
                      copied === `invite-${name}` ? "bg-accent-mint" : "bg-gold-400"
                    }`}
                    whileTap={{ scale: 0.9 }}
                  >
                    {copied === `invite-${name}` ? "Kopiert!" : "Einladen"}
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create Round Component                                              */
/* ------------------------------------------------------------------ */

function CreateRoundCard({ auth, members, token }: { auth: Props["auth"]; members: Member[]; token: string | null }) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [tees, setTees] = useState<any[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    course_id: "",
    tee_id: "",
    format: "stableford",
    game_mode: "individual",
    date: "",
    tee_time: "",
    notes: "",
  });

  // Flight management
  const [flights, setFlights] = useState<{ name: string; member_ids: string[] }[]>([]);
  const [activeFlight, setActiveFlight] = useState(0);

  const assignedIds = new Set(flights.flatMap((f) => f.member_ids));
  const available = members.filter((m) => !assignedIds.has(m.id));

  const addFlight = () => {
    setFlights([...flights, { name: `Flight ${flights.length + 1}`, member_ids: [] }]);
    setActiveFlight(flights.length);
  };

  const addToFlight = (memberId: string) => {
    if (flights.length === 0) {
      setFlights([{ name: "Flight 1", member_ids: [memberId] }]);
      setActiveFlight(0);
      return;
    }
    setFlights(flights.map((f, i) =>
      i === activeFlight ? { ...f, member_ids: [...f.member_ids, memberId] } : f
    ));
  };

  const removeFromFlight = (flightIdx: number, memberId: string) => {
    setFlights(flights.map((f, i) =>
      i === flightIdx ? { ...f, member_ids: f.member_ids.filter((id) => id !== memberId) } : f
    ).filter((f) => f.member_ids.length > 0));
  };

  const removeFlight = (idx: number) => {
    const updated = flights.filter((_, i) => i !== idx);
    setFlights(updated);
    if (activeFlight >= updated.length) setActiveFlight(Math.max(0, updated.length - 1));
  };

  // Load courses when opened
  useEffect(() => {
    if (!open || courses.length > 0) return;
    setLoadingCourses(true);
    fetch(`${API_BASE}/golf/event/${auth.event.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        // Extract unique courses from rounds
        const seen = new Set<string>();
        const uniqueCourses: any[] = [];
        for (const r of data.rounds || []) {
          if (r.course_id && !seen.has(r.course_id)) {
            seen.add(r.course_id);
            uniqueCourses.push({ id: r.course_id, name: r.course_name, par_total: r.par_total });
          }
        }
        setCourses(uniqueCourses);
      })
      .catch(() => {})
      .finally(() => setLoadingCourses(false));
  }, [open]);

  // Load tees when course changes
  useEffect(() => {
    if (!form.course_id) { setTees([]); return; }
    fetch(`${API_BASE}/golf/course/${form.course_id}/tees`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setTees(data.tees || []))
      .catch(() => setTees([]));
  }, [form.course_id]);

  const handleCreate = async () => {
    if (!form.course_id || !form.date) return;
    setCreating(true);
    try {
      const validFlights = flights.filter((f) => f.member_ids.length > 0);
      await fetch(`${API_BASE}/golf/event/${auth.event.id}/round`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: form.course_id,
          tee_id: form.tee_id || undefined,
          format: form.format,
          game_mode: form.game_mode,
          date: form.date,
          tee_time: form.tee_time || undefined,
          notes: form.notes || undefined,
          teams: validFlights.length > 0 ? validFlights : undefined,
        }),
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false); setOpen(false); setFlights([]);
        setForm({ course_id: "", tee_id: "", format: "stableford", game_mode: "individual", date: "", tee_time: "", notes: "" });
      }, 1500);
    } catch (err) {
      alert("Fehler beim Erstellen der Runde");
    }
    setCreating(false);
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-accent-mint border-2 border-dark rounded-xl flex items-center justify-center text-sm">
            ⛳
          </div>
          <span className="pill bg-accent-mint">Neue Runde</span>
        </div>
        <motion.button
          onClick={() => setOpen(!open)}
          className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border-2 border-dark bg-gold-400"
          whileTap={{ scale: 0.9 }}
        >
          {open ? "Schliessen" : "+ Neue Runde"}
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-3">
              {loadingCourses ? (
                <div className="flex justify-center py-4"><Spinner /></div>
              ) : (
                <>
                  {/* Course Selection */}
                  <div>
                    <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Golfplatz</label>
                    <div className="flex flex-wrap gap-2">
                      {courses.map((c) => (
                        <motion.button
                          key={c.id}
                          onClick={() => setForm({ ...form, course_id: c.id, tee_id: "" })}
                          className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                            form.course_id === c.id ? "border-dark bg-dark text-white" : "border-dark/20 bg-white text-dark/60"
                          }`}
                          whileTap={{ scale: 0.95 }}
                        >
                          {c.name} <span className="opacity-50">Par {c.par_total}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Tee Selection */}
                  {tees.length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Abschlag</label>
                      <div className="flex flex-wrap gap-2">
                        {tees.map((t: any) => (
                          <motion.button
                            key={t.id}
                            onClick={() => setForm({ ...form, tee_id: t.id })}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                              form.tee_id === t.id ? "border-dark bg-dark text-white" : "border-dark/20 bg-white text-dark/60"
                            }`}
                            whileTap={{ scale: 0.95 }}
                          >
                            <span className={`w-3 h-3 rounded-full shrink-0 ${TEE_COLORS[t.color?.toLowerCase()] || "bg-gray-300"}`} />
                            {t.name}
                            <span className="opacity-40">{t.length_meters}m</span>
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Format */}
                  <div>
                    <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Format</label>
                    <div className="flex gap-2">
                      {FORMATS.map((f) => (
                        <motion.button
                          key={f.value}
                          onClick={() => setForm({ ...form, format: f.value })}
                          className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                            form.format === f.value ? "border-dark bg-dark text-white" : "border-dark/20 bg-white text-dark/60"
                          }`}
                          whileTap={{ scale: 0.95 }}
                        >
                          {f.label}
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Game Mode */}
                  <div>
                    <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Spielmodus</label>
                    <div className="flex flex-wrap gap-2">
                      {GAME_MODES.map((gm) => (
                        <motion.button
                          key={gm.value}
                          onClick={() => setForm({ ...form, game_mode: gm.value })}
                          className={`px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                            form.game_mode === gm.value ? "border-dark bg-dark text-white" : "border-dark/20 bg-white text-dark/60"
                          }`}
                          whileTap={{ scale: 0.95 }}
                        >
                          <span>{gm.label}</span>
                        </motion.button>
                      ))}
                    </div>
                    <p className="text-[10px] text-dark/40 mt-1">
                      {GAME_MODES.find((gm) => gm.value === form.game_mode)?.desc}
                    </p>
                  </div>

                  {/* Date & Time */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Datum</label>
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                        className="w-full input-soft py-2.5 text-sm font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Tee-Time</label>
                      <input
                        type="time"
                        value={form.tee_time}
                        onChange={(e) => setForm({ ...form, tee_time: e.target.value })}
                        className="w-full input-soft py-2.5 text-sm font-bold"
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-1.5">Notizen (optional)</label>
                    <input
                      type="text"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="z.B. Shotgun Start, Startloch 10..."
                      className="w-full input-soft py-2.5 text-sm"
                    />
                  </div>

                  {/* Flights */}
                  <div>
                    <label className="text-[10px] font-bold text-dark/40 uppercase tracking-wider block mb-2">
                      Flights (optional)
                    </label>

                    {/* Available members */}
                    {available.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] text-dark/30 font-bold mb-1.5">
                          {flights.length === 0 ? "Spieler antippen um Flights zu erstellen" : `Verfuegbar (${available.length})`}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {available.map((m) => (
                            <motion.button
                              key={m.id}
                              onClick={() => addToFlight(m.id)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 border-dark/15 bg-white text-xs font-bold"
                              whileTap={{ scale: 0.95 }}
                            >
                              <Emoji emoji={m.avatar_emoji || "👤"} size={14} />
                              {m.display_name.split(" ")[0]}
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Flight groups */}
                    <div className="space-y-2">
                      {flights.map((flight, fi) => (
                        <div
                          key={fi}
                          className={`rounded-xl border-2 p-3 transition-all ${
                            fi === activeFlight ? "border-gold-400 bg-gold-400/10" : "border-dark/10 bg-surface-0"
                          }`}
                          onClick={() => setActiveFlight(fi)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider">
                              {flight.name}
                            </span>
                            <motion.button
                              onClick={(e) => { e.stopPropagation(); removeFlight(fi); }}
                              className="text-[10px] text-red-500 font-bold px-2 py-1 rounded-md border border-red-200 bg-red-50"
                              whileTap={{ scale: 0.9 }}
                            >
                              Loeschen
                            </motion.button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {flight.member_ids.map((mid) => {
                              const m = members.find((m) => m.id === mid);
                              if (!m) return null;
                              return (
                                <motion.button
                                  key={mid}
                                  onClick={(e) => { e.stopPropagation(); removeFromFlight(fi, mid); }}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 border-dark bg-white text-xs font-bold shadow-brutal-xs"
                                  whileTap={{ scale: 0.95 }}
                                >
                                  <Emoji emoji={m.avatar_emoji || "👤"} size={14} />
                                  {m.display_name.split(" ")[0]}
                                  <span className="text-dark/30 ml-0.5">✕</span>
                                </motion.button>
                              );
                            })}
                            {flight.member_ids.length === 0 && (
                              <p className="text-[10px] text-dark/30 font-medium py-1">Spieler oben antippen...</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add flight button */}
                    <motion.button
                      onClick={addFlight}
                      className="mt-2 w-full py-2 rounded-xl border-2 border-dashed border-dark/20 text-xs font-bold text-dark/40"
                      whileTap={{ scale: 0.98 }}
                    >
                      + Flight hinzufuegen
                    </motion.button>
                  </div>

                  {/* Create Button */}
                  <motion.button
                    onClick={handleCreate}
                    disabled={!form.course_id || !form.date || creating}
                    className={`w-full py-3 rounded-xl border-2 border-dark text-sm font-extrabold shadow-brutal-xs transition-all ${
                      success ? "bg-accent-mint" : "bg-gold-400"
                    } disabled:opacity-30`}
                    whileTap={{ scale: 0.98 }}
                  >
                    {success ? "✓ Runde erstellt!" : creating ? "Wird erstellt..." : "Runde erstellen"}
                  </motion.button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flight Manager — Edit flights for existing rounds                   */
/* ------------------------------------------------------------------ */

function FlightManager({ auth, members, token }: { auth: Props["auth"]; members: Member[]; token: string | null }) {
  const [rounds, setRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRound, setEditingRound] = useState<string | null>(null);
  const [flights, setFlights] = useState<{ name: string; member_ids: string[] }[]>([]);
  const [activeFlight, setActiveFlight] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/golf/event/${auth.event.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setRounds(data.rounds || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openRound = async (roundId: string) => {
    setEditingRound(roundId);
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE}/golf/round/${roundId}/teams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const teams = data.teams || [];
      if (teams.length > 0) {
        setFlights(teams.map((t: any, i: number) => ({
          name: t.name || `Flight ${i + 1}`,
          member_ids: t.members?.map((m: any) => m.member_id).filter(Boolean) || [],
        })));
      } else {
        setFlights([]);
      }
      setActiveFlight(0);
    } catch {
      setFlights([]);
    }
  };

  const assignedIds = new Set(flights.flatMap((f) => f.member_ids));
  const available = members.filter((m) => !assignedIds.has(m.id));

  const addFlight = () => {
    setFlights([...flights, { name: `Flight ${flights.length + 1}`, member_ids: [] }]);
    setActiveFlight(flights.length);
  };

  const addToFlight = (memberId: string) => {
    if (flights.length === 0) {
      setFlights([{ name: "Flight 1", member_ids: [memberId] }]);
      setActiveFlight(0);
      return;
    }
    setFlights(flights.map((f, i) =>
      i === activeFlight ? { ...f, member_ids: [...f.member_ids, memberId] } : f
    ));
  };

  const removeFromFlight = (flightIdx: number, memberId: string) => {
    setFlights(flights.map((f, i) =>
      i === flightIdx ? { ...f, member_ids: f.member_ids.filter((id) => id !== memberId) } : f
    ).filter((f) => f.member_ids.length > 0));
  };

  const removeFlight = (idx: number) => {
    const updated = flights.filter((_, i) => i !== idx);
    setFlights(updated);
    if (activeFlight >= updated.length) setActiveFlight(Math.max(0, updated.length - 1));
  };

  const handleSave = async () => {
    if (!editingRound) return;
    setSaving(true);
    try {
      const validFlights = flights.filter((f) => f.member_ids.length > 0);
      await fetch(`${API_BASE}/golf/round/${editingRound}/teams`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ teams: validFlights }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert("Fehler beim Speichern");
    }
    setSaving(false);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  };

  if (loading) return null;
  if (rounds.length === 0) return null;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center text-sm">
          🏌️
        </div>
        <span className="pill bg-gold-400">Flights verwalten</span>
      </div>

      {!editingRound ? (
        <div className="space-y-2">
          <p className="text-xs text-dark/40 font-medium mb-2">
            Waehle eine Runde um Flights zusammenzustellen:
          </p>
          {rounds.map((r: any, i: number) => (
            <motion.button
              key={r.id}
              onClick={() => openRound(r.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-0 rounded-xl border-2 border-dark/10 text-left"
              whileTap={{ scale: 0.98 }}
            >
              <div>
                <span className="text-xs font-bold">R{i + 1} · {r.course_name}</span>
                <span className="text-[10px] text-dark/40 ml-2">{formatDate(r.date)}</span>
              </div>
              <span className="text-[10px] font-bold text-dark/30">Bearbeiten →</span>
            </motion.button>
          ))}
        </div>
      ) : (
        <div>
          {/* Back + Round name */}
          <div className="flex items-center gap-2 mb-3">
            <motion.button
              onClick={() => { setEditingRound(null); setFlights([]); }}
              className="text-[10px] font-bold text-dark/40 px-2 py-1 rounded-lg border border-dark/15"
              whileTap={{ scale: 0.9 }}
            >
              ← Zurueck
            </motion.button>
            <span className="text-xs font-bold">
              {rounds.find((r: any) => r.id === editingRound)?.course_name}
            </span>
          </div>

          {/* Available members */}
          {available.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-dark/30 font-bold mb-1.5">
                {flights.length === 0 ? "Spieler antippen um Flights zu erstellen" : `Verfuegbar (${available.length})`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {available.map((m) => (
                  <motion.button
                    key={m.id}
                    onClick={() => addToFlight(m.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 border-dark/15 bg-white text-xs font-bold"
                    whileTap={{ scale: 0.95 }}
                  >
                    <Emoji emoji={m.avatar_emoji || "👤"} size={14} />
                    {m.display_name.split(" ")[0]}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Flight groups */}
          <div className="space-y-2">
            {flights.map((flight, fi) => (
              <div
                key={fi}
                className={`rounded-xl border-2 p-3 transition-all ${
                  fi === activeFlight ? "border-gold-400 bg-gold-400/10" : "border-dark/10 bg-surface-0"
                }`}
                onClick={() => setActiveFlight(fi)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider">
                    {flight.name}
                  </span>
                  <motion.button
                    onClick={(e) => { e.stopPropagation(); removeFlight(fi); }}
                    className="text-[10px] text-red-500 font-bold px-2 py-1 rounded-md border border-red-200 bg-red-50"
                    whileTap={{ scale: 0.9 }}
                  >
                    Loeschen
                  </motion.button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {flight.member_ids.map((mid) => {
                    const m = members.find((m) => m.id === mid);
                    if (!m) return null;
                    return (
                      <motion.button
                        key={mid}
                        onClick={(e) => { e.stopPropagation(); removeFromFlight(fi, mid); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 border-dark bg-white text-xs font-bold shadow-brutal-xs"
                        whileTap={{ scale: 0.95 }}
                      >
                        <Emoji emoji={m.avatar_emoji || "👤"} size={14} />
                        {m.display_name.split(" ")[0]}
                        <span className="text-dark/30 ml-0.5">✕</span>
                      </motion.button>
                    );
                  })}
                  {flight.member_ids.length === 0 && (
                    <p className="text-[10px] text-dark/30 font-medium py-1">Spieler oben antippen...</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add flight + Save */}
          <motion.button
            onClick={addFlight}
            className="mt-2 w-full py-2 rounded-xl border-2 border-dashed border-dark/20 text-xs font-bold text-dark/40"
            whileTap={{ scale: 0.98 }}
          >
            + Flight hinzufuegen
          </motion.button>

          <motion.button
            onClick={handleSave}
            disabled={saving}
            className={`mt-3 w-full py-3 rounded-xl border-2 border-dark text-sm font-extrabold shadow-brutal-xs transition-all ${
              saved ? "bg-accent-mint" : "bg-gold-400"
            } disabled:opacity-30`}
            whileTap={{ scale: 0.98 }}
          >
            {saved ? "✓ Flights gespeichert!" : saving ? "Speichern..." : "Flights speichern"}
          </motion.button>
        </div>
      )}
    </div>
  );
}
