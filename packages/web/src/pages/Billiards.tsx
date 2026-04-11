import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { getActivityMatches, createActivityMatch, recordActivityResult, deleteActivityMatch, getActivityLeaderboard, getGroup, createTournament, getTournament } from "../lib/api";
import { Stagger, StaggerItem, Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";

export default function Billiards() {
  const { auth } = useAuth();
  const [matches, setMatches] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showTournament, setShowTournament] = useState(false);
  const [resultMatch, setResultMatch] = useState<any>(null);
  const [tournaments, setTournaments] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const [matchData, lbData, groupData] = await Promise.all([
        getActivityMatches(auth.event.id, "billiards"),
        getActivityLeaderboard(auth.event.id, "billiards").catch(() => ({ leaderboard: [] })),
        getGroup(auth.group.id),
      ]);
      setMatches(matchData.matches || []);
      setLeaderboard(lbData.leaderboard || []);
      setMembers(groupData.members || []);
      // Load tournaments
      getTournament(auth.event.id, "billiards").then((t) => setTournaments(t.tournaments || [])).catch(() => {});
    } catch (err) {
      console.error("Failed to load billiards:", err);
    }
    setLoading(false);
  }, [auth?.event?.id, auth?.group?.id]);

  useEffect(() => { load(); }, [load]);

  if (!auth) return null;
  if (loading) return <div className="flex justify-center py-20"><Spinner size={40} /></div>;

  const openMatches = matches.filter((m) => m.status === "open");
  const completedMatches = matches.filter((m) => m.status === "completed");

  return (
    <>
    <Stagger className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div className="pt-2 pb-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl">🎱</span>
            <div>
              <div className="inline-block bg-accent-mint border-2 border-dark px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                8-Ball
              </div>
            </div>
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight leading-[1.05]">
            Billard<span className="text-gold-400">.</span>
          </h2>
        </div>
      </StaggerItem>

      {/* Actions */}
      <StaggerItem>
        <div className="grid grid-cols-2 gap-2">
          <motion.button
            onClick={() => setShowCreate(true)}
            className="card-gold p-4 flex flex-col items-center gap-1.5"
            whileTap={{ scale: 0.97 }}
          >
            <span className="w-8 h-8 bg-dark border-2 border-dark rounded-xl flex items-center justify-center text-white text-sm font-extrabold">+</span>
            <span className="text-[12px] font-extrabold">Freies Match</span>
          </motion.button>
          <motion.button
            onClick={() => setShowTournament(true)}
            className="card-lavender p-4 flex flex-col items-center gap-1.5"
            whileTap={{ scale: 0.97 }}
          >
            <span className="text-xl">🏆</span>
            <span className="text-[12px] font-extrabold">Turnier</span>
          </motion.button>
        </div>
      </StaggerItem>

      {/* Tournament brackets */}
      {tournaments.map((t) => (
        <StaggerItem key={t.id}>
          <TournamentBracket tournament={t} onResult={(m: any) => setResultMatch(m)} />
        </StaggerItem>
      ))}

      {/* Open matches */}
      {openMatches.length > 0 && (
        <StaggerItem>
          <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-2">Laufend</p>
          <div className="space-y-2">
            {openMatches.map((match) => (
              <div key={match.id} className="card-mint p-4">
                <div className="flex items-center">
                  <div className="flex-1 flex items-center gap-2">
                    <Emoji emoji={match.player1_emoji} size={22} />
                    <span className="font-extrabold text-[14px]">{match.player1_name?.split(" ")[0]}</span>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-dark/10 flex items-center justify-center">
                    <span className="text-[10px] font-extrabold text-dark/30">VS</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2 justify-end">
                    <span className="font-extrabold text-[14px]">{match.player2_name?.split(" ")[0]}</span>
                    <Emoji emoji={match.player2_emoji} size={22} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <motion.button
                    onClick={() => setResultMatch(match)}
                    className="flex-1 btn-dark text-xs py-2.5"
                    whileTap={{ scale: 0.95 }}
                  >
                    Ergebnis eintragen
                  </motion.button>
                  <motion.button
                    onClick={async () => { await deleteActivityMatch(match.id); load(); }}
                    className="px-3 py-2.5 rounded-full border-2 border-dark/15 text-dark/30 text-xs font-bold"
                    whileTap={{ scale: 0.95 }}
                  >
                    ✕
                  </motion.button>
                </div>
              </div>
            ))}
          </div>
        </StaggerItem>
      )}

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <StaggerItem>
          <div className="card p-5">
            <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-3">Rangliste</p>
            <div className="space-y-2.5">
              {leaderboard.map((p, i) => (
                <div key={p.member_id} className={`flex items-center gap-3 ${i < 3 ? "" : ""}`}>
                  <span className={`w-7 h-7 flex items-center justify-center text-[10px] font-extrabold rounded-lg border-2 border-dark shadow-brutal-xs shrink-0 ${
                    i === 0 ? "bg-gold-400" : i === 1 ? "bg-gray-200" : i === 2 ? "bg-orange-200" : "bg-white"
                  }`}>{i + 1}</span>
                  <Emoji emoji={p.avatar_emoji} size={20} className="shrink-0" />
                  <span className="flex-1 text-sm font-bold truncate">{p.display_name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-dark/30 font-bold tabular-nums">{p.wins}S {p.losses}N</span>
                    <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{p.total_points} Pkt</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </StaggerItem>
      )}

      {/* Completed matches */}
      {completedMatches.length > 0 && (
        <StaggerItem>
          <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider mb-2">Ergebnisse</p>
          <div className="space-y-2">
            {completedMatches.map((match) => {
              const p1Won = match.winner_id === match.player1_id;
              return (
                <div key={match.id} className="card p-4">
                  <div className="flex items-center">
                    <div className={`flex-1 flex items-center gap-2 ${p1Won ? "" : "opacity-35"}`}>
                      <Emoji emoji={match.player1_emoji} size={18} />
                      <span className="font-bold text-[13px]">{match.player1_name?.split(" ")[0]}</span>
                    </div>
                    <div className="px-3 py-1 bg-dark/5 rounded-lg">
                      <span className="text-[15px] font-extrabold tabular-nums">
                        {match.score_p1 ?? "–"}<span className="text-dark/20 mx-1">:</span>{match.score_p2 ?? "–"}
                      </span>
                    </div>
                    <div className={`flex-1 flex items-center gap-2 justify-end ${!p1Won ? "" : "opacity-35"}`}>
                      <span className="font-bold text-[13px]">{match.player2_name?.split(" ")[0]}</span>
                      <Emoji emoji={match.player2_emoji} size={18} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </StaggerItem>
      )}

      {/* Empty state */}
      {matches.length === 0 && (
        <StaggerItem>
          <div className="card p-8 text-center">
            <span className="text-5xl block mb-3">🎱</span>
            <p className="font-extrabold text-lg mb-1">Noch keine Matches</p>
            <p className="text-sm text-dark/40 font-medium">Starte ein Match und trag die Ergebnisse ein!</p>
          </div>
        </StaggerItem>
      )}
    </Stagger>

    {/* Create match bottom sheet */}
    <AnimatePresence>
      {showCreate && (
        <CreateMatchSheet members={members} eventId={auth.event.id} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </AnimatePresence>

    {/* Record result bottom sheet */}
    <AnimatePresence>
      {resultMatch && (
        <ResultSheet match={resultMatch} onClose={() => setResultMatch(null)} onSaved={() => { setResultMatch(null); load(); }} />
      )}
    </AnimatePresence>

    {/* Tournament creation */}
    <AnimatePresence>
      {showTournament && (
        <TournamentCreateSheet members={members} eventId={auth.event.id} onClose={() => setShowTournament(false)} onCreated={() => { setShowTournament(false); load(); }} />
      )}
    </AnimatePresence>
    </>
  );
}

/* ── Create Match Sheet ────────────────────────────────── */

function CreateMatchSheet({ members, eventId, onClose, onCreated }: { members: any[]; eventId: string; onClose: () => void; onCreated: () => void }) {
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

  const p1Member = members.find((m: any) => m.id === p1);
  const p2Member = members.find((m: any) => m.id === p2);

  return (
    <motion.div className="fixed inset-0 z-[10000] bg-black/50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-dark/10 rounded-full" /></div>
        <div className="px-5 pt-2 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-extrabold tracking-tight">Neues Match</h3>
            <button onClick={onClose} className="w-8 h-8 bg-dark/5 rounded-lg flex items-center justify-center text-dark/40 text-sm font-bold">✕</button>
          </div>

          {/* Preview */}
          {(p1 || p2) && (
            <div className="card-gold p-4 mb-5 flex items-center">
              <div className="flex-1 text-center">
                {p1Member ? (
                  <><Emoji emoji={p1Member.avatar_emoji} size={28} className="mx-auto mb-1" /><p className="text-[12px] font-extrabold">{p1Member.display_name?.split(" ")[0]}</p></>
                ) : <p className="text-dark/20 text-sm font-bold">Spieler 1</p>}
              </div>
              <span className="text-dark/20 font-extrabold text-lg px-3">vs</span>
              <div className="flex-1 text-center">
                {p2Member ? (
                  <><Emoji emoji={p2Member.avatar_emoji} size={28} className="mx-auto mb-1" /><p className="text-[12px] font-extrabold">{p2Member.display_name?.split(" ")[0]}</p></>
                ) : <p className="text-dark/20 text-sm font-bold">Spieler 2</p>}
              </div>
            </div>
          )}

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Spieler 1 waehlen</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {members.map((m: any) => (
              <motion.button
                key={m.id}
                onClick={() => setP1(p1 === m.id ? "" : m.id)}
                className={`px-3 py-2 rounded-xl border-2 text-[11px] font-bold transition-all ${
                  p1 === m.id ? "bg-gold-400 border-dark shadow-brutal-xs" : p2 === m.id ? "bg-dark/5 border-dark/5 text-dark/15" : "bg-white border-dark/15 text-dark/60"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                {m.avatar_emoji} {m.display_name?.split(" ")[0]}
              </motion.button>
            ))}
          </div>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Spieler 2 waehlen</p>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {members.map((m: any) => (
              <motion.button
                key={m.id}
                onClick={() => setP2(p2 === m.id ? "" : m.id)}
                className={`px-3 py-2 rounded-xl border-2 text-[11px] font-bold transition-all ${
                  p2 === m.id ? "bg-accent-mint border-dark shadow-brutal-xs" : p1 === m.id ? "bg-dark/5 border-dark/5 text-dark/15" : "bg-white border-dark/15 text-dark/60"
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
            className="w-full btn-dark py-3.5 text-sm font-extrabold disabled:opacity-20"
            whileTap={{ scale: 0.97 }}
          >
            {saving ? "..." : "Match starten 🎱"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Result Sheet ──────────────────────────────────────── */

function ResultSheet({ match, onClose, onSaved }: { match: any; onClose: () => void; onSaved: () => void }) {
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
      <motion.div
        className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-dark/10 rounded-full" /></div>
        <div className="px-5 pt-2 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-extrabold tracking-tight">Ergebnis</h3>
            <button onClick={onClose} className="w-8 h-8 bg-dark/5 rounded-lg flex items-center justify-center text-dark/40 text-sm font-bold">✕</button>
          </div>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-3">Gewinner antippen</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { id: match.player1_id, name: match.player1_name, emoji: match.player1_emoji },
              { id: match.player2_id, name: match.player2_name, emoji: match.player2_emoji },
            ].map((p) => (
              <motion.button
                key={p.id}
                onClick={() => setWinnerId(winnerId === p.id ? "" : p.id)}
                className={`p-5 rounded-2xl border-3 text-center transition-all ${
                  winnerId === p.id ? "bg-gold-400 border-dark shadow-brutal" : "bg-surface-0 border-dark/10"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <Emoji emoji={p.emoji} size={36} className="mx-auto mb-2" />
                <p className="font-extrabold text-[14px]">{p.name?.split(" ")[0]}</p>
                {winnerId === p.id && <p className="text-[10px] font-extrabold text-dark/50 mt-1 uppercase tracking-wider">Gewinner</p>}
              </motion.button>
            ))}
          </div>

          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Score (optional)</p>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 text-center">
              <p className="text-[10px] font-bold text-dark/25 mb-1">{match.player1_name?.split(" ")[0]}</p>
              <input type="number" inputMode="numeric" value={scoreP1} onChange={(e) => setScoreP1(e.target.value)} placeholder="0" className="w-full input-soft py-3 text-center text-xl font-extrabold" />
            </div>
            <span className="text-dark/15 font-extrabold text-xl mt-4">:</span>
            <div className="flex-1 text-center">
              <p className="text-[10px] font-bold text-dark/25 mb-1">{match.player2_name?.split(" ")[0]}</p>
              <input type="number" inputMode="numeric" value={scoreP2} onChange={(e) => setScoreP2(e.target.value)} placeholder="0" className="w-full input-soft py-3 text-center text-xl font-extrabold" />
            </div>
          </div>

          <motion.button
            onClick={handleSave}
            disabled={saving || !winnerId}
            className="w-full btn-dark py-3.5 text-sm font-extrabold disabled:opacity-20"
            whileTap={{ scale: 0.97 }}
          >
            {saving ? "..." : "Ergebnis speichern"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Tournament Bracket ────────────────────────────────── */

const ROUND_LABELS: Record<string, string> = {
  "round-of-16": "Achtel",
  quarterfinal: "Viertel",
  semifinal: "Halbfinale",
  final: "Finale",
};

function TournamentBracket({ tournament, onResult }: { tournament: any; onResult: (m: any) => void }) {
  const roundOrder = ["round-of-16", "quarterfinal", "semifinal", "final"];
  const rounds = roundOrder.filter((r) => tournament.rounds[r]);
  const finalMatch = tournament.rounds["final"]?.[0];
  const isComplete = finalMatch?.status === "completed";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏆</span>
        <span className="text-[12px] font-extrabold uppercase tracking-wider">Turnier</span>
        {isComplete && finalMatch?.winner_name && (
          <span className="pill bg-gold-400 text-[10px]">{finalMatch.winner_name.split(" ")[0]}</span>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {rounds.map((roundKey) => (
          <div key={roundKey} className="shrink-0" style={{ minWidth: "130px" }}>
            <p className="text-[9px] font-extrabold text-dark/30 uppercase tracking-wider mb-2 text-center">
              {ROUND_LABELS[roundKey]}
            </p>
            <div className="space-y-2 flex flex-col justify-around h-full">
              {tournament.rounds[roundKey].map((match: any) => {
                const isOpen = match.status === "open";
                const isPending = match.status === "pending";
                const p1Won = match.winner_id === match.player1_id;
                const p2Won = match.winner_id === match.player2_id;
                return (
                  <motion.button
                    key={match.id}
                    onClick={() => isOpen && onResult(match)}
                    disabled={!isOpen}
                    className={`w-full rounded-xl border-2 p-2 text-left ${
                      isOpen ? "border-dark bg-gold-400/10" : isPending ? "border-dashed border-dark/10" : "border-dark/10"
                    }`}
                    whileTap={isOpen ? { scale: 0.95 } : undefined}
                  >
                    <div className={`flex items-center gap-1.5 ${p2Won ? "opacity-30" : ""}`}>
                      {match.player1_emoji && <Emoji emoji={match.player1_emoji} size={13} />}
                      <span className="text-[10px] font-bold truncate flex-1">{match.player1_name?.split(" ")[0] || "..."}</span>
                      {match.score_p1 != null && <span className="text-[9px] font-extrabold">{match.score_p1}</span>}
                    </div>
                    <div className="border-t border-dark/5 my-0.5" />
                    <div className={`flex items-center gap-1.5 ${p1Won ? "opacity-30" : ""}`}>
                      {match.player2_emoji && <Emoji emoji={match.player2_emoji} size={13} />}
                      <span className="text-[10px] font-bold truncate flex-1">{match.player2_name?.split(" ")[0] || "..."}</span>
                      {match.score_p2 != null && <span className="text-[9px] font-extrabold">{match.score_p2}</span>}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Tournament Create ─────────────────────────────────── */

function TournamentCreateSheet({ members, eventId, onClose, onCreated }: { members: any[]; eventId: string; onClose: () => void; onCreated: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const handleCreate = async () => {
    if (selected.length < 2) return;
    setSaving(true);
    try { await createTournament(eventId, { type: "billiards", player_ids: selected }); onCreated(); } catch {}
    setSaving(false);
  };

  const bracketSize = selected.length >= 2 ? Math.pow(2, Math.ceil(Math.log2(selected.length))) : 0;

  return (
    <motion.div className="fixed inset-0 z-[10000] bg-black/50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="bg-white rounded-t-3xl border-t-3 border-x-3 border-dark w-full max-w-lg max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-dark/10 rounded-full" /></div>
        <div className="px-5 pt-2 pb-8">
          <h3 className="text-lg font-extrabold tracking-tight mb-1">Turnier erstellen</h3>
          <p className="text-[11px] text-dark/40 font-medium mb-4">Teilnehmer waehlen — Auslosung automatisch.</p>

          {selected.length >= 2 && (
            <div className="card-lavender p-3 mb-4 text-center">
              <span className="text-[12px] font-extrabold">{selected.length} Spieler · {bracketSize - 1} Matches</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-5">
            {members.map((m: any) => (
              <motion.button key={m.id} onClick={() => toggle(m.id)}
                className={`px-3 py-2 rounded-xl border-2 text-[11px] font-bold ${selected.includes(m.id) ? "bg-gold-400 border-dark shadow-brutal-xs" : "bg-white border-dark/15 text-dark/60"}`}
                whileTap={{ scale: 0.95 }}>
                {m.avatar_emoji} {m.display_name?.split(" ")[0]}
              </motion.button>
            ))}
          </div>

          <motion.button onClick={handleCreate} disabled={saving || selected.length < 2}
            className="w-full btn-dark py-3.5 text-sm font-extrabold disabled:opacity-20" whileTap={{ scale: 0.97 }}>
            {saving ? "Auslosung..." : `Turnier starten 🏆`}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
