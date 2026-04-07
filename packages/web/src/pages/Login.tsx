import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Emoji from "../components/Emoji";

interface Props {
  onLogin: (name: string, password: string, emoji?: string) => void;
  onRegister?: (name: string, password: string, groupName: string, emoji?: string) => void;
  onJoin?: (inviteCode: string, name: string, password: string, emoji?: string) => void;
  error: string;
}

type Mode = "login" | "register" | "join";

const EMOJI_OPTIONS = [
  "🏌️", "⛳", "🏆", "🎯", "💪", "🔥", "🎳", "⚡",
  "🦅", "🎿", "🏎️", "🎲", "🃏", "🍺", "🇬🇷", "🐯",
  "🦁", "🐺", "🦈", "🐻", "🦊", "🐉", "🎸", "⭐",
  "💎", "🚀", "🌊", "🍀", "🎪", "🧊", "☀️", "🌙",
];

export default function Login({ onLogin, onRegister, onJoin, error }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    if (mode === "login") {
      await onLogin(name.trim(), password);
    } else if (mode === "register" && onRegister) {
      await onRegister(name.trim(), password, groupName.trim(), selectedEmoji || undefined);
    } else if (mode === "join" && onJoin) {
      await onJoin(inviteCode.trim(), name.trim(), password, selectedEmoji || undefined);
    }

    setSubmitting(false);
  };

  const canSubmit = () => {
    if (!name.trim() || !password) return false;
    if (mode === "register" && !groupName.trim()) return false;
    if (mode === "join" && !inviteCode.trim()) return false;
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
            className="text-dark/30 text-xs mt-2 font-bold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Dein Trip. Deine Crew. Dein Game.
          </motion.p>
        </div>

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
                mode === t.id ? "bg-dark text-white" : "bg-white text-dark/30"
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
                {/* Register: Group Name */}
                {mode === "register" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
                      Gruppenname
                    </label>
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="z.B. Belek Golf Crew"
                      className="w-full px-4 py-3.5 input-soft text-[15px]"
                      autoFocus
                    />
                  </div>
                )}

                {/* Join: Invite Code */}
                {mode === "join" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
                      Invite-Code
                    </label>
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="z.B. BELEK26"
                      className="w-full px-4 py-3.5 input-soft text-[15px] uppercase tracking-wider text-center font-bold"
                      autoFocus
                    />
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
                    Dein Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="z.B. Mathias Graf"
                    className="w-full px-4 py-3.5 input-soft text-[15px]"
                    autoComplete="name"
                    autoFocus={mode === "login"}
                  />
                </div>

                {/* Password */}
                <div>
                  <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
                    Passwort
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "login" ? "Dein Passwort" : "Passwort wählen (mind. 4 Zeichen)"}
                    className="w-full px-4 py-3.5 input-soft text-[15px]"
                  />
                </div>

                {/* Emoji picker (register/join only) */}
                {mode !== "login" && (
                  <div>
                    <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
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
              className="w-full btn-gold py-4 text-[15px] uppercase tracking-wider disabled:opacity-30"
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
            : "Frag den Admin nach dem Invite-Code."}
        </p>
      </motion.div>
    </div>
  );
}
