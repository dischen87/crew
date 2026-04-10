import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

const GIPHY_API_KEY = "dc6zaTOxFJmzC"; // Giphy public API key
const GIPHY_URL = "https://api.giphy.com/v1/gifs";

interface Props {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export default function GiphyPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTrending();
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const loadTrending = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GIPHY_URL}/trending?api_key=${GIPHY_API_KEY}&limit=30&rating=g`);
      const data = await res.json();
      setGifs(data.data || []);
    } catch (err) {
      console.error("Giphy trending error:", err);
    }
    setLoading(false);
  };

  const search = async (q: string) => {
    if (!q.trim()) { loadTrending(); return; }
    setLoading(true);
    try {
      const res = await fetch(`${GIPHY_URL}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=30&rating=g`);
      const data = await res.json();
      setGifs(data.data || []);
    } catch (err) {
      console.error("Giphy search error:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => search(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <motion.div
      className="fixed inset-0 z-[20000] bg-white flex flex-col"
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {/* Header */}
      <div className="shrink-0 bg-white border-b-2 border-dark/10" style={{ paddingTop: "env(safe-area-inset-top, 12px)" }}>
        <div className="px-4 py-3 flex items-center gap-3">
          <motion.button
            onClick={onClose}
            className="w-10 h-10 bg-surface-0 border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs shrink-0"
            whileTap={{ scale: 0.9 }}
          >
            <span className="text-dark font-bold">✕</span>
          </motion.button>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="GIF suchen..."
            className="flex-1 px-4 py-2.5 input-soft text-sm font-medium"
            autoComplete="off"
          />
        </div>
      </div>

      {/* GIF Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-dark/30 font-medium">GIFs laden...</div>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-dark/30 font-medium">Keine GIFs gefunden</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 p-3">
            {gifs.map((gif: any) => (
              <motion.button
                key={gif.id}
                onClick={() => onSelect(gif.images.fixed_height.url)}
                className="relative aspect-[4/3] rounded-xl overflow-hidden bg-dark/5 border-2 border-transparent active:border-dark"
                whileTap={{ scale: 0.95 }}
              >
                <img
                  src={gif.images.fixed_width.url}
                  alt={gif.title || "GIF"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-2 border-t border-dark/5 bg-white text-center" style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
        <span className="text-[9px] text-dark/20 font-bold uppercase tracking-wider">Powered by GIPHY</span>
      </div>
    </motion.div>
  );
}
