import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getGolfData, getRoundDetails, submitScore } from "../lib/api";
import { IconArrowLeft } from "../components/Icons";
import { Stagger, StaggerItem, Spinner } from "../components/Motion";

interface Props {
  auth: {
    member: { id: string; display_name: string };
    event: { id: string };
  };
}

export default function Golf({ auth }: Props) {
  const [golfData, setGolfData] = useState<any>(null);
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [roundDetail, setRoundDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    getGolfData(auth.event.id).then((d) => { setGolfData(d); }).catch(console.error).finally(() => setLoading(false));
  }, [auth.event.id]);

  const loadRound = useCallback(async (roundId: string) => {
    setSelectedRound(roundId);
    setRoundDetail(null);
    const data = await getRoundDetails(roundId);
    setRoundDetail(data);
  }, []);

  const handleScoreSubmit = useCallback(async (hole: number, strokes: number) => {
    if (!selectedRound) return;
    setSaving(hole);
    try {
      await submitScore(auth.event.id, { round_id: selectedRound, hole, strokes });
      const data = await getRoundDetails(selectedRound);
      setRoundDetail(data);
    } catch (err) {
      console.error("Score submit error:", err);
    }
    setSaving(null);
  }, [selectedRound, auth.event.id]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    return `${days[date.getDay()]}, ${date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}`;
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  if (selectedRound && roundDetail) {
    return (
      <Scorecard
        round={roundDetail.round}
        holes={roundDetail.holes}
        scores={roundDetail.scores}
        members={roundDetail.members}
        memberId={auth.member.id}
        saving={saving}
        onSubmitScore={handleScoreSubmit}
        onBack={() => { setSelectedRound(null); setRoundDetail(null); getGolfData(auth.event.id).then(setGolfData); }}
      />
    );
  }

  if (selectedRound && !roundDetail) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  return (
    <Stagger className="space-y-4">
      <StaggerItem>
        <div className="pt-2 pb-2">
          <div className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
            Scorecard
          </div>
          <h2 className="text-5xl font-extrabold tracking-tight leading-[1.05]">
            Golf<span className="text-gold-400">runden.</span>
          </h2>
          <p className="text-sm text-dark/30 mt-2 font-medium">7 Runden · 5 Plätze · Stableford</p>
        </div>
      </StaggerItem>

      {(!golfData?.rounds || golfData.rounds.length === 0) && (
        <StaggerItem>
          <div className="card p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-accent-mint border-2 border-dark rounded-2xl flex items-center justify-center mb-4">
              <IconArrowLeft className="w-8 h-8 text-dark/30 rotate-180" />
            </div>
            <p className="font-extrabold text-lg tracking-tight mb-1">Noch keine Runden</p>
            <p className="text-sm text-dark/30 font-medium">
              Die Golfrunden werden hier angezeigt, sobald sie erstellt wurden.
            </p>
          </div>
        </StaggerItem>
      )}

      {golfData?.rounds?.map((round: any, index: number) => (
        <StaggerItem key={round.id}>
          <motion.button
            onClick={() => loadRound(round.id)}
            className="w-full card p-5 text-left"
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="pill bg-gold-400">R{index + 1}</span>
                  <span className="text-xs text-dark/25 font-medium">{formatDate(round.date)}</span>
                </div>
                <p className="font-extrabold mt-2 tracking-tight text-[15px]">{round.course_name}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-dark/30 font-medium">
                  <span>Tee {round.tee_time?.slice(0, 5)}</span>
                  <span>Par {round.par_total}</span>
                  <span>{round.format === "stableford" ? "Stableford" : round.format}</span>
                </div>
              </div>
              <div className="text-right">
                {round.players_scored > 0 ? (
                  <span className="pill bg-accent-mint">{round.players_scored} Spieler</span>
                ) : (
                  <span className="pill bg-white text-dark/25">Offen</span>
                )}
              </div>
            </div>
            {round.notes && (
              <p className="text-xs text-dark/25 mt-3 leading-relaxed border-t-2 border-dark/10 pt-2 font-medium">
                {round.notes}
              </p>
            )}
          </motion.button>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* ------------------------------------------------------------------ */
/* Scorecard Component                                                 */
/* ------------------------------------------------------------------ */

interface ScorecardProps {
  round: any;
  holes: any[];
  scores: any[];
  members: any[];
  memberId: string;
  saving: number | null;
  onSubmitScore: (hole: number, strokes: number) => void;
  onBack: () => void;
}

function Scorecard({ round, holes, scores, members, memberId, saving, onSubmitScore, onBack }: ScorecardProps) {
  const [inputValues, setInputValues] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<"my" | "all">("my");

  const myScores = scores.filter((s: any) => s.member_id === memberId);
  const myScoreMap: Record<number, any> = {};
  myScores.forEach((s: any) => { myScoreMap[s.hole] = s; });

  const myTotalStrokes = myScores.reduce((sum: number, s: any) => sum + s.strokes, 0);
  const myTotalStableford = myScores.reduce((sum: number, s: any) => sum + s.stableford, 0);
  const holesPlayed = myScores.length;

  const handleStrokeInput = (hole: number, value: string) => {
    setInputValues((prev) => ({ ...prev, [hole]: value }));
  };

  const handleStrokeSubmit = (hole: number) => {
    const val = parseInt(inputValues[hole] || "");
    if (isNaN(val) || val < 1 || val > 15) return;
    onSubmitScore(hole, val);
    setInputValues((prev) => ({ ...prev, [hole]: "" }));
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  };

  const memberScores: Record<string, { name: string; scores: Record<number, any>; total: number; stableford: number }> = {};
  members.forEach((m: any) => {
    const ms = scores.filter((s: any) => s.member_id === m.id);
    memberScores[m.id] = {
      name: m.display_name,
      scores: {},
      total: ms.reduce((sum: number, s: any) => sum + s.strokes, 0),
      stableford: ms.reduce((sum: number, s: any) => sum + s.stableford, 0),
    };
    ms.forEach((s: any) => { memberScores[m.id].scores[s.hole] = s; });
  });

  const sortedMembers = Object.entries(memberScores)
    .filter(([_, v]) => Object.keys(v.scores).length > 0)
    .sort(([, a], [, b]) => b.stableford - a.stableford);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <motion.button
        onClick={onBack}
        className="text-[11px] font-bold text-dark/30 hover:text-dark/60 transition-colors flex items-center gap-1.5 uppercase tracking-wider"
        whileTap={{ scale: 0.95 }}
      >
        <IconArrowLeft className="w-4 h-4" />
        Zurück
      </motion.button>

      <div className="card p-5">
        <p className="font-extrabold text-lg tracking-tight">{round.course_name}</p>
        <p className="text-sm text-dark/30 mt-1 font-medium">{formatDate(round.date)} · Tee {round.tee_time?.slice(0, 5)} · Par {round.par_total}</p>
        {round.notes && <p className="text-xs text-dark/20 mt-1">{round.notes}</p>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Löcher", value: `${holesPlayed}/18`, color: "" },
          { label: "Schläge", value: myTotalStrokes || "–", color: "" },
          { label: "Stableford", value: myTotalStableford || "–", color: "text-emerald-600" },
        ].map((stat) => (
          <div key={stat.label} className="card p-3 text-center">
            <p className="text-[10px] text-dark/25 uppercase tracking-wider font-bold">{stat.label}</p>
            <p className={`text-xl font-extrabold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* View Toggle */}
      <div className="flex gap-0 border-2 border-dark rounded-full overflow-hidden">
        {(["my", "all"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              viewMode === mode ? "bg-dark text-white" : "bg-white text-dark/25"
            }`}
          >
            {mode === "my" ? "Meine Scorecard" : "Alle Spieler"}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {viewMode === "my" ? (
          <motion.div
            key="my"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="card overflow-hidden"
          >
            <div className="grid grid-cols-[40px_1fr_50px_60px_60px] gap-1 text-[10px] text-dark/25 font-bold uppercase tracking-wider px-3 py-2.5 border-b-2 border-dark/10">
              <span>Loch</span>
              <span>Dist</span>
              <span className="text-center">Par</span>
              <span className="text-center">Score</span>
              <span className="text-center">Pts</span>
            </div>

            {holes.map((hole: any, i: number) => {
              const score = myScoreMap[hole.hole_number];
              const isCurrentlySaving = saving === hole.hole_number;
              const inputVal = inputValues[hole.hole_number] || "";

              return (
                <motion.div
                  key={hole.hole_number}
                  className={`grid grid-cols-[40px_1fr_50px_60px_60px] gap-1 items-center px-3 py-2.5 border-b border-dark/[0.06] ${
                    score ? "" : "bg-gold-400/10"
                  }`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                >
                  <span className="text-sm font-bold text-dark/40">{hole.hole_number}</span>
                  <span className="text-xs text-dark/20 font-medium">{hole.distance_m}m · HCP {hole.handicap_index}</span>
                  <span className="text-center text-sm font-bold text-dark/25">{hole.par}</span>

                  {score ? (
                    <>
                      <motion.span
                        className={`text-center text-sm font-bold ${
                          score.strokes < hole.par ? "text-emerald-600" :
                          score.strokes === hole.par ? "text-dark" :
                          score.strokes === hole.par + 1 ? "text-amber-500" :
                          "text-red-500"
                        }`}
                        initial={{ scale: 1.3 }}
                        animate={{ scale: 1 }}
                      >
                        {score.strokes}
                      </motion.span>
                      <span className={`text-center text-sm font-bold ${
                        score.stableford >= 3 ? "text-emerald-600" :
                        score.stableford === 2 ? "text-dark" :
                        score.stableford === 1 ? "text-amber-500" :
                        "text-red-500"
                      }`}>
                        {score.stableford}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-center">
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="15"
                          value={inputVal}
                          onChange={(e) => handleStrokeInput(hole.hole_number, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleStrokeSubmit(hole.hole_number); }}
                          placeholder="–"
                          className="w-12 text-center input-soft py-1.5 text-sm"
                          disabled={isCurrentlySaving}
                        />
                      </div>
                      <div className="flex justify-center">
                        {inputVal && !isCurrentlySaving && (
                          <motion.button
                            onClick={() => handleStrokeSubmit(hole.hole_number)}
                            className="btn-dark text-xs px-3 py-1.5"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            OK
                          </motion.button>
                        )}
                        {isCurrentlySaving && <Spinner size={18} />}
                      </div>
                    </>
                  )}
                </motion.div>
              );
            })}

            <div className="grid grid-cols-2 border-t-2 border-dark/10">
              {[
                { label: "Front 9", filter: (s: any) => s.hole <= 9 },
                { label: "Back 9", filter: (s: any) => s.hole > 9 },
              ].map((half, idx) => {
                const filtered = myScores.filter(half.filter);
                return (
                  <div key={half.label} className={`p-3 text-center ${idx === 0 ? "border-r border-dark/[0.06]" : ""}`}>
                    <p className="text-[10px] text-dark/20 uppercase tracking-wider font-bold">{half.label}</p>
                    <p className="text-sm font-bold mt-0.5">
                      {filtered.reduce((sum: number, s: any) => sum + s.strokes, 0) || "–"}{" "}
                      <span className="text-dark/15">·</span>{" "}
                      <span className="text-emerald-600">
                        {filtered.reduce((sum: number, s: any) => sum + s.stableford, 0)} Pts
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="all"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {sortedMembers.length === 0 ? (
              <p className="text-sm text-dark/25 text-center py-8 font-medium">Noch keine Scores eingetragen</p>
            ) : (
              sortedMembers.map(([id, data], i) => (
                <motion.div
                  key={id}
                  className="card p-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-lg border-2 border-dark ${
                        i === 0 ? "bg-gold-400" :
                        i === 1 ? "bg-gray-200" :
                        i === 2 ? "bg-orange-200" :
                        "bg-white"
                      }`}>
                        {i + 1}
                      </span>
                      <span className="font-bold text-sm tracking-tight">{data.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-dark/20 font-medium">{data.total} Schläge</span>
                      <span className="font-bold text-emerald-600">{data.stableford} Pts</span>
                    </div>
                  </div>
                  <div className="flex gap-0.5 flex-wrap">
                    {holes.map((hole: any) => {
                      const s = data.scores[hole.hole_number];
                      if (!s) return (
                        <span key={hole.hole_number} className="w-6 h-6 flex items-center justify-center text-[10px] text-dark/10 border border-dark/[0.08] rounded">–</span>
                      );
                      return (
                        <span
                          key={hole.hole_number}
                          className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded border border-dark/20 ${
                            s.stableford >= 4 ? "bg-emerald-200 text-emerald-700" :
                            s.stableford === 3 ? "bg-emerald-100 text-emerald-600" :
                            s.stableford === 2 ? "bg-white text-dark" :
                            s.stableford === 1 ? "bg-amber-100 text-amber-600" :
                            "bg-red-100 text-red-500"
                          }`}
                          title={`Loch ${hole.hole_number}: ${s.strokes} Schläge, ${s.stableford} Pts`}
                        >
                          {s.strokes}
                        </span>
                      );
                    })}
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
