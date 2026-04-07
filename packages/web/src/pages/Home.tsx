import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getGolfData, getGroup } from "../lib/api";
import { IconGolf, IconTrophy, IconChat, IconPlane, IconFlag, IconUsers, IconStar } from "../components/Icons";
import { Stagger, StaggerItem } from "../components/Motion";

interface Props {
  auth: {
    member: { id: string; display_name: string };
    group: { id: string; name: string };
    event: { id: string; title: string; date_from: string; date_to: string; location: string };
  };
  onNavigate: (tab: string) => void;
}

export default function Home({ auth, onNavigate }: Props) {
  const [golfData, setGolfData] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    getGolfData(auth.event.id).then(setGolfData).catch(console.error);
    getGroup(auth.group.id).then((g) => setMembers(g.members || [])).catch(console.error);
  }, [auth.event.id, auth.group.id]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("de-CH", { day: "2-digit", month: "long" });
  };

  const now = new Date();
  const nextRound = golfData?.rounds?.find((r: any) => new Date(r.date) >= now) || golfData?.rounds?.[0];
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

      {/* Event Card */}
      <StaggerItem>
        <div className="card p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-10 h-10 bg-accent-mint border-2 border-dark rounded-2xl flex items-center justify-center shadow-brutal-xs">
              <IconGolf className="w-5 h-5 text-dark" />
            </div>
            <span className="pill bg-accent-mint">Golfreise</span>
          </div>
          <h3 className="text-xl font-extrabold tracking-tight leading-tight">{auth.event.title}</h3>
          <p className="text-dark/40 mt-1.5 text-[14px] font-medium">
            {formatDate(auth.event.date_from)} – {formatDate(auth.event.date_to)}
          </p>
          <p className="text-dark/25 text-[13px] mt-0.5">{auth.event.location}</p>
          <div className="mt-4 flex gap-2 flex-wrap">
            <span className="pill bg-gold-400">7 Golfrunden</span>
            <span className="pill bg-accent-mint">{members.length} Spieler</span>
            <span className="pill bg-white">Stableford</span>
          </div>
        </div>
      </StaggerItem>

      {/* Quick Actions */}
      <StaggerItem>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "golf", Icon: IconGolf, label: "Golf", sub: "Scores eintragen", cls: "card-lavender" },
            { id: "ranking", Icon: IconTrophy, label: "Ranking", sub: "Wer führt?", cls: "card-gold" },
            { id: "chat", Icon: IconChat, label: "Chat", sub: "Nachrichten", cls: "card-mint" },
            { id: "more", Icon: IconPlane, label: "Flüge", sub: "Alle Flugdaten", cls: "card-pink" },
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

      {/* Next Round */}
      {nextRound && (
        <StaggerItem>
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs">
                <IconFlag className="w-4.5 h-4.5 text-dark" />
              </div>
              <span className="pill bg-gold-400">Nächste Runde</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-extrabold text-lg tracking-tight">{nextRound.course_name}</p>
                <p className="text-sm text-dark/30 mt-1 font-medium">
                  {formatDate(nextRound.date)} · Tee {nextRound.tee_time?.slice(0, 5)}
                </p>
              </div>
              <motion.button
                onClick={() => onNavigate("golf")}
                className="btn-gold px-5 py-2.5 text-xs uppercase tracking-wider"
                whileTap={{ scale: 0.95 }}
              >
                Spielen
              </motion.button>
            </div>
          </div>
        </StaggerItem>
      )}

      {/* Leaderboard Preview */}
      {golfData?.leaderboard && golfData.leaderboard.length > 0 && (
        <StaggerItem>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center shadow-brutal-xs">
                  <IconTrophy className="w-4.5 h-4.5 text-dark" />
                </div>
                <span className="pill bg-gold-400">Leaderboard</span>
              </div>
              <button
                onClick={() => onNavigate("ranking")}
                className="text-[11px] font-bold text-dark/25 hover:text-dark/50 transition-colors"
              >
                Alle →
              </button>
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
          </div>
        </StaggerItem>
      )}

      {/* Masters Pool */}
      <StaggerItem>
        <div className="card-mint p-6">
          <div className="flex items-center gap-2 mb-2">
            <IconStar className="w-4 h-4" />
            <p className="font-extrabold tracking-tight text-[15px]">Masters Pool 2026</p>
          </div>
          <p className="text-[12px] opacity-50 font-medium mb-5">
            Einsatz 20 CHF · 1. Platz 50% · 2. Platz 30% · 3. Platz 20%
          </p>
          <div className="flex gap-2">
            <a
              href="http://www.easyofficepools.com/join/?p=464087&e=wlld"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-dark text-[11px] uppercase tracking-wider px-4 py-2.5"
            >
              Team wählen →
            </a>
            <a
              href="http://www.easyofficepools.com/leaderboard/?p=464087"
              target="_blank"
              rel="noopener noreferrer"
              className="pill bg-white text-[11px] uppercase tracking-wider px-4 py-2"
            >
              Leaderboard
            </a>
          </div>
        </div>
      </StaggerItem>

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
