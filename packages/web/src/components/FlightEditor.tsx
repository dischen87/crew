import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getRoundTeams, updateRoundTeams } from "../lib/api";
import { Spinner } from "./Motion";

interface Props {
  roundId: string;
  members: any[];
  onClose: () => void;
}

export default function FlightEditor({ roundId, members, onClose }: Props) {
  const [flights, setFlights] = useState<{ name: string; member_ids: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getRoundTeams(roundId).then((data) => {
      if (data.teams?.length > 0) {
        setFlights(data.teams.map((t: any) => ({
          name: t.name || `Flight ${data.teams.indexOf(t) + 1}`,
          member_ids: t.members?.map((m: any) => m.member_id || m.id).filter(Boolean) || [],
        })));
      } else {
        setFlights([{ name: "Flight 1", member_ids: [] }]);
      }
    }).catch(() => {
      setFlights([{ name: "Flight 1", member_ids: [] }]);
    }).finally(() => setLoading(false));
  }, [roundId]);

  const addFlight = () => {
    setFlights([...flights, { name: `Flight ${flights.length + 1}`, member_ids: [] }]);
  };

  const removeFlight = (index: number) => {
    setFlights(flights.filter((_, i) => i !== index));
  };

  const toggleMember = (flightIndex: number, memberId: string) => {
    setFlights(flights.map((f, i) => {
      if (i !== flightIndex) {
        return { ...f, member_ids: f.member_ids.filter((id) => id !== memberId) };
      }
      if (f.member_ids.includes(memberId)) {
        return { ...f, member_ids: f.member_ids.filter((id) => id !== memberId) };
      }
      return { ...f, member_ids: [...f.member_ids, memberId] };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateRoundTeams(roundId, flights.filter((f) => f.member_ids.length > 0));
      onClose();
    } catch (err: any) {
      setError(err.message || "Speichern fehlgeschlagen");
    }
    setSaving(false);
  };

  const assignedIds = new Set(flights.flatMap((f) => f.member_ids));

  return (
    <motion.div
      className="fixed inset-0 z-[10000] bg-black/50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold tracking-tight">Flights einteilen</h3>
            <button onClick={onClose} className="text-dark/30 text-xl font-bold">✕</button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <>
              {/* Flight cards */}
              {flights.map((flight, fi) => (
                <div key={fi} className="mb-4 bg-surface-0 border-2 border-dark/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-lg flex items-center justify-center text-[10px] font-extrabold">
                        F{fi + 1}
                      </span>
                      <span className="text-[12px] font-extrabold tracking-tight">{flight.name}</span>
                      <span className="text-[10px] font-bold text-dark/25">{flight.member_ids.length}/4</span>
                    </div>
                    {flights.length > 1 && (
                      <button onClick={() => removeFlight(fi)} className="text-[10px] text-red-400 font-bold px-2 py-1">
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Assigned members as cards */}
                  {flight.member_ids.length > 0 && (
                    <div className="grid grid-cols-2 gap-1.5 mb-3">
                      {flight.member_ids.map((mid) => {
                        const m = members.find((mem: any) => mem.id === mid);
                        if (!m) return null;
                        return (
                          <motion.button
                            key={mid}
                            onClick={() => toggleMember(fi, mid)}
                            className="flex items-center gap-2 bg-gold-400/20 border-2 border-gold-400/30 rounded-lg px-2.5 py-2 text-left"
                            whileTap={{ scale: 0.95 }}
                          >
                            <span className="text-sm">{m.avatar_emoji}</span>
                            <span className="text-[11px] font-bold text-dark/70 truncate flex-1">{m.display_name?.split(" ")[0]}</span>
                            <span className="text-[10px] text-dark/25">✕</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}

                  {/* Available members to add */}
                  {flight.member_ids.length < 4 && (
                    <div className="flex flex-wrap gap-1">
                      {members.filter((m: any) => !assignedIds.has(m.id)).map((m: any) => (
                        <motion.button
                          key={m.id}
                          onClick={() => toggleMember(fi, m.id)}
                          className="px-2.5 py-1 rounded-full border border-dark/10 bg-white text-[10px] font-bold text-dark/40"
                          whileTap={{ scale: 0.95 }}
                        >
                          {m.avatar_emoji} {m.display_name?.split(" ")[0]}
                        </motion.button>
                      ))}
                      {members.filter((m: any) => !assignedIds.has(m.id)).length === 0 && flight.member_ids.length < 4 && (
                        <span className="text-[10px] text-dark/20 italic py-1">Alle Spieler zugeteilt</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={addFlight}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-dark/15 text-[11px] font-bold text-dark/30 mb-4"
              >
                + Flight hinzufügen
              </button>

              {members.filter((m: any) => !assignedIds.has(m.id)).length > 0 && (
                <p className="text-[10px] text-dark/30 font-medium mb-4">
                  {members.filter((m: any) => !assignedIds.has(m.id)).length} Spieler noch nicht eingeteilt
                </p>
              )}

              {error && (
                <div className="bg-red-50 border-2 border-red-300 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl mb-3">
                  {error}
                </div>
              )}

              <motion.button
                onClick={handleSave}
                disabled={saving}
                className="w-full btn-dark py-3 text-sm disabled:opacity-30"
                whileTap={{ scale: 0.97 }}
              >
                {saving ? "Speichern..." : "Flights speichern"}
              </motion.button>
            </>
          )}
        </div>
        <div className="h-6" />
      </motion.div>
    </motion.div>
  );
}
