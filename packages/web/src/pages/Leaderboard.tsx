import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { getGolfData } from "../lib/api";
import { IconCrown, IconTrophy } from "../components/Icons";
import { Stagger, StaggerItem, Spinner } from "../components/Motion";
import Emoji from "../components/Emoji";

interface Props {
  auth: {
    member: { id: string };
    event: { id: string };
  };
}

export default function Leaderboard({ auth }: Props) {
  const [data, setData] = useState<any>(null);
  const [allRounds, setAllRounds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

  // Fetch all rounds once for course list
  useEffect(() => {
    getGolfData(auth.event.id)
      .then((d) => {
        setData(d);
        setAllRounds(d?.rounds || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [auth.event.id]);

  // Re-fetch when course filter changes
  useEffect(() => {
    if (selectedCourse === null) return; // initial load already done
    setLoading(true);
    getGolfData(auth.event.id, selectedCourse)
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [auth.event.id, selectedCourse]);

  // Reset to full ranking
  const handleSelectGesamt = () => {
    if (selectedCourse === null) return;
    setSelectedCourse(null);
    setLoading(true);
    getGolfData(auth.event.id)
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allRounds) {
      if (r.course_id && r.course_name && !seen.has(r.course_id)) {
        seen.set(r.course_id, r.course_name);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [allRounds]);

  const leaderboard = data?.leaderboard || [];
  const rounds = data?.rounds || [];

  const displayLabel = selectedCourse
    ? courses.find((c) => c.id === selectedCourse)?.name || "Platz"
    : "Gesamtwertung";

  const displayRounds = selectedCourse
    ? rounds.filter((r: any) => r.course_id === selectedCourse).length
    : rounds.length;

  return (
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
            Stableford · {displayRounds} {displayRounds === 1 ? "Runde" : "Runden"}
          </p>
        </div>
      </StaggerItem>

      {/* Course filter tabs */}
      {courses.length > 1 && (
        <StaggerItem>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={handleSelectGesamt}
              className={`pill whitespace-nowrap shrink-0 transition-colors ${
                selectedCourse === null ? "bg-gold-400" : "bg-white"
              }`}
            >
              Gesamt
            </button>
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => setSelectedCourse(course.id)}
                className={`pill whitespace-nowrap shrink-0 transition-colors ${
                  selectedCourse === course.id ? "bg-gold-400" : "bg-white"
                }`}
              >
                {course.name}
              </button>
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
                <motion.div
                  key={player.member_id}
                  className={`grid grid-cols-[36px_1fr_60px_60px_50px] gap-1 items-center px-4 py-3.5 border-b border-dark/[0.06] ${
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
                </motion.div>
              ))}
            </div>
          </StaggerItem>

          {/* Round breakdown */}
          {rounds.length > 0 && (
            <StaggerItem>
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center">
                    <IconTrophy className="w-3.5 h-3.5 text-dark" />
                  </div>
                  <span className="pill bg-gold-400">Runden-Uebersicht</span>
                </div>
                <div className="space-y-3">
                  {rounds.map((r: any, i: number) => (
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
  );
}
