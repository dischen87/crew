import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { IconUsers, IconCrown } from "./Icons";
import { Spinner } from "./Motion";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

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
                  crew-home.com/join/{inviteCode}
                </p>
              </div>
              <motion.button
                onClick={() => copyText(`https://crew-home.com/join/${inviteCode}`, "link")}
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
              const personalUrl = `https://crew-home.com/join/${inviteCode}?name=${encodeURIComponent(name)}`;
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
