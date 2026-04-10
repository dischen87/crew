import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getRoundTeams, updateRoundTeams } from "../lib/api";
import { Spinner } from "./Motion";

interface Props {
  roundId: string;
  members: any[];
  onClose: () => void;
  onSaved?: () => void;
}

export default function FlightEditor({ roundId, members, onClose, onSaved }: Props) {
  const [flights, setFlights] = useState<{ name: string; member_ids: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedFlight, setExpandedFlight] = useState<number>(0);

  useEffect(() => {
    getRoundTeams(roundId).then((data) => {
      if (data.teams?.length > 0) {
        setFlights(data.teams.map((t: any, i: number) => ({
          name: t.name || `Flight ${i + 1}`,
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
    const newIndex = flights.length;
    setFlights([...flights, { name: `Flight ${newIndex + 1}`, member_ids: [] }]);
    setExpandedFlight(newIndex);
  };

  const removeFlight = (index: number) => {
    setFlights(flights.filter((_, i) => i !== index));
    if (expandedFlight >= index && expandedFlight > 0) {
      setExpandedFlight(expandedFlight - 1);
    }
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
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Speichern fehlgeschlagen");
    }
    setSaving(false);
  };

  const handleDeleteAll = async () => {
    setSaving(true);
    setError("");
    try {
      await updateRoundTeams(roundId, []);
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Löschen fehlgeschlagen");
    }
    setSaving(false);
  };

  const assignedIds = new Set(flights.flatMap((f) => f.member_ids));
  const unassigned = members.filter((m: any) => !assignedIds.has(m.id));

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
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-dark/10 rounded-full" />
        </div>

        <div className="px-5 pt-2 pb-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold tracking-tight">Flights einteilen</h3>
            <button onClick={onClose} className="w-8 h-8 bg-dark/5 rounded-lg flex items-center justify-center text-dark/40 text-sm font-bold">✕</button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <>
              {/* Flight accordion */}
              {flights.map((flight, fi) => {
                const isExpanded = expandedFlight === fi;
                const memberNames = flight.member_ids
                  .map((mid) => members.find((m: any) => m.id === mid))
                  .filter(Boolean)
                  .map((m: any) => `${m.avatar_emoji} ${m.display_name?.split(" ")[0]}`)
                  .join(", ");

                return (
                  <div key={fi} className={`mb-2 border-2 rounded-xl transition-all ${
                    isExpanded ? "border-dark bg-surface-0" : "border-dark/10 bg-white"
                  }`}>
                    {/* Flight header — always visible */}
                    <button
                      onClick={() => setExpandedFlight(isExpanded ? -1 : fi)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                        isExpanded ? "bg-gold-400 border-dark" : "bg-dark/5 border-dark/10"
                      }`}>
                        F{fi + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        {flight.member_ids.length > 0 ? (
                          <p className="text-[11px] font-bold text-dark/60 truncate">{memberNames}</p>
                        ) : (
                          <p className="text-[11px] font-medium text-dark/25 italic">Keine Spieler</p>
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-dark/25">{flight.member_ids.length}/4</span>
                      <span className="text-dark/20 text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-dark/5 pt-3">
                        {/* Assigned members */}
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
                                  <span className="text-dark/25 text-[10px]">✕</span>
                                </motion.button>
                              );
                            })}
                          </div>
                        )}

                        {/* Available members */}
                        {unassigned.length > 0 && (
                          <>
                            <p className="text-[9px] font-bold text-dark/25 uppercase tracking-wider mb-1.5">Verfügbar</p>
                            <div className="flex flex-wrap gap-1">
                              {unassigned.map((m: any) => (
                                <motion.button
                                  key={m.id}
                                  onClick={() => toggleMember(fi, m.id)}
                                  className="px-2.5 py-1.5 rounded-full border border-dark/10 bg-white text-[10px] font-bold text-dark/40 hover:border-dark/30"
                                  whileTap={{ scale: 0.95 }}
                                >
                                  {m.avatar_emoji} {m.display_name?.split(" ")[0]}
                                </motion.button>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Remove flight */}
                        {flights.length > 1 && (
                          <button
                            onClick={() => removeFlight(fi)}
                            className="mt-3 text-[10px] text-red-400 font-bold"
                          >
                            Flight entfernen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add flight */}
              <button
                onClick={addFlight}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-dark/15 text-[11px] font-bold text-dark/30 mb-4 mt-1"
              >
                + Flight hinzufügen
              </button>

              {/* Unassigned count */}
              {unassigned.length > 0 && (
                <p className="text-[10px] text-dark/30 font-medium mb-3">
                  {unassigned.length} Spieler noch nicht eingeteilt
                </p>
              )}

              {error && (
                <div className="bg-red-50 border-2 border-red-300 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl mb-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <motion.button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 btn-dark py-3 text-sm disabled:opacity-30"
                  whileTap={{ scale: 0.97 }}
                >
                  {saving ? "..." : "Speichern"}
                </motion.button>
                {flights.some((f) => f.member_ids.length > 0) && (
                  <motion.button
                    onClick={handleDeleteAll}
                    disabled={saving}
                    className="px-4 py-3 rounded-full border-2 border-red-300 text-red-500 text-sm font-bold disabled:opacity-30"
                    whileTap={{ scale: 0.97 }}
                  >
                    Alle löschen
                  </motion.button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="h-6" />
      </motion.div>
    </motion.div>
  );
}
