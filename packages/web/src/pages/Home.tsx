import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useAuth } from "../contexts/AuthContext";
import { useEvent } from "../contexts/EventContext";
import { getGolfData, getGroup, getRoundTeams } from "../lib/api";
import { IconGolf, IconTrophy, IconChat, IconPlane, IconFlag, IconUsers, IconStar, IconMapPin } from "../components/Icons";
import { Stagger, StaggerItem } from "../components/Motion";

export default function Home() {
  const { auth } = useAuth();
  const { modules } = useEvent();
  const navigate = useNavigate();
  const { eventId } = useParams({ from: "/events/$eventId" });
  const [golfData, setGolfData] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [roundFlights, setRoundFlights] = useState<Record<string, any[]>>({});

  const onNavigate = (tab: string) => {
    if (tab === "tracker") {
      window.dispatchEvent(new CustomEvent("open-tracker"));
      return;
    }
    navigate({ to: `/events/${eventId}/${tab === "home" ? "" : tab}` });
  };

  const loadFlights = (rounds: any[]) => {
    rounds?.forEach((r: any) => {
      getRoundTeams(r.id).then((t) => {
        setRoundFlights((prev) => ({ ...prev, [r.id]: t.teams || [] }));
      }).catch(() => {});
    });
  };

  useEffect(() => {
    if (!auth) return;
    getGolfData(auth.event.id).then((data) => {
      setGolfData(data);
      loadFlights(data?.rounds || []);
    }).catch(console.error);
    getGroup(auth.group.id).then((g) => setMembers(g.members || [])).catch(console.error);
  }, [auth?.event?.id, auth?.group?.id]);

  // Reload flights when they're updated from the FlightEditor
  useEffect(() => {
    const handler = () => {
      if (golfData?.rounds) loadFlights(golfData.rounds);
    };
    window.addEventListener("flights-updated", handler);
    return () => window.removeEventListener("flights-updated", handler);
  }, [golfData?.rounds]);

  if (!auth) return null;

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
  };

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  // Find the next upcoming round — compare date+tee_time, consider round finished after 5h
  const sortedRounds = [...(golfData?.rounds || [])].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const getRoundEndTime = (r: any) => {
    const [h = 0, m = 0] = (r.tee_time || "12:00").split(":").map(Number);
    const d = new Date(r.date);
    d.setHours(h + 5, m); // tee time + 5h estimated play time
    return d;
  };
  const nextRound = sortedRounds.find((r: any) => getRoundEndTime(r) > now) || sortedRounds[sortedRounds.length - 1];
  const firstName = auth.member.display_name.split(" ")[0];

  return (
    <Stagger className="space-y-5">
      {/* Hero */}
      <StaggerItem>
        <div className="pt-2 pb-2">
          <div className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3">
            Willkommen zurück
          </div>
          <h2 className="text-5xl font-extrabold tracking-tight leading-[1.05]">
            Hey {firstName}<span className="text-gold-400">.</span>
          </h2>
        </div>
      </StaggerItem>

      {/* Next Round — TOP PRIORITY */}
      {nextRound && (
        <StaggerItem>
          <div className="card-gold overflow-hidden">
            {/* Course info — tappable to scorecard */}
            <motion.button
              onClick={() => navigate({ to: `/events/${eventId}/golf/${nextRound.id}` })}
              className="w-full p-5 pb-4 text-left"
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-dark border-2 border-dark rounded-xl flex items-center justify-center">
                  <IconFlag className="w-4 h-4 text-gold-400" />
                </div>
                <span className="pill bg-dark text-white">
                  {nextRound.date === todayStr ? "Heute" : nextRound.date === new Date(now.getTime() + 86400000).toISOString().split("T")[0] ? "Morgen" : formatDate(nextRound.date)}
                </span>
                {nextRound.game_mode && nextRound.game_mode !== "individual" && (
                  <span className="pill bg-white/70">{
                    nextRound.game_mode === "4v4" ? "4 vs 4" :
                    nextRound.game_mode === "2v2" ? "2 vs 2" :
                    nextRound.game_mode === "scramble" ? "Scramble" :
                    nextRound.game_mode === "best_ball" ? "Best Ball" : nextRound.game_mode
                  }</span>
                )}
              </div>
              <p className="font-extrabold text-xl tracking-tight">{nextRound.course_name}</p>
              <p className="text-dark/50 mt-1 font-medium text-sm">
                Tee-Time {nextRound.tee_time?.slice(0, 5)} · Par {nextRound.par_total} · Stableford
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-bold text-dark/40">{nextRound.players_scored > 0 ? `${nextRound.players_scored} Scores` : ""}</span>
                <span className="text-xs font-extrabold uppercase tracking-wider">Scorecard →</span>
              </div>
            </motion.button>

            {/* Flights section — separated visually */}
            <div className="border-t-2 border-dark/10 bg-white/30 px-5 py-4">
              {roundFlights[nextRound.id]?.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-extrabold text-dark/40 uppercase tracking-wider">Flights</span>
                      <span className="text-[10px] font-bold text-dark/20">{roundFlights[nextRound.id].length} Gruppen</span>
                    </div>
                    <motion.button
                      onClick={() => window.dispatchEvent(new CustomEvent("open-flight-editor", { detail: { roundId: nextRound.id } }))}
                      className="flex items-center gap-1 bg-dark text-white rounded-lg px-3 py-1.5 text-[10px] font-extrabold"
                      whileTap={{ scale: 0.95 }}
                    >
                      ✎ Bearbeiten
                    </motion.button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {roundFlights[nextRound.id].map((f: any, i: number) => (
                      <div key={i} className="bg-white border-2 border-dark/8 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="w-5 h-5 bg-gold-400 border border-dark/20 rounded-md flex items-center justify-center text-[8px] font-extrabold">
                            {i + 1}
                          </span>
                          <span className="text-[10px] font-extrabold text-dark/50 uppercase tracking-wider">
                            {f.name || `Flight ${i + 1}`}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {(f.members || []).slice(0, 4).map((m: any, mi: number) => (
                            <div key={mi} className="flex items-center gap-1.5">
                              <span className="text-xs">{m.avatar_emoji || "👤"}</span>
                              <span className="text-[11px] font-bold text-dark/70 leading-tight">{(m.display_name || "").split(" ")[0]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <motion.button
                  onClick={() => window.dispatchEvent(new CustomEvent("open-flight-editor", { detail: { roundId: nextRound.id } }))}
                  className="w-full flex items-center justify-center gap-2.5 py-3"
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="w-7 h-7 bg-gold-400 border-2 border-dark rounded-lg flex items-center justify-center text-dark text-xs font-extrabold">+</span>
                  <span className="text-[13px] font-extrabold text-dark/60">Flights einteilen</span>
                </motion.button>
              )}
            </div>
          </div>
        </StaggerItem>
      )}

      {/* Leaderboard Snapshot — SECOND */}
      {golfData?.leaderboard && golfData.leaderboard.length > 0 && (
        <StaggerItem>
          <motion.button
            onClick={() => onNavigate("ranking")}
            className="w-full card p-6 text-left"
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs">
                  <IconTrophy className="w-4.5 h-4.5 text-dark" />
                </div>
                <span className="pill bg-gold-400">Leaderboard</span>
              </div>
              <span className="text-[11px] font-bold text-dark/25">
                Alle →
              </span>
            </div>
            <div className="space-y-3">
              {golfData.leaderboard.slice(0, 5).map((p: any, i: number) => (
                <motion.div
                  key={p.member_id}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.4 }}
                >
                  <span className={`w-8 h-8 flex items-center justify-center text-xs font-extrabold rounded-lg border-2 border-dark shadow-brutal-xs ${
                    i === 0 ? "bg-gold-400" :
                    i === 1 ? "bg-gray-200" :
                    i === 2 ? "bg-orange-200" :
                    "bg-white"
                  }`}>
                    {i + 1}
                  </span>
                  <span className="flex-1 font-bold text-sm">
                    {p.avatar_emoji} {p.display_name}
                  </span>
                  <span className="text-dark/30 text-xs font-bold tabular-nums">
                    {p.total_points} Pts
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.button>
        </StaggerItem>
      )}

      {/* Live Tracker */}
      <StaggerItem>
        <motion.button
          onClick={() => onNavigate("tracker")}
          className="w-full card-mint p-5 text-left"
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-dark border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs shrink-0">
              <IconMapPin className="w-5 h-5 text-accent-mint" />
            </div>
            <div className="flex-1">
              <p className="font-extrabold text-[16px] tracking-tight">Live Tracker</p>
              <p className="text-[11px] text-dark/50 mt-0.5 font-medium">Wo ist die Crew gerade?</p>
            </div>
            <span className="text-xs font-extrabold text-dark/25 uppercase tracking-wider">Map →</span>
          </div>
        </motion.button>
      </StaggerItem>

      {/* Quick Actions */}
      <StaggerItem>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "golf", Icon: IconGolf, label: "Golfplätze", sub: "Alle Plätze", cls: "card-lavender" },
            { id: "ranking", Icon: IconTrophy, label: "Ranking", sub: "Wer fuehrt?", cls: "card-gold" },
            { id: "chat", Icon: IconChat, label: "Chat", sub: "Nachrichten", cls: "card-mint" },
            { id: "more", Icon: IconPlane, label: "Fluege", sub: "Alle Flugdaten", cls: "card-pink" },
          ].map((action, i) => (
            <motion.button
              key={action.id}
              onClick={() => onNavigate(action.id)}
              className={`${action.cls} p-5 text-left`}
              whileTap={{ scale: 0.96 }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06, duration: 0.5, ease: [0.16, 0.84, 0.44, 1] }}
            >
              <action.Icon className="w-9 h-9 mb-3 text-dark" />
              <p className="font-extrabold text-[16px] tracking-tight">{action.label}</p>
              <p className="text-[11px] text-dark/50 mt-0.5 font-medium">{action.sub}</p>
            </motion.button>
          ))}
        </div>
      </StaggerItem>

      {/* Event Info */}
      <StaggerItem>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <IconGolf className="w-4 h-4 text-dark/25" />
            <span className="text-[10px] font-bold text-dark/30 uppercase tracking-wider">{auth.event.title}</span>
          </div>
          <p className="text-sm text-dark/40 font-medium">
            {formatDate(auth.event.date_from)} – {formatDate(auth.event.date_to)} · {auth.event.location}
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <span className="pill bg-gold-400">{sortedRounds.length} Runden</span>
            <span className="pill bg-accent-mint">{members.length} Spieler</span>
          </div>
        </div>
      </StaggerItem>

      {/* Masters Pool — driven by event module config */}
      {(() => {
        const poolModule = modules.find((m) => m.type === "masters_pool");
        if (!poolModule?.config?.url) return null;
        const cfg = poolModule.config;
        const prizes = cfg.prizes || {};
        return (
          <StaggerItem>
            <div className="card-mint p-6">
              <div className="flex items-center gap-2 mb-2">
                <IconStar className="w-4 h-4" />
                <p className="font-extrabold tracking-tight text-[15px]">Masters Pool</p>
              </div>
              {cfg.buy_in && (
                <p className="text-[12px] opacity-50 font-medium mb-5">
                  Einsatz {cfg.buy_in}
                  {prizes.first && <> · 1. Platz {prizes.first}</>}
                  {prizes.second && <> · 2. Platz {prizes.second}</>}
                  {prizes.third && <> · 3. Platz {prizes.third}</>}
                </p>
              )}
              <div className="flex gap-2">
                <a href={cfg.url} target="_blank" rel="noopener noreferrer"
                  className="btn-dark text-[11px] uppercase tracking-wider px-4 py-2.5">
                  Team wählen →
                </a>
                {cfg.leaderboard_url && (
                  <a href={cfg.leaderboard_url} target="_blank" rel="noopener noreferrer"
                    className="pill bg-white text-[11px] uppercase tracking-wider px-4 py-2">
                    Leaderboard
                  </a>
                )}
              </div>
            </div>
          </StaggerItem>
        );
      })()}


      {/* Participants */}
      <StaggerItem>
        <div className="pb-4">
          <div className="flex items-center gap-2 mb-4">
            <IconUsers className="w-4 h-4 text-dark/25" />
            <p className="text-[11px] font-bold text-dark/25 uppercase tracking-[0.12em]">
              Teilnehmer ({members.length})
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((m: any) => (
              <span
                key={m.id}
                className={`text-xs px-3 py-1.5 font-bold rounded-full border-2 ${
                  m.id === auth.member.id
                    ? "border-dark bg-gold-400"
                    : "border-dark/15 bg-white"
                }`}
              >
                {m.avatar_emoji} {m.display_name.split(" ")[0]}
              </span>
            ))}
          </div>
        </div>
      </StaggerItem>
    </Stagger>
  );
}
