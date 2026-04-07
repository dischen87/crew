import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  onLogin: (name: string, password: string, emoji?: string) => void;
  error: string;
}

const EMOJI_OPTIONS = [
  "🏌️", "⛳", "🏆", "🎯", "💪", "🔥", "🎳", "⚡",
  "🦅", "🎿", "🏎️", "🎲", "🃏", "🍺", "🇬🇷", "🐯",
  "🦁", "🐺", "🦈", "🐻", "🦊", "🐉", "🎸", "⭐",
  "💎", "🚀", "🌊", "🍀", "🎪", "🧊", "☀️", "🌙",
];

export default function Login({ onLogin, error }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    setSubmitting(true);
    await onLogin(name.trim(), password, selectedEmoji || undefined);
    setSubmitting(false);
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
        <div className="text-center mb-10">
          <motion.div
            className="inline-block bg-accent-mint border-2 border-dark px-8 py-3 rounded-full shadow-brutal mb-4"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            <h1 className="text-4xl font-extrabold tracking-tight">CREW</h1>
          </motion.div>
          <motion.div
            className="inline-block bg-white border-2 border-dark px-5 py-1.5 rounded-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <p className="text-sm font-bold">Golfreise Belek 2026</p>
          </motion.div>
          <motion.p
            className="text-dark/30 text-xs mt-3 font-bold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            08. – 15. April
          </motion.p>
        </div>

        {/* Login form */}
        <motion.div
          className="card p-6"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
        >
          <form onSubmit={handleSubmit} className="space-y-5">
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
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-dark/40 uppercase tracking-[0.1em] mb-2">
                Passwort
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Gruppen-Passwort"
                className="w-full px-4 py-3.5 input-soft text-[15px]"
              />
            </div>

            {/* Emoji picker */}
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
                    {emoji}
                  </motion.button>
                ))}
              </div>
            </div>

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
              disabled={submitting || !name.trim() || !password}
              className="w-full btn-gold py-4 text-[15px] uppercase tracking-wider disabled:opacity-30"
              whileTap={{ scale: 0.98 }}
            >
              {submitting ? "Laden..." : "Einloggen"}
            </motion.button>
          </form>
        </motion.div>
      </motion.div>
    </div>
  );
}
