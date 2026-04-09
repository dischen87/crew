import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getGolfData, getRoundDetails, submitScore, deleteScore, getHandicap, setHandicap, getCourseDetail, getCourseTees, getCourseHoles, getRoundTeams } from "../lib/api";
import { IconArrowLeft, IconGolf } from "../components/Icons";
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
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [handicap, setHandicapVal] = useState<number | null>(null);
  const [handicapInput, setHandicapInput] = useState("");
  const [handicapLoading, setHandicapLoading] = useState(true);
  const [savingHandicap, setSavingHandicap] = useState(false);

  useEffect(() => {
    Promise.all([
      getGolfData(auth.event.id).then(setGolfData),
      getHandicap(auth.event.id).then((d) => {
        setHandicapVal(d.handicap);
        if (d.handicap != null) setHandicapInput(String(d.handicap));
      }).catch(() => {}),
    ]).finally(() => { setLoading(false); setHandicapLoading(false); });
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

  const handleScoreDelete = useCallback(async (hole: number) => {
    if (!selectedRound) return;
    setSaving(hole);
    try {
      await deleteScore(auth.event.id, { round_id: selectedRound, hole });
      const data = await getRoundDetails(selectedRound);
      setRoundDetail(data);
    } catch (err) {
      console.error("Score delete error:", err);
    }
    setSaving(null);
  }, [selectedRound, auth.event.id]);

  const handleHandicapSave = async () => {
    const val = parseFloat(handicapInput);
    if (isNaN(val) || val < 0 || val > 54) return;
    setSavingHandicap(true);
    try {
      await setHandicap(auth.event.id, val);
      setHandicapVal(val);
    } catch (err) {
      console.error("Handicap save error:", err);
    }
    setSavingHandicap(false);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    return `${days[date.getDay()]}, ${date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}`;
  };

  if (loading || handicapLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  // Course detail view
  if (selectedCourse) {
    return (
      <CourseDetailView
        courseId={selectedCourse}
        onBack={() => setSelectedCourse(null)}
      />
    );
  }

  // Scorecard view
  if (selectedRound && roundDetail) {
    const roundInfo = golfData?.rounds?.find((r: any) => r.id === selectedRound);
    return (
      <Scorecard
        round={roundDetail.round}
        roundLabel={roundInfo ? `R${golfData.rounds.indexOf(roundInfo) + 1}` : ""}
        holes={roundDetail.holes}
        scores={roundDetail.scores}
        members={roundDetail.members}
        memberId={auth.member.id}
        saving={saving}
        handicap={handicap}
        onSubmitScore={handleScoreSubmit}
        onDeleteScore={handleScoreDelete}
        onBack={() => { setSelectedRound(null); setRoundDetail(null); getGolfData(auth.event.id).then(setGolfData); }}
      />
    );
  }

  if (selectedRound && !roundDetail) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  // Handicap gate
  const needsHandicap = handicap == null;

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
          <p className="text-sm text-dark/50 mt-2 font-medium">7 Runden · 5 Plätze · Stableford</p>
        </div>
      </StaggerItem>

      {/* Handicap Card */}
      <StaggerItem>
        <div className={`card p-5 ${needsHandicap ? "border-gold-400 bg-gold-400/10" : ""}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-dark/50 uppercase tracking-wider">Dein Handicap</p>
              {handicap != null ? (
                <p className="text-2xl font-extrabold mt-1">{handicap}</p>
              ) : (
                <p className="text-sm text-dark/50 mt-1 font-medium">Bitte eintragen, um Scores zu erfassen</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="54"
                value={handicapInput}
                onChange={(e) => setHandicapInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleHandicapSave(); }}
                placeholder="z.B. 18.4"
                className="w-20 text-center input-soft py-2 text-sm font-bold"
              />
              <motion.button
                onClick={handleHandicapSave}
                disabled={savingHandicap || !handicapInput}
                className="btn-dark text-xs px-4 py-2 disabled:opacity-20"
                whileTap={{ scale: 0.95 }}
              >
                {savingHandicap ? "..." : "OK"}
              </motion.button>
            </div>
          </div>
        </div>
      </StaggerItem>

      {(!golfData?.rounds || golfData.rounds.length === 0) && (
        <StaggerItem>
          <div className="card p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-accent-mint border-2 border-dark rounded-2xl flex items-center justify-center mb-4">
              <IconGolf className="w-8 h-8 text-dark/40" />
            </div>
            <p className="font-extrabold text-lg tracking-tight mb-1">Noch keine Runden</p>
            <p className="text-sm text-dark/50 font-medium">
              Die Golfrunden werden hier angezeigt, sobald sie erstellt wurden.
            </p>
          </div>
        </StaggerItem>
      )}

      {golfData?.rounds?.map((round: any, index: number) => (
        <StaggerItem key={round.id}>
          <motion.button
            onClick={() => needsHandicap ? null : loadRound(round.id)}
            className={`w-full card p-5 text-left ${needsHandicap ? "opacity-50 cursor-not-allowed" : ""}`}
            whileTap={needsHandicap ? undefined : { scale: 0.98 }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="pill bg-gold-400">R{index + 1}</span>
                  <span className="text-xs text-dark/40 font-medium">{formatDate(round.date)}</span>
                </div>
                <p className="font-extrabold mt-2 tracking-tight text-[15px]">{round.course_name}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-dark/50 font-medium">
                  <span>Tee {round.tee_time?.slice(0, 5)}</span>
                  <span>Par {round.par_total}</span>
                  <span>{round.format === "stableford" ? "Stableford" : round.format}</span>
                  {round.game_mode && round.game_mode !== "individual" && (
                    <span className="pill bg-accent-gold text-dark text-[10px] font-bold px-2 py-0.5 rounded-full">{
                      round.game_mode === "4v4" ? "4 vs 4" :
                      round.game_mode === "2v2" ? "2 vs 2" :
                      round.game_mode === "scramble" ? "Scramble" :
                      round.game_mode === "best_ball" ? "Best Ball" : round.game_mode
                    }</span>
                  )}
                </div>
                {round.course_description && (
                  <p className="text-xs text-dark/50 mt-2 leading-relaxed">{round.course_description}</p>
                )}
                {round.course_id && (
                  <motion.button
                    onClick={(e) => { e.stopPropagation(); setSelectedCourse(round.course_id); }}
                    className="mt-2 text-[11px] font-bold text-dark/50 underline underline-offset-2"
                    whileTap={{ scale: 0.95 }}
                  >
                    Platz-Details & Abschlaege →
                  </motion.button>
                )}
              </div>
              <div className="text-right">
                {round.players_scored > 0 ? (
                  <span className="pill bg-accent-mint">{round.players_scored} Spieler</span>
                ) : (
                  <span className="pill bg-white text-dark/40">Offen</span>
                )}
              </div>
            </div>
            {round.notes && (
              <p className="text-xs text-dark/40 mt-3 leading-relaxed border-t-2 border-dark/10 pt-2 font-medium">
                {round.notes}
              </p>
            )}
          </motion.button>
        </StaggerItem>
      ))}

      {needsHandicap && golfData?.rounds?.length > 0 && (
        <StaggerItem>
          <p className="text-center text-xs text-dark/50 font-medium py-2">
            Trage zuerst dein Handicap ein, um Runden zu öffnen.
          </p>
        </StaggerItem>
      )}
    </Stagger>
  );
}

/* ------------------------------------------------------------------ */
/* Scorecard Component                                                 */
/* ------------------------------------------------------------------ */

interface ScorecardProps {
  round: any;
  roundLabel: string;
  holes: any[];
  scores: any[];
  members: any[];
  memberId: string;
  saving: number | null;
  handicap: number | null;
  onSubmitScore: (hole: number, strokes: number) => void;
  onDeleteScore: (hole: number) => void;
  onBack: () => void;
}

function Scorecard({ round, roundLabel, holes, scores, members, memberId, saving, handicap, onSubmitScore, onDeleteScore, onBack }: ScorecardProps) {
  const [viewMode, setViewMode] = useState<"my" | "all">("my");
  const [activeHole, setActiveHole] = useState<number | null>(null);

  const myScores = scores.filter((s: any) => s.member_id === memberId);
  const myScoreMap: Record<number, any> = {};
  myScores.forEach((s: any) => { myScoreMap[s.hole] = s; });

  const myTotalStrokes = myScores.reduce((sum: number, s: any) => sum + s.strokes, 0);
  const myTotalStableford = myScores.reduce((sum: number, s: any) => sum + s.stableford, 0);
  const holesPlayed = myScores.length;

  const handleQuickScore = (hole: number, strokes: number) => {
    onSubmitScore(hole, strokes);
    setActiveHole(null);
  };

  const handleDelete = (hole: number) => {
    onDeleteScore(hole);
    setActiveHole(null);
  };

  const toggleHole = (holeNumber: number) => {
    setActiveHole(activeHole === holeNumber ? null : holeNumber);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  };

  const memberScores: Record<string, { name: string; emoji: string; scores: Record<number, any>; total: number; stableford: number }> = {};
  members.forEach((m: any) => {
    const ms = scores.filter((s: any) => s.member_id === m.id);
    memberScores[m.id] = {
      name: m.display_name,
      emoji: m.avatar_emoji || "👤",
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
      {/* Navigation */}
      <div className="flex items-center gap-3">
        <motion.button
          onClick={onBack}
          className="w-9 h-9 bg-white border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs shrink-0"
          whileTap={{ scale: 0.9 }}
        >
          <IconArrowLeft className="w-4 h-4" />
        </motion.button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-dark/50 font-medium">Golf</span>
          <span className="text-dark/15">/</span>
          <span className="font-bold">{roundLabel} {round.course_name}</span>
        </div>
      </div>

      {/* Round Info Card */}
      <div className="card p-5">
        <p className="font-extrabold text-lg tracking-tight">{round.course_name}</p>
        <p className="text-sm text-dark/50 mt-1 font-medium">
          {formatDate(round.date)} · Tee {round.tee_time?.slice(0, 5)} · Par {round.par_total}
          {handicap != null && <span> · HCP {handicap}</span>}
        </p>
        {round.notes && <p className="text-xs text-dark/40 mt-1.5">{round.notes}</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Löcher", value: `${holesPlayed}/18`, color: "" },
          { label: "Schläge", value: myTotalStrokes || "–", color: "" },
          { label: "Stableford", value: myTotalStableford || "–", color: "text-emerald-600" },
        ].map((stat) => (
          <div key={stat.label} className="card p-3 text-center">
            <p className="text-[10px] text-dark/40 uppercase tracking-wider font-bold">{stat.label}</p>
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
              viewMode === mode ? "bg-dark text-white" : "bg-white text-dark/40"
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
            <div className="grid grid-cols-[40px_1fr_50px_60px_60px] gap-1 text-[10px] text-dark/40 font-bold uppercase tracking-wider px-3 py-2.5 border-b-2 border-dark/10">
              <span>Loch</span>
              <span>Info</span>
              <span className="text-center">Par</span>
              <span className="text-center">Score</span>
              <span className="text-center">Pts</span>
            </div>

            {holes.map((hole: any, i: number) => {
              const score = myScoreMap[hole.hole_number];
              const isCurrentlySaving = saving === hole.hole_number;
              const isActive = activeHole === hole.hole_number;

              // Score range centered on par (par-2 to par+4)
              const par = hole.par;
              const quickScores = Array.from({ length: 8 }, (_, j) => Math.max(1, par - 2) + j);

              return (
                <div key={hole.hole_number}>
                  {/* Hole row */}
                  <motion.div
                    className={`grid grid-cols-[40px_1fr_50px_60px_60px] gap-1 items-center px-3 py-2.5 border-b border-dark/[0.06] cursor-pointer ${
                      isActive ? "bg-gold-400/15" : score ? "" : "bg-gold-400/5"
                    }`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    onClick={() => toggleHole(hole.hole_number)}
                  >
                    <span className={`text-sm font-bold ${isActive ? "text-dark" : "text-dark/40"}`}>{hole.hole_number}</span>
                    <div className="min-w-0">
                      <span className="text-xs text-dark/40 font-medium">{hole.distance_m}m · HCP {hole.handicap_index}</span>
                    </div>
                    <span className="text-center text-sm font-bold text-dark/40">{par}</span>

                    {isCurrentlySaving ? (
                      <>
                        <div className="flex justify-center"><Spinner size={18} /></div>
                        <span className="text-center text-xs text-dark/20">...</span>
                      </>
                    ) : score ? (
                      <>
                        <span className={`text-center text-sm font-bold ${
                          score.strokes < par ? "text-emerald-600" :
                          score.strokes === par ? "text-dark" :
                          score.strokes === par + 1 ? "text-amber-500" :
                          "text-red-500"
                        }`}>
                          {score.strokes}
                        </span>
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
                        <span className="text-center text-sm text-dark/15 font-bold">–</span>
                        <span className="text-center text-sm text-dark/15 font-bold">–</span>
                      </>
                    )}
                  </motion.div>

                  {/* Score picker panel */}
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-b-2 border-gold-400/30"
                      >
                        <div className="px-3 py-3 bg-gold-400/10">
                          {/* Hole info */}
                          <div className="flex items-center gap-2 mb-3 text-xs text-dark/50 font-medium">
                            {hole.name && <span className="font-bold text-dark/70">{hole.name}</span>}
                            <span>{hole.distance_m}m</span>
                            <span>Par {par}</span>
                            <span>HCP {hole.handicap_index}</span>
                          </div>
                          {hole.description && (
                            <p className="text-[12px] text-dark/50 leading-relaxed mb-3">{hole.description}</p>
                          )}

                          {/* Quick score buttons */}
                          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-2">Schläge wählen</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {quickScores.map((strokes) => {
                              const diff = strokes - par;
                              const isSelected = score?.strokes === strokes;
                              const label = diff === -2 ? "Eagle" : diff === -1 ? "Birdie" : diff === 0 ? "Par" : diff === 1 ? "Bogey" : diff === 2 ? "D.Bogey" : `+${diff}`;
                              return (
                                <motion.button
                                  key={strokes}
                                  onClick={() => handleQuickScore(hole.hole_number, strokes)}
                                  className={`flex flex-col items-center justify-center min-w-[44px] h-[52px] rounded-xl border-2 font-bold transition-all ${
                                    isSelected
                                      ? "border-dark bg-dark text-white shadow-brutal-xs"
                                      : diff < 0
                                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : diff === 0
                                      ? "border-dark/20 bg-white text-dark"
                                      : diff === 1
                                      ? "border-amber-300 bg-amber-50 text-amber-700"
                                      : "border-red-300 bg-red-50 text-red-600"
                                  }`}
                                  whileTap={{ scale: 0.9 }}
                                >
                                  <span className="text-base leading-none">{strokes}</span>
                                  <span className="text-[8px] leading-none mt-0.5 opacity-60">{label}</span>
                                </motion.button>
                              );
                            })}
                          </div>

                          {/* Delete button (only if score exists) */}
                          {score && (
                            <motion.button
                              onClick={() => handleDelete(hole.hole_number)}
                              className="mt-3 text-[11px] text-red-500 font-bold flex items-center gap-1"
                              whileTap={{ scale: 0.95 }}
                            >
                              🗑 Score löschen
                            </motion.button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
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
                    <p className="text-[10px] text-dark/40 uppercase tracking-wider font-bold">{half.label}</p>
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
              <p className="text-sm text-dark/40 text-center py-8 font-medium">Noch keine Scores eingetragen</p>
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
                      <span className={`w-7 h-7 flex items-center justify-center text-xs rounded-lg border-2 border-dark ${
                        i === 0 ? "bg-gold-400" :
                        i === 1 ? "bg-gray-200" :
                        i === 2 ? "bg-orange-200" :
                        "bg-white"
                      }`}>
                        {data.emoji}
                      </span>
                      <span className="font-bold text-sm tracking-tight">{data.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-dark/40 font-medium">{data.total} Schläge</span>
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

/* ------------------------------------------------------------------ */
/* Course Detail Component                                             */
/* ------------------------------------------------------------------ */

interface CourseDetailProps {
  courseId: string;
  onBack: () => void;
}

function CourseDetailView({ courseId, onBack }: CourseDetailProps) {
  const [course, setCourse] = useState<any>(null);
  const [holes, setHoles] = useState<any[]>([]);
  const [tees, setTees] = useState<any[]>([]);
  const [selectedTee, setSelectedTee] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getCourseDetail(courseId).then((d) => {
        setCourse(d.course);
        setHoles(d.holes || []);
      }),
      getCourseTees(courseId).then((d) => setTees(d.tees || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [courseId]);

  // Reload holes when tee changes
  useEffect(() => {
    if (!selectedTee) return;
    getCourseHoles(courseId, selectedTee).then((d) => setHoles(d.holes || [])).catch(() => {});
  }, [selectedTee, courseId]);

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner /></div>;
  }

  if (!course) {
    return (
      <div className="text-center py-20">
        <p className="text-dark/40 font-medium">Platz nicht gefunden</p>
        <motion.button onClick={onBack} className="btn-dark mt-4 px-6 py-2 text-sm" whileTap={{ scale: 0.95 }}>Zurueck</motion.button>
      </div>
    );
  }

  const TEE_COLORS: Record<string, string> = {
    black: "bg-gray-900 text-white",
    blue: "bg-blue-600 text-white",
    white: "bg-white text-dark border-2 border-dark/20",
    yellow: "bg-yellow-400 text-dark",
    red: "bg-red-500 text-white",
    orange: "bg-orange-400 text-dark",
    green: "bg-green-500 text-white",
  };

  const front9 = holes.filter((h: any) => h.hole_number <= 9);
  const back9 = holes.filter((h: any) => h.hole_number > 9);
  const totalPar = holes.reduce((sum: number, h: any) => sum + (h.par || 0), 0);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Back button */}
      <div className="flex items-center gap-3">
        <motion.button
          onClick={onBack}
          className="w-9 h-9 bg-white border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs shrink-0"
          whileTap={{ scale: 0.9 }}
        >
          <IconArrowLeft className="w-4 h-4" />
        </motion.button>
        <div className="text-sm">
          <span className="text-dark/50 font-medium">Golf</span>
          <span className="text-dark/15 mx-1">/</span>
          <span className="font-bold">{course.name}</span>
        </div>
      </div>

      {/* Course Header Card */}
      <div className="card p-5">
        {course.image_url && (
          <img src={course.image_url} alt={course.name} className="w-full h-40 object-cover rounded-xl border-2 border-dark/10 mb-4" />
        )}
        <h2 className="text-xl font-extrabold tracking-tight">{course.name}</h2>
        <p className="text-sm text-dark/50 font-medium mt-1">
          {[course.location, course.country].filter(Boolean).join(", ")}
        </p>

        {/* Course Stats */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { label: "Par", value: totalPar || course.par_total || "–" },
            { label: "Loecher", value: course.total_holes || 18 },
            { label: "CR", value: course.course_rating?.toFixed(1) || "–" },
            { label: "Slope", value: course.slope_rating || "–" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-0 border-2 border-dark/10 rounded-xl p-2.5 text-center">
              <p className="text-[9px] text-dark/40 uppercase tracking-wider font-bold">{s.label}</p>
              <p className="text-lg font-extrabold mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {course.website && (
          <a href={course.website} target="_blank" rel="noopener noreferrer" className="block mt-3 text-xs text-dark/40 font-medium underline underline-offset-2">
            {course.website.replace(/^https?:\/\//, "")}
          </a>
        )}

        {course.description && (
          <p className="text-xs text-dark/50 mt-3 leading-relaxed">{course.description}</p>
        )}
      </div>

      {/* Tee Selection */}
      {tees.length > 0 && (
        <div className="card p-4">
          <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider mb-3">Abschlaege waehlen</p>
          <div className="flex flex-wrap gap-2">
            <motion.button
              onClick={() => setSelectedTee(null)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                !selectedTee ? "border-dark bg-dark text-white shadow-brutal-xs" : "border-dark/20 bg-white text-dark/60"
              }`}
              whileTap={{ scale: 0.95 }}
            >
              Standard
            </motion.button>
            {tees.map((tee: any) => (
              <motion.button
                key={tee.id}
                onClick={() => setSelectedTee(tee.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                  selectedTee === tee.id ? "border-dark bg-dark text-white shadow-brutal-xs" : "border-dark/20 bg-white text-dark/60"
                }`}
                whileTap={{ scale: 0.95 }}
              >
                <span className={`w-3.5 h-3.5 rounded-full ${TEE_COLORS[tee.color?.toLowerCase()] || "bg-gray-300"}`} />
                {tee.name}
                {tee.length_meters && <span className="text-[10px] opacity-50">{tee.length_meters}m</span>}
              </motion.button>
            ))}
          </div>

          {/* Selected tee info */}
          {selectedTee && (() => {
            const tee = tees.find((t: any) => t.id === selectedTee);
            if (!tee) return null;
            return (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: "CR", value: tee.course_rating?.toFixed(1) || "–" },
                  { label: "Slope", value: tee.slope_rating || "–" },
                  { label: "Laenge", value: tee.length_meters ? `${tee.length_meters}m` : "–" },
                ].map((s) => (
                  <div key={s.label} className="bg-surface-0 border border-dark/10 rounded-lg p-2 text-center">
                    <p className="text-[9px] text-dark/40 uppercase tracking-wider font-bold">{s.label}</p>
                    <p className="text-sm font-extrabold">{s.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Hole-by-Hole Table */}
      {holes.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-dark/10">
            <p className="text-[10px] font-bold text-dark/40 uppercase tracking-wider">Loch-Details</p>
          </div>

          {/* Header */}
          <div className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 text-[10px] text-dark/40 font-bold uppercase tracking-wider px-3 py-2 border-b border-dark/[0.06]">
            <span>Loch</span>
            <span>Name</span>
            <span className="text-center">Par</span>
            <span className="text-center">Dist.</span>
            <span className="text-center">HCP</span>
          </div>

          {/* Front 9 */}
          {front9.map((hole: any, i: number) => (
            <motion.div
              key={hole.hole_number}
              className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 items-center px-3 py-2.5 border-b border-dark/[0.06]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
            >
              <span className="text-sm font-bold text-dark/60">{hole.hole_number}</span>
              <span className="text-xs text-dark/50 font-medium truncate">{hole.name || "–"}</span>
              <span className="text-center text-sm font-bold">{hole.par}</span>
              <span className="text-center text-xs font-medium text-dark/50">
                {hole.tee_distance_m || hole.distance_m || "–"}m
              </span>
              <span className="text-center text-xs font-medium text-dark/40">{hole.handicap_index}</span>
            </motion.div>
          ))}

          {/* Front 9 total */}
          {front9.length > 0 && (
            <div className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 items-center px-3 py-2 bg-dark/5 border-b-2 border-dark/10 text-xs font-bold">
              <span></span>
              <span className="text-dark/40">Front 9</span>
              <span className="text-center">{front9.reduce((s: number, h: any) => s + (h.par || 0), 0)}</span>
              <span className="text-center text-dark/50">{front9.reduce((s: number, h: any) => s + (h.tee_distance_m || h.distance_m || 0), 0)}m</span>
              <span></span>
            </div>
          )}

          {/* Back 9 */}
          {back9.map((hole: any, i: number) => (
            <motion.div
              key={hole.hole_number}
              className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 items-center px-3 py-2.5 border-b border-dark/[0.06]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: (i + 9) * 0.02 }}
            >
              <span className="text-sm font-bold text-dark/60">{hole.hole_number}</span>
              <span className="text-xs text-dark/50 font-medium truncate">{hole.name || "–"}</span>
              <span className="text-center text-sm font-bold">{hole.par}</span>
              <span className="text-center text-xs font-medium text-dark/50">
                {hole.tee_distance_m || hole.distance_m || "–"}m
              </span>
              <span className="text-center text-xs font-medium text-dark/40">{hole.handicap_index}</span>
            </motion.div>
          ))}

          {/* Back 9 total */}
          {back9.length > 0 && (
            <div className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 items-center px-3 py-2 bg-dark/5 border-b-2 border-dark/10 text-xs font-bold">
              <span></span>
              <span className="text-dark/40">Back 9</span>
              <span className="text-center">{back9.reduce((s: number, h: any) => s + (h.par || 0), 0)}</span>
              <span className="text-center text-dark/50">{back9.reduce((s: number, h: any) => s + (h.tee_distance_m || h.distance_m || 0), 0)}m</span>
              <span></span>
            </div>
          )}

          {/* Total */}
          <div className="grid grid-cols-[40px_1fr_50px_60px_50px] gap-1 items-center px-3 py-3 bg-dark text-white text-sm font-bold">
            <span></span>
            <span>Gesamt</span>
            <span className="text-center">{totalPar}</span>
            <span className="text-center text-xs">
              {holes.reduce((s: number, h: any) => s + (h.tee_distance_m || h.distance_m || 0), 0)}m
            </span>
            <span></span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
