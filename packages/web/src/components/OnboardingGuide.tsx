import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconGolf, IconTrophy, IconChat, IconCamera, IconMapPin, IconPlane } from "./Icons";

interface Props {
  memberName: string;
  onDone: () => void;
}

const STEPS = [
  {
    id: "welcome",
    badge: "Willkommen",
    title: "Deine CREW App",
    description: "Alles was du für die Golfreise brauchst — in einer App. Hier ein kurzer Überblick.",
    icon: null,
    illustration: (
      <div className="flex items-center justify-center">
        <div className="bg-accent-mint border-2 border-dark px-8 py-3 rounded-full shadow-brutal">
          <span className="text-3xl font-extrabold tracking-tight">CREW</span>
        </div>
      </div>
    ),
  },
  {
    id: "golf",
    badge: "Golf",
    title: "Scores eintragen",
    description: "Tippe auf ein Loch, um deinen Score einzugeben. Stableford-Punkte werden automatisch berechnet — auch mit Handicap.",
    icon: IconGolf,
    color: "bg-accent-mint",
  },
  {
    id: "ranking",
    badge: "Ranking",
    title: "Live Leaderboard",
    description: "Sieh in Echtzeit, wer gerade vorne liegt. Das Ranking aktualisiert sich automatisch nach jeder Runde.",
    icon: IconTrophy,
    color: "bg-gold-400",
  },
  {
    id: "features",
    badge: "Features",
    title: "Chat, Fotos & mehr",
    description: "Gruppen-Chat, Foto-Album, Fluginfos, Standort-Sharing und euer Masters-Pool — alles dabei.",
    icon: null,
    illustration: (
      <div className="flex items-center justify-center gap-3">
        {[
          { Icon: IconChat, cls: "bg-accent-mint" },
          { Icon: IconCamera, cls: "bg-gold-400" },
          { Icon: IconPlane, cls: "bg-[#f5d0e0]" },
          { Icon: IconMapPin, cls: "bg-[#d5d0f5]" },
        ].map(({ Icon, cls }, i) => (
          <motion.div
            key={i}
            className={`w-14 h-14 ${cls} border-2 border-dark rounded-2xl flex items-center justify-center shadow-brutal-xs`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
          >
            <Icon className="w-6 h-6 text-dark" />
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    id: "install",
    badge: "App installieren",
    title: "Zum Homescreen hinzufügen",
    description: "Installiere CREW als App auf deinem Handy für den vollen Effekt — Push-Benachrichtigungen und Offline-Zugriff inklusive.",
    icon: null,
    illustration: (
      <div className="space-y-3">
        <div className="card p-3.5 flex items-center gap-3 text-left">
          <div className="w-10 h-10 bg-blue-100 border-2 border-dark rounded-xl flex items-center justify-center text-lg shrink-0">
            🤖
          </div>
          <div>
            <p className="text-[11px] font-bold text-dark/50 uppercase tracking-wider">Android / Chrome</p>
            <p className="text-xs font-medium text-dark/70 mt-0.5">
              Tippe auf <span className="font-bold">⋮</span> → <span className="font-bold">"App installieren"</span>
            </p>
          </div>
        </div>
        <div className="card p-3.5 flex items-center gap-3 text-left">
          <div className="w-10 h-10 bg-gray-100 border-2 border-dark rounded-xl flex items-center justify-center text-lg shrink-0">
            🍎
          </div>
          <div>
            <p className="text-[11px] font-bold text-dark/50 uppercase tracking-wider">iPhone / Safari</p>
            <p className="text-xs font-medium text-dark/70 mt-0.5">
              Tippe auf{" "}
              <svg className="w-3.5 h-3.5 inline align-text-bottom" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 3h-2v7h-2V5H9l3-3zm-7 9v10h14V11h-2v8H7v-8H5z"/></svg>
              {" "}→ <span className="font-bold">"Zum Home-Bildschirm"</span>
            </p>
          </div>
        </div>
      </div>
    ),
  },
];

export default function OnboardingGuide({ memberName, onDone }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const firstName = memberName.split(" ")[0];

  const next = () => {
    if (isLast) {
      localStorage.setItem("crew_onboarding_done", "1");
      onDone();
    } else {
      setStep(step + 1);
    }
  };

  const skip = () => {
    localStorage.setItem("crew_onboarding_done", "1");
    onDone();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[10000] bg-surface-0 bg-grid flex flex-col safe-top safe-bottom"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Skip button */}
      <div className="flex justify-end px-5 pt-4">
        <button
          onClick={skip}
          className="text-[11px] font-bold text-dark/30 uppercase tracking-wider hover:text-dark/50 transition-colors px-3 py-2"
        >
          Überspringen
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 max-w-sm mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            className="w-full text-center space-y-6"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: [0.16, 0.84, 0.44, 1] }}
          >
            {/* Illustration / Icon */}
            <div className="mb-2">
              {current.illustration ? (
                current.illustration
              ) : current.icon ? (
                <div className="flex items-center justify-center">
                  <div className={`w-20 h-20 ${current.color || "bg-accent-mint"} border-2 border-dark rounded-3xl flex items-center justify-center shadow-brutal`}>
                    <current.icon className="w-10 h-10 text-dark" />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Badge */}
            <div>
              <span className="inline-block bg-accent-mint border-2 border-dark px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {current.badge}
              </span>
            </div>

            {/* Title */}
            <h2 className="text-3xl font-extrabold tracking-tight leading-tight">
              {step === 0 ? (
                <>Hey {firstName}<span className="text-gold-400">!</span></>
              ) : (
                <>{current.title}<span className="text-gold-400">.</span></>
              )}
            </h2>

            {/* Description */}
            <p className="text-dark/50 font-medium text-[15px] leading-relaxed">
              {current.description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom: progress + button */}
      <div className="px-8 pb-8 max-w-sm mx-auto w-full space-y-5">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((_, i) => (
            <motion.div
              key={i}
              className={`h-[4px] rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-dark"
                  : i < step
                  ? "w-4 bg-dark/20"
                  : "w-4 bg-dark/10"
              }`}
              layout
            />
          ))}
        </div>

        {/* Action button */}
        <motion.button
          onClick={next}
          className="w-full btn-gold py-4 uppercase tracking-wider text-sm"
          whileTap={{ scale: 0.98 }}
        >
          {isLast ? "Los geht's!" : "Weiter"}
        </motion.button>
      </div>
    </motion.div>
  );
}
