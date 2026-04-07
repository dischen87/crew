import { useState } from "react";
import { motion } from "framer-motion";
import { IconArrowLeft } from "../components/Icons";

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
  onUpdate: (member: { display_name: string; avatar_emoji: string }) => void;
}

export default function Profile({ auth, onClose, onUpdate }: Props) {
  const [emoji, setEmoji] = useState(auth.member.avatar_emoji);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const token = localStorage.getItem("crew_token");
  const API_BASE = import.meta.env.VITE_API_URL || "/v2";

  const saveEmoji = async (newEmoji: string) => {
    setEmoji(newEmoji);
    setSaving(true);
    try {
      await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_emoji: newEmoji }),
      });
      onUpdate({ ...auth.member, avatar_emoji: newEmoji, display_name: auth.member.display_name });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Save emoji failed:", err);
    }
    setSaving(false);
  };

  const firstName = auth.member.display_name.split(" ")[0];

  return (
    <motion.div
      className="fixed inset-0 z-[9999] bg-surface-0 bg-grid safe-top safe-bottom overflow-y-auto"
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div className="max-w-lg mx-auto px-5 py-6">
        <motion.button
          onClick={onClose}
          className="text-[11px] font-bold text-dark/30 hover:text-dark/60 transition-colors flex items-center gap-1.5 uppercase tracking-wider mb-6"
          whileTap={{ scale: 0.95 }}
        >
          <IconArrowLeft className="w-4 h-4" />
          Zurück
        </motion.button>

        <div className="text-center mb-8">
          <motion.div
            className="w-24 h-24 mx-auto bg-white border-2 border-dark rounded-3xl shadow-brutal flex items-center justify-center text-5xl mb-4"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.1 }}
          >
            {emoji}
          </motion.div>
          <h2 className="text-3xl font-extrabold tracking-tight">
            {firstName}<span className="text-gold-400">.</span>
          </h2>
          <p className="text-xs text-dark/30 mt-1 font-bold">
            {auth.member.display_name}
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold text-dark/35 uppercase tracking-[0.1em]">
              Emoji ändern
            </p>
            {saved && (
              <motion.span
                className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                Gespeichert!
              </motion.span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_OPTIONS.map((e) => (
              <motion.button
                key={e}
                type="button"
                onClick={() => saveEmoji(e)}
                disabled={saving}
                className={`w-11 h-11 flex items-center justify-center text-lg rounded-xl border-2 transition-all ${
                  emoji === e
                    ? "border-dark bg-gold-400 scale-110 shadow-brutal-xs"
                    : "border-dark/10 bg-surface-0 hover:border-dark/30"
                }`}
                whileTap={{ scale: 0.9 }}
              >
                {e}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="card p-4 mt-4">
          <p className="text-[11px] font-bold text-dark/35 uppercase tracking-[0.1em] mb-3">
            Details
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-dark/30 font-medium">Name</span>
              <span className="font-bold">{auth.member.display_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark/30 font-medium">Event</span>
              <span className="font-bold">{auth.event.id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
