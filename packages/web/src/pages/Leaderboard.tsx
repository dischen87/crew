import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { getGolfData } from "../lib/api";
import { IconCrown, IconTrophy, IconArrowLeft } from "../components/Icons";
import { Stagger, StaggerItem, Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";

export default function Leaderboard() {
  const { auth } = useAuth();
  const [data, setData] = useState<any>(null);
  const [allRounds, setAllRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);

  // Fetch all rounds once for course list
  useEffect(() => {
    if (!auth) return;
    getGolfData(auth.event.id)
      .then((d) => {
        setData(d);
        setAllRounds(d?.rounds || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [auth?.event?.id]);

  // Re-fetch handled by handleSelectRound

  // Reset to full ranking
  const handleSelectGesamt = () => {
    if (selectedRound === null || !auth) return;
    setSelectedRound(null);
    setLoading(true);
    getGolfData(auth.event.id)
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleSelectRound = (roundId: string) => {
    if (!auth) return;
    setSelectedRound(roundId);
    setLoading(true);
    // Fetch leaderboard filtered by this specific round
    const API_BASE = import.meta.env.VITE_API_URL || "/v2";
    const token = localStorage.getItem("crew_token");
    fetch(`${API_BASE}/golf/event/${auth.event.id}?round_id=${roundId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const formatRoundDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  };

  if (!auth) return null;

  const leaderboard = data?.leaderboard || [];

  const selectedRoundData = selectedRound ? allRounds.find((r: any) => r.id === selectedRound) : null;
  const displayLabel = selectedRoundData ? selectedRoundData.course_name : "Gesamtwertung";

  return (
    <>
    <Stagger className="space-y-6">
      <StaggerItem>
        <div className="pt-2 pb-2">
          <div className="inline-block bg-gold-400 border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
            {displayLabel}
          </div>
          <h2 className="text-5xl font-extrabold tracking-tight leading-[1.05]">
            Leader<span className="text-gold-400">board.</span>
          </h2>
          <p className="text-sm text-dark/50 mt-2 font-medium">
            Stableford · {selectedRoundData ? "1 Runde" : `${allRounds.length} Runden`}
          </p>
        </div>
      </StaggerItem>

      {/* Round filter — Gesamt button + compact round list */}
      {allRounds.length > 0 && (
        <StaggerItem>
          <motion.button
            onClick={handleSelectGesamt}
            className={`w-full mb-3 px-4 py-3 rounded-xl text-[12px] font-extrabold uppercase tracking-wider border-2 transition-all text-left ${
              selectedRound === null
                ? "bg-dark text-white border-dark shadow-brutal-xs"
                : "bg-white text-dark/40 border-dark/15"
            }`}
            whileTap={{ scale: 0.97 }}
          >
            Gesamtwertung · {allRounds.length} Runden
          </motion.button>
          <div className="space-y-1.5">
            {allRounds.map((round: any, i: number) => (
              <motion.button
                key={round.id}
                onClick={() => handleSelectRound(round.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border-2 text-left transition-all ${
                  selectedRound === round.id
                    ? "bg-dark text-white border-dark shadow-brutal-xs"
                    : "bg-white text-dark/60 border-dark/10"
                }`}
                whileTap={{ scale: 0.97 }}
              >
                <span className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                  selectedRound === round.id ? "border-white/30 text-white" : "border-dark/15 text-dark/30"
                }`}>
                  R{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-[12px] tracking-tight leading-tight truncate">
                    {round.course_name?.replace("Golf Course", "").replace("Golf Club", "").trim()}
                  </p>
                  <p className={`text-[10px] font-medium ${selectedRound === round.id ? "text-white/40" : "text-dark/25"}`}>
                    {formatRoundDate(round.date)} · {round.tee_time?.slice(0, 5)}
                  </p>
                </div>
                {round.players_scored > 0 && (
                  <span className={`text-[10px] font-bold shrink-0 ${selectedRound === round.id ? "text-white/40" : "text-dark/20"}`}>
                    {round.players_scored}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        </StaggerItem>
      )}

      {loading ? (
        <StaggerItem>
          <div className="flex justify-center py-12"><Spinner /></div>
        </StaggerItem>
      ) : (
        <>
          {/* Top 3 Podium */}
          {leaderboard.length >= 3 && leaderboard[0].total_points > 0 && (
            <StaggerItem>
              <div className="flex items-end justify-center gap-3 pt-4 pb-2">
                {/* 2nd place */}
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.6, type: "spring" }}
                >
                  <Emoji emoji={leaderboard[1].avatar_emoji} size={36} className="mb-2" />
                  <div className="bg-gray-200 border-2 border-dark w-24 h-20 rounded-2xl flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold text-dark/30">2</span>
                  </div>
                  <div className="w-24 bg-white border-2 border-t-0 border-dark rounded-b-2xl py-2 text-center">
                    <p className="text-xs font-bold">{leaderboard[1].display_name.split(" ")[0]}</p>
                    <p className="text-[11px] text-dark/50 font-bold tabular-nums mt-0.5">{leaderboard[1].total_points} Pts</p>
                  </div>
                </motion.div>

                {/* 1st place */}
                <motion.div
                  className="flex flex-col items-center -mt-4"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.7, type: "spring" }}
                >
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <IconCrown className="w-7 h-7 text-gold-400 mb-1 mx-auto" />
                  </motion.div>
                  <Emoji emoji={leaderboard[0].avatar_emoji} size={44} className="mb-2" />
                  <div className="bg-gold-400 border-2 border-dark w-28 h-28 rounded-2xl flex flex-col items-center justify-center shadow-brutal">
                    <span className="text-3xl font-extrabold">1</span>
                  </div>
                  <div className="w-28 bg-white border-2 border-t-0 border-dark rounded-b-2xl py-2 text-center">
                    <p className="text-xs font-bold">{leaderboard[0].display_name.split(" ")[0]}</p>
                    <p className="text-[11px] text-gold-500 font-bold tabular-nums mt-0.5">{leaderboard[0].total_points} Pts</p>
                  </div>
                </motion.div>

                {/* 3rd place */}
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35, duration: 0.6, type: "spring" }}
                >
                  <Emoji emoji={leaderboard[2].avatar_emoji} size={36} className="mb-2" />
                  <div className="bg-orange-200 border-2 border-dark w-24 h-14 rounded-2xl flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold text-orange-700">3</span>
                  </div>
                  <div className="w-24 bg-white border-2 border-t-0 border-dark rounded-b-2xl py-2 text-center">
                    <p className="text-xs font-bold">{leaderboard[2].display_name.split(" ")[0]}</p>
                    <p className="text-[11px] text-dark/50 font-bold tabular-nums mt-0.5">{leaderboard[2].total_points} Pts</p>
                  </div>
                </motion.div>
              </div>
            </StaggerItem>
          )}

          {/* Full list */}
          <StaggerItem>
            <div className="card overflow-hidden">
              <div className="grid grid-cols-[36px_1fr_60px_60px_50px] gap-1 text-[10px] text-dark/40 font-bold uppercase tracking-[0.1em] px-4 py-3 border-b-2 border-dark/10">
                <span>#</span>
                <span>Spieler</span>
                <span className="text-center">Rdn</span>
                <span className="text-center">Schlaege</span>
                <span className="text-center">Pts</span>
              </div>

              {leaderboard.length === 0 && (
                <div className="p-8 text-center">
                  <div className="w-14 h-14 mx-auto bg-gold-400 border-2 border-dark rounded-2xl flex items-center justify-center mb-3">
                    <IconTrophy className="w-7 h-7 text-dark" />
                  </div>
                  <p className="font-extrabold tracking-tight mb-1">Noch keine Scores</p>
                  <p className="text-sm text-dark/50 font-medium">Sobald Spieler ihre Scores eintragen, erscheint das Ranking hier.</p>
                </div>
              )}

              {leaderboard.map((player: any, i: number) => (
                <motion.button
                  key={player.member_id}
                  onClick={() => setSelectedPlayer(player)}
                  className={`w-full grid grid-cols-[36px_1fr_60px_60px_50px] gap-1 items-center px-4 py-3.5 border-b border-dark/[0.06] text-left transition-colors hover:bg-dark/[0.02] active:bg-dark/[0.04] ${
                    player.member_id === auth.member.id
                      ? "bg-gold-400/15 border-l-4 border-l-gold-400"
                      : ""
                  }`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.04, duration: 0.3 }}
                >
                  <span className={`font-bold text-sm ${
                    i === 0 ? "text-gold-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-orange-500" : "text-dark/15"
                  }`}>
                    {i + 1}
                  </span>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Emoji emoji={player.avatar_emoji} size={20} className="shrink-0" />
                    <span className="text-sm font-bold truncate text-dark/70 tracking-tight">{player.display_name}</span>
                  </div>
                  <span className="text-center text-sm text-dark/40 tabular-nums font-medium">{player.rounds_played}</span>
                  <span className="text-center text-sm text-dark/40 tabular-nums font-medium">{player.total_strokes || "–"}</span>
                  <span className="text-center text-sm font-bold text-emerald-600 tabular-nums">{player.total_points}</span>
                </motion.button>
              ))}
            </div>
          </StaggerItem>

          {/* Round breakdown */}
          {allRounds.length > 0 && (
            <StaggerItem>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center">
                    <IconTrophy className="w-3.5 h-3.5 text-dark" />
                  </div>
                  <span className="pill bg-gold-400">Runden-Uebersicht</span>
                </div>
                <div className="space-y-3">
                  {allRounds.map((r: any, i: number) => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5">
                        <span className="pill bg-accent-mint">R{i + 1}</span>
                        <span className="text-dark/50 font-bold tracking-tight">{r.course_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-dark/40 font-medium">
                        <span>{new Date(r.date).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}</span>
                        {r.players_scored > 0 && (
                          <span className="text-emerald-600 font-bold">{r.players_scored} Spieler</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>
          )}
        </>
      )}
    </Stagger>

    {/* Player Detail Overlay */}
    <AnimatePresence>
      {selectedPlayer && (
        <motion.div
          className="fixed inset-0 z-[10000] bg-surface-0 bg-grid overflow-y-auto safe-top safe-bottom"
          initial={{ opacity: 0, y: "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "100%" }}
          transition={{ duration: 0.3 }}
        >
          <div className="max-w-lg mx-auto px-5 py-6">
            <div className="flex items-center gap-3 mb-6">
              <motion.button onClick={() => setSelectedPlayer(null)} className="w-10 h-10 bg-white border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs" whileTap={{ scale: 0.9 }}>
                <IconArrowLeft className="w-5 h-5" />
              </motion.button>
              <div>
                <div className="flex items-center gap-2">
                  <Emoji emoji={selectedPlayer.avatar_emoji} size={24} />
                  <h2 className="text-xl font-extrabold tracking-tight">{selectedPlayer.display_name}</h2>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold text-emerald-600">{selectedPlayer.total_points}</p>
                <p className="text-[10px] font-bold text-dark/30 uppercase">Punkte</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold">{selectedPlayer.rounds_played}</p>
                <p className="text-[10px] font-bold text-dark/30 uppercase">Runden</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-extrabold">{selectedPlayer.total_strokes || "–"}</p>
                <p className="text-[10px] font-bold text-dark/30 uppercase">Schläge</p>
              </div>
            </div>

            {/* Per-round breakdown */}
            {allRounds.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-dark/30 uppercase tracking-wider">Gespielte Runden</p>
                {allRounds.map((round: any) => (
                  <div key={round.id} className="card p-4">
                    <p className="font-bold text-sm tracking-tight">{round.course_name}</p>
                    <p className="text-[10px] text-dark/40 mt-0.5">
                      {formatRoundDate(round.date)} · {round.tee_time?.slice(0, 5)} · Par {round.par_total}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
