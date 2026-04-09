import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Emoji from "../components/Emoji";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

interface Props {
  onLogin: (name: string, pin: string) => void;
  onRegister?: (name: string, password: string, groupName: string, emoji?: string) => void;
  onJoin?: (inviteCode: string, name: string, password: string, emoji?: string, pin?: string) => void;
  error: string;
  /** Pre-filled invite code from URL (e.g. /join/BELEK26) */
  initialInviteCode?: string | null;
  /** Pre-filled name from URL (e.g. ?name=Mathias+Graf) */
  initialName?: string | null;
  /** Pre-filled password from URL (e.g. ?pw=BelekGolf4ever) */
  initialPassword?: string | null;
}

type Mode = "login" | "register" | "join";

const EMOJI_OPTIONS = [
  "\u{1F3CC}\uFE0F", "\u26F3", "\u{1F3C6}", "\u{1F3AF}", "\u{1F4AA}", "\u{1F525}", "\u{1F3B3}", "\u26A1",
  "\u{1F985}", "\u{1F3BF}", "\u{1F3CE}\uFE0F", "\u{1F3B2}", "\u{1F0CF}", "\u{1F37A}", "\u{1F1EC}\u{1F1F7}", "\u{1F42F}",
  "\u{1F981}", "\u{1F43A}", "\u{1F988}", "\u{1F43B}", "\u{1F98A}", "\u{1F409}", "\u{1F3B8}", "\u2B50",
  "\u{1F48E}", "\u{1F680}", "\u{1F30A}", "\u{1F340}", "\u{1F3EA}", "\u{1F9CA}", "\u2600\uFE0F", "\u{1F319}",
];

export default function Login({ onLogin, onRegister, onJoin, error, initialInviteCode, initialName, initialPassword }: Props) {
  // Auto-switch to "join" mode if invite code is in URL
  const [mode, setMode] = useState<Mode>(initialInviteCode ? "join" : "login");
  const [name, setName] = useState(initialName || "");
  const [password, setPassword] = useState(initialPassword || "");
  const [pin, setPin] = useState("");
  const hasPasswordFromUrl = !!initialPassword;
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode || "");
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [loginCode, setLoginCode] = useState(initialInviteCode || "");
  const [loginMembers, setLoginMembers] = useState<{ name: string; emoji: string }[]>([]);
  const [loginGroupName, setLoginGroupName] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);

  const hasInviteFromUrl = !!initialInviteCode;
  const hasNameFromUrl = !!initialName;

  // Load member list when login code changes
  useEffect(() => {
    if (mode !== "login" || !loginCode || loginCode.length < 3) { setLoginMembers([]); return; }
    const timer = setTimeout(async () => {
      setLoadingMembers(true);
      try {
        const res = await fetch(`${API_BASE}/auth/members/${loginCode.toUpperCase()}`);
        if (res.ok) {
          const data = await res.json();
          setLoginMembers(data.members || []);
          setLoginGroupName(data.group_name || "");
        } else {
          setLoginMembers([]);
        }
      } catch { setLoginMembers([]); }
      setLoadingMembers(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [loginCode, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    if (mode === "login") {
      await onLogin(name.trim(), pin || password);
    } else if (mode === "register" && onRegister) {
      await onRegister(name.trim(), password, groupName.trim(), selectedEmoji || undefined);
    } else if (mode === "join" && onJoin) {
      await onJoin(inviteCode.trim(), name.trim(), password, selectedEmoji || undefined, pin || undefined);
    }

    setSubmitting(false);
  };

  const canSubmit = () => {
    if (!name.trim()) return false;
    if (mode === "login") {
      return !!(loginCode.trim() && (pin || password));
    }
    if (mode === "register" && (!groupName.trim() || !password)) return false;
    if (mode === "join" && !inviteCode.trim()) return false;
    if (mode === "join" && !password && !hasPasswordFromUrl) return false;
    return true;
  };

  return (
    <div className="min-h-screen bg-surface-0 bg-grid flex items-center justify-center px-6 safe-top safe-bottom">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 0.84, 0.44, 1] }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            className="inline-block bg-accent-mint border-2 border-dark px-8 py-3 rounded-full shadow-brutal mb-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            <h1 className="text-4xl font-extrabold tracking-tight">CREW</h1>
          </motion.div>
          <motion.p
            className="text-dark/40 text-xs mt-2 font-bold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Dein Trip. Deine Crew. Dein Game.
          </motion.p>
        </div>

        {/* Invite Banner (when coming from invite link) */}
        {hasInviteFromUrl && mode === "join" && (
          <motion.div
            className="card-gold p-4 mb-5 text-center"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <p className="text-[10px] font-bold text-dark/50 uppercase tracking-wider mb-1">
              Einladung
            </p>
            <p className="font-extrabold tracking-tight">
              {hasNameFromUrl
                ? `Hey ${initialName?.split(" ")[0]}! Du wurdest eingeladen.`
                : "Du wurdest eingeladen!"}
            </p>
            <p className="text-sm text-dark/60 mt-1 font-medium">
              Code: <span className="font-extrabold">{initialInviteCode}</span>
              {hasPasswordFromUrl
                ? <> · Gib nur noch deinen Namen ein!</>
                : hasNameFromUrl
                ? <> · Gib nur noch dein Passwort ein</>
                : null}
            </p>
          </motion.div>
        )}

        {/* Mode Tabs */}
        <div className="flex gap-0 border-2 border-dark rounded-full overflow-hidden mb-5">
          {([
            { id: "login" as Mode, label: "Login" },
            { id: "join" as Mode, label: "Beitreten" },
            { id: "register" as Mode, label: "Erstellen" },
          ]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={`flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                mode === t.id ? "bg-dark text-white" : "bg-white text-dark/40"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <motion.div
          className="card p-6"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Login: Group Code + Member Selection */}
                {mode === "login" && (
                  <>
                    <div>
                      <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                        Gruppencode
                      </label>
                      <input
                        type="text"
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value.toUpperCase())}
                        placeholder="z.B. BELEK26"
                        className="w-full px-4 py-3.5 input-soft uppercase tracking-wider text-center font-bold"
                        autoFocus
                      />
                    </div>
                    {loginGroupName && (
                      <p className="text-xs text-dark/40 font-bold text-center -mt-2">{loginGroupName}</p>
                    )}
                    {loginMembers.length > 0 && (
                      <div>
                        <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                          Wer bist du?
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                          {loginMembers.map((m) => (
                            <motion.button
                              key={m.name}
                              type="button"
                              onClick={() => setName(m.name)}
                              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left text-sm font-bold transition-all ${
                                name === m.name
                                  ? "border-dark bg-dark text-white shadow-brutal-xs"
                                  : "border-dark/15 bg-white text-dark/70 hover:border-dark/30"
                              }`}
                              whileTap={{ scale: 0.95 }}
                            >
                              <span className="text-base">{m.emoji || "👤"}</span>
                              <span className="truncate">{m.name.split(" ")[0]}</span>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}
                    {loadingMembers && (
                      <p className="text-xs text-dark/30 text-center font-medium">Lade Mitglieder...</p>
                    )}
                  </>
                )}

                {/* Register: Group Name */}
                {mode === "register" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      Gruppenname
                    </label>
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="z.B. Belek Golf Crew"
                      className="w-full px-4 py-3.5 input-soft"
                      autoFocus
                    />
                  </div>
                )}

                {/* Join: Invite Code */}
                {mode === "join" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      Invite-Code
                    </label>
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="z.B. BELEK26"
                      className={`w-full px-4 py-3.5 input-soft uppercase tracking-wider text-center font-bold ${
                        hasInviteFromUrl ? "bg-gold-400/20 border-gold-400" : ""
                      }`}
                      readOnly={hasInviteFromUrl}
                    />
                  </div>
                )}

                {/* Name — hidden in login mode (selected from list) */}
                {mode !== "login" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      Dein Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="z.B. Mathias Graf"
                      className={`w-full px-4 py-3.5 input-soft ${
                        hasNameFromUrl && mode === "join" ? "bg-gold-400/20 border-gold-400 font-bold" : ""
                      }`}
                      autoComplete="name"
                      readOnly={hasNameFromUrl && mode === "join"}
                      autoFocus={hasInviteFromUrl && !hasNameFromUrl}
                    />
                  </div>
                )}

                {/* Password — hidden in login mode (uses PIN) and when pre-filled from invite URL */}
                {mode !== "login" && !(hasPasswordFromUrl && mode === "join") && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      Passwort
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "login" ? "Dein Passwort" : hasNameFromUrl ? "Passwort eingeben" : "Passwort wählen (mind. 4 Zeichen)"}
                      className="w-full px-4 py-3.5 input-soft"
                      autoFocus={hasNameFromUrl && mode === "join"}
                    />
                  </div>
                )}

                {/* PIN — for join (personal PIN) and login (re-auth) */}
                {(mode === "join" || mode === "login") && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      {mode === "login" ? "Deine PIN" : "Persoenliche PIN waehlen"}
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="4 Ziffern"
                      className="w-full px-4 py-3.5 input-soft text-center text-2xl font-extrabold tracking-[0.5em]"
                      autoFocus={mode === "login" && !!name}
                      autoComplete="off"
                    />
                    <p className="text-[10px] text-dark/30 mt-1.5 font-medium">
                      {mode === "join"
                        ? "Diese PIN brauchst du zum Einloggen auf anderen Geraeten."
                        : "Die 4-stellige PIN, die du beim Beitreten gewaehlt hast."}
                    </p>
                  </div>
                )}

                {/* Emoji picker (register/join only) */}
                {mode !== "login" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/50 uppercase tracking-[0.1em] mb-2">
                      Dein Emoji
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {EMOJI_OPTIONS.map((emoji) => (
                        <motion.button
                          key={emoji}
                          type="button"
                          onClick={() => setSelectedEmoji(selectedEmoji === emoji ? "" : emoji)}
                          className={`w-10 h-10 flex items-center justify-center text-lg rounded-xl border-2 transition-all ${
                            selectedEmoji === emoji
                              ? "border-dark bg-gold-400 scale-110 shadow-brutal-xs"
                              : "border-dark/10 bg-surface-0 hover:border-dark/30"
                          }`}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Emoji emoji={emoji} size={20} />
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-100 border-2 border-red-400 text-red-600 text-sm font-bold px-4 py-2.5 rounded-xl overflow-hidden"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={submitting || !canSubmit()}
              className="w-full btn-gold py-4 uppercase tracking-wider disabled:opacity-30"
              whileTap={{ scale: 0.98 }}
            >
              {submitting ? "Laden..." :
               mode === "login" ? "Einloggen" :
               mode === "register" ? "Gruppe erstellen" :
               "Gruppe beitreten"}
            </motion.button>
          </form>
        </motion.div>

        {/* Help text */}
        <p className="text-center text-[11px] text-dark/40 mt-5 font-medium">
          {mode === "login"
            ? "Noch kein Konto? Tritt einer Gruppe bei oder erstelle eine neue."
            : mode === "register"
            ? "Du wirst Admin der Gruppe und kannst Events erstellen."
            : hasInviteFromUrl
            ? "Gib deinen Namen und das Passwort ein, das du erhalten hast."
            : "Frag den Admin nach dem Invite-Code."}
        </p>
      </motion.div>
    </div>
  );
}
