import { useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Intersection Observer hook for scroll-reveal                       */
/* ------------------------------------------------------------------ */
function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

/* ------------------------------------------------------------------ */
/*  Navbar                                                             */
/* ------------------------------------------------------------------ */
function Navbar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 glass-strong">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
        <a href="#" className="text-2xl font-extrabold tracking-tight">
          <span className="text-white">Crew</span>
          <span className="text-accent-500">.</span>
        </a>
        <div className="hidden md:flex items-center gap-8 text-sm text-slate-300">
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#modules" className="hover:text-white transition">Module</a>
          <a href="#how" className="hover:text-white transition">So geht's</a>
          <a href="#b2b" className="hover:text-white transition">Für Veranstalter</a>
        </div>
        <a
          href="#cta"
          className="hidden sm:inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold px-5 py-2.5 rounded-full transition"
        >
          Zugang anfragen
        </a>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */
function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Animated grid */}
      <div className="absolute inset-0 bg-grid opacity-60" />
      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-electric-500/10 blur-[160px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
        {/* Copy */}
        <div className="text-center lg:text-left">
          <p className="animate-fade-in-up inline-block text-xs font-semibold tracking-widest uppercase text-electric-400 mb-4 px-3 py-1 rounded-full border border-electric-500/30 bg-electric-500/10">
            Aktuell in geschlossener Beta
          </p>
          <h1 className="animate-fade-in-up text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.08] tracking-tight">
            Deine Gruppe.
            <br />
            <span className="text-gradient">Dein Trip.</span>
            <br />
            Deine App.
          </h1>
          <p className="animate-fade-in-up-delay-1 mt-6 text-lg sm:text-xl text-slate-400 max-w-xl mx-auto lg:mx-0 leading-relaxed">
            Crew ersetzt WhatsApp-Chaos und endlose E-Mail-Threads. Eine App
            für alles&nbsp;&mdash; von der Planung bis zum Recap.
          </p>
          <div className="animate-fade-in-up-delay-2 mt-10 flex flex-wrap gap-4 justify-center lg:justify-start">
            <a
              href="#cta"
              className="pulse-cta inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white font-bold px-8 py-4 rounded-full text-lg transition"
            >
              Trip starten
              <span aria-hidden="true">&#8594;</span>
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 border border-slate-600 hover:border-electric-500 text-white font-semibold px-8 py-4 rounded-full text-lg transition"
            >
              Demo ansehen
            </a>
          </div>
        </div>

        {/* App mockup */}
        <div className="animate-fade-in-up-delay-2 relative mx-auto w-full max-w-sm">
          {/* Phone frame */}
          <div className="relative glass rounded-[2.5rem] p-4 glow-blue">
            {/* Status bar */}
            <div className="flex items-center justify-between px-4 pt-2 pb-3 text-[11px] text-slate-400">
              <span>9:41</span>
              <div className="w-24 h-5 bg-black rounded-full" />
              <span className="flex gap-1">
                <span>●●●</span>
              </span>
            </div>
            {/* Screen content */}
            <div className="space-y-3 px-1 pb-4">
              {/* Header card */}
              <div className="bg-gradient-to-br from-electric-500/20 to-accent-500/10 rounded-2xl p-4 border border-electric-500/20">
                <p className="text-xs text-electric-400 font-semibold uppercase tracking-wider">Nächster Trip</p>
                <p className="text-lg font-bold mt-1">Golftrip Belek</p>
                <p className="text-sm text-slate-400 mt-0.5">12 Teilnehmer &middot; 14.&ndash;18. Mai</p>
                <div className="mt-3 flex gap-2">
                  <span className="px-2 py-0.5 bg-electric-500/20 text-electric-400 text-[11px] font-semibold rounded-full">Golf ⛳</span>
                  <span className="px-2 py-0.5 bg-accent-500/20 text-accent-400 text-[11px] font-semibold rounded-full">Poker ♠️</span>
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold rounded-full">Wetten 🎲</span>
                </div>
              </div>

              {/* Activity feed */}
              <div className="shimmer rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Live Activity</p>
                <div className="mt-2 space-y-2">
                  {[
                    { emoji: "⛳", text: "Marco: Eagle Loch 7", time: "vor 2 Min" },
                    { emoji: "♠️", text: "Poker Runde 3 gestartet", time: "vor 8 Min" },
                    { emoji: "📸", text: "5 neue Fotos", time: "vor 12 Min" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-lg">{item.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.text}</p>
                      </div>
                      <span className="text-[11px] text-slate-500 shrink-0">{item.time}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Leaderboard snippet */}
              <div className="bg-gradient-to-br from-navy-800 to-navy-900 rounded-2xl p-4 border border-white/5">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Leaderboard</p>
                <div className="mt-2 space-y-1.5">
                  {[
                    { pos: "1", name: "Marco", pts: "142 Pts", color: "text-amber-400" },
                    { pos: "2", name: "Luca", pts: "138 Pts", color: "text-slate-300" },
                    { pos: "3", name: "Jonas", pts: "125 Pts", color: "text-amber-700" },
                  ].map((p, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className={`font-bold ${p.color}`}>{p.pos}</span>
                      <span className="flex-1 font-medium">{p.name}</span>
                      <span className="text-slate-400 text-xs font-semibold">{p.pts}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Decorative blur orbs */}
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-accent-500/20 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-electric-500/20 rounded-full blur-[80px] pointer-events-none" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Features Flow                                                      */
/* ------------------------------------------------------------------ */
const phases = [
  {
    icon: "📋",
    title: "Pre-Trip",
    color: "from-electric-500/20 to-electric-600/5",
    border: "border-electric-500/20",
    badge: "text-electric-400 bg-electric-500/10",
    items: ["Daten sammeln", "Packages wählen", "Flüge erfassen", "Extras buchen"],
  },
  {
    icon: "🔥",
    title: "On-Trip",
    color: "from-accent-500/20 to-accent-600/5",
    border: "border-accent-500/20",
    badge: "text-accent-400 bg-accent-500/10",
    items: ["Golf & Sport Scores", "Poker & Wetten", "Live Chat", "Fotos teilen"],
  },
  {
    icon: "🏆",
    title: "Post-Trip",
    color: "from-emerald-500/20 to-emerald-600/5",
    border: "border-emerald-500/20",
    badge: "text-emerald-400 bg-emerald-500/10",
    items: ["Trip-Recap", "Highlights", "Galerie", "Mit Freunden teilen"],
  },
];

function Features() {
  return (
    <section id="features" className="relative py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal">
          <p className="text-sm font-semibold tracking-widest uppercase text-electric-400 mb-3">Der Flow</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            Alles an einem Ort
          </h2>
          <p className="mt-4 text-slate-400 text-lg max-w-2xl mx-auto">
            Von der ersten Nachricht bis zum letzten Recap&nbsp;&mdash; Crew begleitet deine Gruppe durch jede Phase.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {phases.map((phase, i) => (
            <div key={i} className={`reveal glass rounded-3xl p-8 bg-gradient-to-br ${phase.color} ${phase.border} hover:scale-[1.02] transition-transform duration-300`} style={{ transitionDelay: `${i * 100}ms` }}>
              <div className="text-4xl mb-4">{phase.icon}</div>
              <span className={`inline-block text-xs font-bold tracking-widest uppercase px-3 py-1 rounded-full ${phase.badge} mb-4`}>
                {phase.title}
              </span>
              <ul className="space-y-3">
                {phase.items.map((item, j) => (
                  <li key={j} className="flex items-center gap-3 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-electric-400 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Connecting arrows on desktop */}
        <div className="hidden md:flex justify-center gap-2 mt-10">
          <div className="h-0.5 w-24 bg-gradient-to-r from-electric-500/40 to-accent-500/40 rounded-full self-center" />
          <span className="text-slate-600 text-2xl">&#8594;</span>
          <div className="h-0.5 w-24 bg-gradient-to-r from-accent-500/40 to-emerald-500/40 rounded-full self-center" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Modules Showcase                                                   */
/* ------------------------------------------------------------------ */
const modules = [
  { emoji: "⛳", name: "Golf" },
  { emoji: "⛷️", name: "Ski" },
  { emoji: "♠️", name: "Poker" },
  { emoji: "🎯", name: "Darts" },
  { emoji: "🎳", name: "Bowling" },
  { emoji: "🎾", name: "Padel" },
  { emoji: "🏎️", name: "Kart" },
  { emoji: "💪", name: "Fitness" },
  { emoji: "🎲", name: "Wetten" },
  { emoji: "🔮", name: "Tipp-Spiel" },
  { emoji: "🍖", name: "Kochen" },
  { emoji: "📸", name: "Fotos" },
];

function Modules() {
  return (
    <section id="modules" className="relative py-32">
      {/* Background accent */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-electric-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal">
          <p className="text-sm font-semibold tracking-widest uppercase text-accent-400 mb-3">Modular</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            20+ Module. <span className="text-gradient">Ein System.</span>
          </h2>
          <p className="mt-4 text-slate-400 text-lg max-w-2xl mx-auto">
            Aktiviere nur, was du brauchst. Jedes Modul hat Scoring, Leaderboard und Live-Updates.
          </p>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {modules.map((m, i) => (
            <div
              key={i}
              className="reveal module-card glass rounded-2xl p-5 text-center cursor-default"
              style={{ transitionDelay: `${i * 50}ms` }}
            >
              <span className="text-3xl sm:text-4xl block mb-2">{m.emoji}</span>
              <span className="text-sm font-semibold text-slate-300">{m.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  How it Works                                                       */
/* ------------------------------------------------------------------ */
const steps = [
  { num: "01", title: "Gruppe erstellen", desc: "Erstelle in Sekunden eine Crew und gib eurem Trip einen Namen." },
  { num: "02", title: "Trip konfigurieren", desc: "Wähle Module, Termine und Packages. Alles flexibel anpassbar." },
  { num: "03", title: "Crew einladen", desc: "Teile den Link oder QR-Code. Anmeldung in unter 30 Sekunden." },
  { num: "04", title: "Loslegen", desc: "Scores tracken, wetten, chatten, Fotos teilen. Alles live, alles in einer App." },
];

function HowItWorks() {
  return (
    <section id="how" className="relative py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-20 reveal">
          <p className="text-sm font-semibold tracking-widest uppercase text-electric-400 mb-3">Einfach starten</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            In 4 Schritten dabei
          </h2>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 step-line -translate-y-1/2 rounded-full" />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
            {steps.map((s, i) => (
              <div key={i} className="reveal relative text-center lg:text-center" style={{ transitionDelay: `${i * 120}ms` }}>
                {/* Number bubble */}
                <div className="relative z-10 mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-electric-500 to-accent-500 flex items-center justify-center text-xl font-extrabold shadow-lg shadow-electric-500/20 mb-6">
                  {s.num}
                </div>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Social Proof / Use Cases                                           */
/* ------------------------------------------------------------------ */
const useCases = [
  { title: "Golftrip Belek", desc: "12 Spieler, 4 Runden, Live-Scoring, Abend-Poker.", gradient: "from-emerald-600/30 to-electric-600/10", emoji: "⛳" },
  { title: "Ski-Wochenende Laax", desc: "Challenges auf der Piste, Après-Ski-Wetten, Foto-Battle.", gradient: "from-sky-600/30 to-electric-600/10", emoji: "⛷️" },
  { title: "Junggesellenabschied", desc: "Challenges, Darts-Turnier, gemeinsame Galerie.", gradient: "from-pink-600/30 to-accent-600/10", emoji: "🎉" },
  { title: "Firmen-Event", desc: "Team-Building, Kart-Rennen, Leaderboards, Recap.", gradient: "from-amber-600/30 to-accent-600/10", emoji: "🏢" },
];

function UseCases() {
  return (
    <section className="relative py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16 reveal">
          <p className="text-sm font-semibold tracking-widest uppercase text-accent-400 mb-3">Für jede Crew</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            Gebaut für jede Crew
          </h2>
          <p className="mt-4 text-slate-400 text-lg max-w-2xl mx-auto">
            Egal ob Golftrip, Ski-Wochenende oder Firmen-Event&nbsp;&mdash; Crew passt sich an.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {useCases.map((uc, i) => (
            <div
              key={i}
              className={`reveal glass rounded-3xl p-6 bg-gradient-to-br ${uc.gradient} hover:scale-[1.03] transition-transform duration-300`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <span className="text-4xl block mb-4">{uc.emoji}</span>
              <h3 className="text-lg font-bold mb-1">{uc.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{uc.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  B2B Section                                                        */
/* ------------------------------------------------------------------ */
const b2bBenefits = [
  { icon: "🎨", title: "Eigenes Branding", desc: "Logo, Farben und Domain. Deine Marke im Vordergrund." },
  { icon: "📄", title: "PDF-Export", desc: "Teilnehmerlisten, Rechnungen und Recaps als PDF." },
  { icon: "📊", title: "Multi-Event", desc: "Mehrere Trips und Events parallel verwalten." },
  { icon: "👥", title: "Client Dashboard", desc: "Alle Kunden, Buchungen und Daten im Überblick." },
];

function B2B() {
  return (
    <section id="b2b" className="relative py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="reveal glass-strong rounded-[2rem] p-8 sm:p-12 lg:p-16 border border-accent-500/20 bg-gradient-to-br from-accent-500/5 to-transparent relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-accent-500/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10">
            <p className="text-sm font-semibold tracking-widest uppercase text-accent-400 mb-3">B2B</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
              Für Reisebüros &<br className="hidden sm:block" /> Veranstalter
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mb-12 leading-relaxed">
              White-Label-Lösung für professionelle Anbieter. Verwalte Gruppen, biete deinen Kunden ein Premium-Erlebnis.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {b2bBenefits.map((b, i) => (
                <div key={i} className="bg-navy-900/60 rounded-2xl p-6 border border-white/5 hover:border-accent-500/30 transition-colors">
                  <span className="text-3xl block mb-3">{b.icon}</span>
                  <h3 className="font-bold mb-1">{b.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  CTA Section                                                        */
/* ------------------------------------------------------------------ */
function CTA() {
  return (
    <section id="cta" className="relative py-32">
      {/* Glow bg */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-6 text-center reveal">
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
          Bereit für deinen
          <br />
          <span className="text-gradient">nächsten Trip?</span>
        </h2>
        <p className="text-slate-400 text-lg mb-10 max-w-xl mx-auto">
          Trag dich ein und sei einer der Ersten, die Crew nutzen. Aktuell in geschlossener Beta.
        </p>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
        >
          <input
            type="email"
            placeholder="deine@email.com"
            className="flex-1 px-5 py-4 rounded-full bg-navy-800 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-electric-500 focus:ring-2 focus:ring-electric-500/20 transition"
          />
          <button
            type="submit"
            className="pulse-cta bg-accent-500 hover:bg-accent-600 text-white font-bold px-8 py-4 rounded-full transition whitespace-nowrap"
          >
            Zugang anfragen
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-500">
          Kein Spam. Nur Updates zur Beta.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */
function Footer() {
  return (
    <footer className="border-t border-white/5 py-12">
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="text-xl font-extrabold">
            Crew<span className="text-accent-500">.</span>
          </span>
          <span className="text-sm text-slate-500">Made in Switzerland 🇨🇭</span>
        </div>
        <div className="flex gap-6 text-sm text-slate-500">
          <a href="#" className="hover:text-white transition">Impressum</a>
          <a href="#" className="hover:text-white transition">Datenschutz</a>
          <a href="#" className="hover:text-white transition">Kontakt</a>
        </div>
        <p className="text-xs text-slate-600">
          &copy; {new Date().getFullYear()} Crew. Alle Rechte vorbehalten.
        </p>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  useReveal();

  return (
    <div className="min-h-screen bg-navy-900 text-white font-sans antialiased">
      <Navbar />
      <Hero />
      <Features />
      <Modules />
      <HowItWorks />
      <UseCases />
      <B2B />
      <CTA />
      <Footer />
    </div>
  );
}
