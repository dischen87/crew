import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconUpload, IconCamera } from "../components/Icons";
import { Spinner } from "../components/Motion";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

interface Props {
  auth: {
    member: { id: string; display_name: string };
    event: { id: string };
    token?: string;
  };
}

export default function Photos({ auth }: Props) {
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = localStorage.getItem("crew_token");

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/media/event/${auth.event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setPhotos(data.media || []);
    } catch (err) {
      console.error("Failed to load photos:", err);
    }
    setLoading(false);
  }, [auth.event.id, token]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        await fetch(`${API_BASE}/media/event/${auth.event.id}/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      } catch (err) {
        console.error("Upload failed:", err);
      }
    }
    await loadPhotos();
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
            Galerie
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight leading-[1.05]">
            Fotos<span className="text-gold-400">.</span>
          </h2>
          <p className="text-xs text-dark/25 mt-1 font-bold">{photos.length} Fotos</p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleUpload}
            className="hidden"
            id="photo-upload"
          />
          <motion.label
            htmlFor="photo-upload"
            className={`inline-flex items-center gap-1.5 btn-gold text-xs px-4 py-2.5 cursor-pointer ${
              uploading ? "opacity-30 pointer-events-none" : ""
            }`}
            whileTap={{ scale: 0.95 }}
          >
            {uploading ? (
              <><Spinner size={16} /> Lädt...</>
            ) : (
              <><IconUpload className="w-4 h-4" /> Hochladen</>
            )}
          </motion.label>
        </div>
      </div>

      {photos.length === 0 ? (
        <motion.div
          className="card p-10 text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <IconCamera className="w-10 h-10 text-dark/15 mx-auto mb-4" />
          <p className="font-extrabold tracking-tight mb-1">Noch keine Fotos</p>
          <p className="text-sm text-dark/30 font-medium">
            Lade das erste Foto vom Trip hoch!
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((photo, i) => (
            <motion.button
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              className="aspect-square bg-white border-2 border-dark overflow-hidden relative group rounded-xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03, duration: 0.3 }}
            >
              {photo.type === "image" ? (
                <img
                  src={photo.url}
                  alt={photo.caption || ""}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-surface-1">
                  <IconCamera className="w-8 h-8 text-dark/10" />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <p className="text-[10px] text-white truncate font-bold">{photo.uploader_name}</p>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Photo viewer modal */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setSelectedPhoto(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 text-white/50 hover:text-white text-sm font-bold z-10 w-10 h-10 flex items-center justify-center bg-white/10 border-2 border-white/20 rounded-full transition-colors"
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
            <motion.div
              className="max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {selectedPhoto.type === "image" ? (
                <img src={selectedPhoto.url} alt={selectedPhoto.caption || ""} className="w-full rounded-2xl border-2 border-white/20" />
              ) : (
                <video src={selectedPhoto.url} controls className="w-full rounded-2xl border-2 border-white/20" />
              )}
              <div className="mt-3 text-center">
                <p className="text-sm text-white/70 font-bold">{selectedPhoto.uploader_name}</p>
                {selectedPhoto.caption && <p className="text-sm text-white/40 mt-1">{selectedPhoto.caption}</p>}
                <p className="text-xs text-white/20 mt-1">
                  {new Date(selectedPhoto.created_at).toLocaleString("de-CH")}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
