import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { getActivityMatches, createActivityMatch, recordActivityResult, deleteActivityMatch, getActivityLeaderboard, getGroup } from "../lib/api";
import { Stagger, StaggerItem, Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";

export default function Billiards() {
  const { auth } = useAuth();
  const [matches, setMatches] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resultMatch, setResultMatch] = useState<any>(null);

  if (!auth) return null;

  const load = async () => {
    try {
      const [matchData, lbData, groupData] = await Promise.all([
        getActivityMatches(auth.event.id, "billiards"),
        getActivityLeaderboard(auth.event.id, "billiards").catch(() => ({ leaderboard: [] })),
        getGroup(auth.group.id),
      ]);
      setMatches(matchData.matches || []);
      setLeaderboard(lbData.leaderboard || []);
      setMembers(groupData.members || []);
    } catch (err) {
      console.error("Failed to load billiards:", err);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [auth.event.id]);

  const openMatches = matches.filter((m) => m.status === "open");
  const completedMatches = matches.filter((m) => m.status === "completed");

  if (loading) return <div className="flex justify-center py-20"><Spinner size={40} /></div>;

  return (
    <>
    <Stagger className="space-y-5">
      <StaggerItem>
        <div className="pt-2 pb-2">
          <div className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
            8-Ball
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight leading-[1.05]">
            Billard<span className="text-gold-400">.</span>
          </h2>
        </div>
      </StaggerItem>

      {/* Leaderboard compact */}
      {leaderboard.length > 0 && (
        <StaggerItem>
          <div className="card p-4">
            <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-3">Rangliste</p>
            <div className="space-y-2">
              {leaderboard.map((p, i) => (
                <div key={p.member_id} className="flex items-center gap-2.5">
                  <span className={`w-6 h-6 flex items-center justify-center text-[10px] font-extrabold rounded-lg border-2 border-dark shadow-brutal-xs ${
                    i === 0 ? "bg-gold-400" : i === 1 ? "bg-gray-200" : i === 2 ? "bg-orange-200" : "bg-white"
                  }`}>{i + 1}</span>
                  <Emoji emoji={p.avatar_emoji} size={18} />
                  <span className="flex-1 text-sm font-bold truncate">{p.display_name}</span>
                  <span className="text-[10px] text-dark/30 font-bold tabular-nums">{p.wins}W {p.losses}L</span>
                  <span className="text-sm font-extrabold text-emerald-600 tabular-nums w-8 text-right">{p.total_points}</span>
                </div>
              ))}
            </div>
          </div>
        </StaggerItem>
      )}

      {/* New match button */}
      <StaggerItem>
        <motion.button
          onClick={() => setShowCreate(true)}
          className="w-full card-gold p-4 flex items-center justify-center gap-2.5"
          whileTap={{ scale: 0.97 }}
        >
          <span className="w-8 h-8 bg-dark border-2 border-dark rounded-xl flex items-center justify-center text-white text-sm font-extrabold">+</span>
          <span className="text-[14px] font-extrabold">Neues Match</span>
        </motion.button>
      </StaggerItem>

      {/* Open matches */}
      {openMatches.length > 0 && (
        <StaggerItem>
          <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-2">Laufende Matches</p>
          <div className="space-y-2">
            {openMatches.map((match) => (
              <div key={match.id} className="card-mint p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2">
                    <Emoji emoji={match.player1_emoji} size={20} />
                    <span className="font-bold text-sm">{match.player1_name?.split(" ")[0]}</span>
                  </div>
                  <span className="text-xs font-extrabold text-dark/25">vs</span>
                  <div className="flex-1 flex items-center gap-2 justify-end">
                    <span className="font-bold text-sm">{match.player2_name?.split(" ")[0]}</span>
                    <Emoji emoji={match.player2_emoji} size={20} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <motion.button
                    onClick={() => setResultMatch(match)}
                    className="flex-1 btn-dark text-xs py-2"
                    whileTap={{ scale: 0.95 }}
                  >
                    Ergebnis eintragen
                  </motion.button>
                  <motion.button
                    onClick={async () => { await deleteActivityMatch(match.id); load(); }}
                    className="px-3 py-2 rounded-full border-2 border-red-300 text-red-400 text-xs font-bold"
                    whileTap={{ scale: 0.95 }}
                  >
                    Abbrechen
                  </motion.button>
                </div>
              </div>
            ))}
          </div>
        </StaggerItem>
      )}

      {/* Completed matches */}
      {completedMatches.length > 0 && (
        <StaggerItem>
          <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-2">Gespielte Matches</p>
          <div className="space-y-2">
            {completedMatches.map((match) => {
              const p1Won = match.winner_id === match.player1_id;
              return (
                <div key={match.id} className="card p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 flex items-center gap-2 ${p1Won ? "" : "opacity-40"}`}>
                      <Emoji emoji={match.player1_emoji} size={18} />
                      <span className="font-bold text-sm">{match.player1_name?.split(" ")[0]}</span>
                      {p1Won && <span className="text-xs">🏆</span>}
                    </div>
                    <div className="text-center">
                      <span className="text-lg font-extrabold tabular-nums">
                        {match.score_p1 ?? "-"} : {match.score_p2 ?? "-"}
                      </span>
                    </div>
                    <div className={`flex-1 flex items-center gap-2 justify-end ${!p1Won ? "" : "opacity-40"}`}>
                      {!p1Won && <span className="text-xs">🏆</span>}
                      <span className="font-bold text-sm">{match.player2_name?.split(" ")[0]}</span>
                      <Emoji emoji={match.player2_emoji} size={18} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </StaggerItem>
      )}

      {matches.length === 0 && (
        <StaggerItem>
          <div className="card p-8 text-center">
            <span className="text-4xl block mb-3">🎱</span>
            <p className="font-extrabold text-lg mb-1">Noch keine Matches</p>
            <p className="text-sm text-dark/40">Erstelle ein Match, um loszulegen.</p>
          </div>
        </StaggerItem>
      )}
    </Stagger>

    {/* Create match popup */}
    <AnimatePresence>
      {showCreate && (
        <CreateMatchModal
          members={members}
          eventId={auth.event.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </AnimatePresence>

    {/* Record result popup */}
    <AnimatePresence>
      {resultMatch && (
        <ResultModal
          match={resultMatch}
          onClose={() => setResultMatch(null)}
          onSaved={() => { setResultMatch(null); load(); }}
        />
      )}
    </AnimatePresence>
    </>
  );
}

function CreateMatchModal({ members, eventId, onClose, onCreated }: { members: any[]; eventId: string; onClose: () => void; onCreated: () => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!p1 || !p2 || p1 === p2) return;
    setSaving(true);
    try {
      await createActivityMatch(eventId, { type: "billiards", player1_id: p1, player2_id: p2 });
      onCreated();
    } catch {}
    setSaving(false);
  };

  return (
    <motion.div className="fixed inset-0 z-[10000] bg-black/50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-dark/10 rounded-full" /></div>
        <div className="px-5 pt-2 pb-6">
          <h3 className="text-lg font-extrabold tracking-tight mb-4">Neues Match</h3>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Spieler 1</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {members.map((m: any) => (
              <motion.button
                key={m.id}
                onClick={() => setP1(m.id)}
                className={`px-3 py-1.5 rounded-full border-2 text-[11px] font-bold transition-all ${
                  p1 === m.id ? "bg-gold-400 border-dark" : p2 === m.id ? "bg-dark/5 border-dark/5 text-dark/20" : "bg-white border-dark/15 text-dark/50"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                {m.avatar_emoji} {m.display_name?.split(" ")[0]}
              </motion.button>
            ))}
          </div>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Spieler 2</p>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {members.map((m: any) => (
              <motion.button
                key={m.id}
                onClick={() => setP2(m.id)}
                className={`px-3 py-1.5 rounded-full border-2 text-[11px] font-bold transition-all ${
                  p2 === m.id ? "bg-accent-mint border-dark" : p1 === m.id ? "bg-dark/5 border-dark/5 text-dark/20" : "bg-white border-dark/15 text-dark/50"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                {m.avatar_emoji} {m.display_name?.split(" ")[0]}
              </motion.button>
            ))}
          </div>

          <motion.button
            onClick={handleCreate}
            disabled={saving || !p1 || !p2 || p1 === p2}
            className="w-full btn-dark py-3 text-sm disabled:opacity-30"
            whileTap={{ scale: 0.97 }}
          >
            {saving ? "..." : "Match starten"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ResultModal({ match, onClose, onSaved }: { match: any; onClose: () => void; onSaved: () => void }) {
  const [winnerId, setWinnerId] = useState("");
  const [scoreP1, setScoreP1] = useState("");
  const [scoreP2, setScoreP2] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!winnerId) return;
    setSaving(true);
    try {
      await recordActivityResult(match.id, {
        winner_id: winnerId,
        score_p1: scoreP1 ? parseInt(scoreP1) : undefined,
        score_p2: scoreP2 ? parseInt(scoreP2) : undefined,
      });
      onSaved();
    } catch {}
    setSaving(false);
  };

  return (
    <motion.div className="fixed inset-0 z-[10000] bg-black/50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-dark/10 rounded-full" /></div>
        <div className="px-5 pt-2 pb-6">
          <h3 className="text-lg font-extrabold tracking-tight mb-4">Ergebnis eintragen</h3>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-3">Wer hat gewonnen?</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <motion.button
              onClick={() => setWinnerId(match.player1_id)}
              className={`p-4 rounded-xl border-3 text-center transition-all ${
                winnerId === match.player1_id ? "bg-gold-400 border-dark shadow-brutal-xs" : "bg-white border-dark/10"
              }`}
              whileTap={{ scale: 0.95 }}
            >
              <Emoji emoji={match.player1_emoji} size={28} className="mx-auto mb-1" />
              <p className="font-extrabold text-sm">{match.player1_name?.split(" ")[0]}</p>
              {winnerId === match.player1_id && <p className="text-[10px] font-bold mt-1">Gewinner</p>}
            </motion.button>
            <motion.button
              onClick={() => setWinnerId(match.player2_id)}
              className={`p-4 rounded-xl border-3 text-center transition-all ${
                winnerId === match.player2_id ? "bg-gold-400 border-dark shadow-brutal-xs" : "bg-white border-dark/10"
              }`}
              whileTap={{ scale: 0.95 }}
            >
              <Emoji emoji={match.player2_emoji} size={28} className="mx-auto mb-1" />
              <p className="font-extrabold text-sm">{match.player2_name?.split(" ")[0]}</p>
              {winnerId === match.player2_id && <p className="text-[10px] font-bold mt-1">Gewinner</p>}
            </motion.button>
          </div>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Score (optional)</p>
          <div className="flex items-center gap-3 mb-5">
            <input type="number" inputMode="numeric" value={scoreP1} onChange={(e) => setScoreP1(e.target.value)} placeholder="0" className="flex-1 input-soft py-2.5 text-center text-lg font-extrabold" />
            <span className="text-dark/20 font-extrabold">:</span>
            <input type="number" inputMode="numeric" value={scoreP2} onChange={(e) => setScoreP2(e.target.value)} placeholder="0" className="flex-1 input-soft py-2.5 text-center text-lg font-extrabold" />
          </div>

          <motion.button
            onClick={handleSave}
            disabled={saving || !winnerId}
            className="w-full btn-dark py-3 text-sm disabled:opacity-30"
            whileTap={{ scale: 0.97 }}
          >
            {saving ? "..." : "Ergebnis speichern"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
