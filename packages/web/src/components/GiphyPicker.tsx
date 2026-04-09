import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

const GIPHY_API_KEY = "GlVGYi8kxJBVFkGIGOAtMzfig2i3j2Cb"; // Public beta key
const GIPHY_URL = "https://api.giphy.com/v1/gifs";

interface Props {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export default function GiphyPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load trending on open
  useEffect(() => {
    loadTrending();
    inputRef.current?.focus();
  }, []);

  const loadTrending = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GIPHY_URL}/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`);
      const data = await res.json();
      setGifs(data.data || []);
    } catch {}
    setLoading(false);
  };

  const search = async (q: string) => {
    if (!q.trim()) { loadTrending(); return; }
    setLoading(true);
    try {
      const res = await fetch(`${GIPHY_URL}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=20&rating=g`);
      const data = await res.json();
      setGifs(data.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => search(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <motion.div
      className="absolute bottom-full left-0 right-0 bg-white border-2 border-dark rounded-2xl shadow-brutal mb-2 overflow-hidden"
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-dark/10">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="GIF suchen..."
          className="flex-1 px-3 py-2 input-soft text-sm"
        />
        <motion.button
          onClick={onClose}
          className="text-dark/30 font-bold text-sm px-2"
          whileTap={{ scale: 0.9 }}
        >
          ✕
        </motion.button>
      </div>

      <div className="grid grid-cols-3 gap-1 p-2 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="col-span-3 text-center py-8 text-xs text-dark/30 font-medium">Laden...</div>
        ) : gifs.length === 0 ? (
          <div className="col-span-3 text-center py-8 text-xs text-dark/30 font-medium">Keine GIFs gefunden</div>
        ) : (
          gifs.map((gif: any) => (
            <motion.button
              key={gif.id}
              onClick={() => onSelect(gif.images.fixed_height.url)}
              className="aspect-square rounded-lg overflow-hidden bg-dark/5"
              whileTap={{ scale: 0.9 }}
            >
              <img
                src={gif.images.fixed_height_small.url}
                alt={gif.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </motion.button>
          ))
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-dark/5 text-center">
        <span className="text-[9px] text-dark/20 font-bold uppercase tracking-wider">Powered by GIPHY</span>
      </div>
    </motion.div>
  );
}
