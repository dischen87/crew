import { motion } from "framer-motion";

interface Props {
  onGetStarted: () => void;
}

export default function Landing({ onGetStarted }: Props) {
  return (
    <div className="min-h-screen bg-surface-0 text-dark font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface-0/95 backdrop-blur-md border-b-2 border-dark/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-accent-mint border-2 border-dark w-9 h-9 rounded-xl flex items-center justify-center text-lg font-extrabold shadow-brutal-sm">C</span>
            <span className="text-xl font-extrabold tracking-tight">CREW</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-bold">
            <a href="#features" className="hover:text-dark/60">Features</a>
            <a href="#how" className="hover:text-dark/60">So geht's</a>
            <button onClick={onGetStarted} className="bg-dark text-white px-5 py-2 rounded-full border-2 border-dark shadow-brutal-sm hover:-translate-y-0.5 transition-transform">
              App starten
            </button>
          </nav>
          <button onClick={onGetStarted} className="md:hidden bg-dark text-white px-4 py-2 rounded-full text-sm font-bold border-2 border-dark">
            Starten
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-32">
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
          <motion.div
            className="flex-1 text-center md:text-left"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-6xl font-extrabold leading-tight tracking-tight mb-6">
              Dein Trip.<br />
              Deine Crew.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-mint to-accent-gold">Eine App.</span>
            </h1>
            <p className="text-lg md:text-xl text-dark/50 leading-relaxed mb-8 max-w-lg">
              Organisiere Golftrips und Gruppenreisen mit deiner Crew.
              Alles an einem Ort — von der Planung bis zum Recap.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <button
                onClick={onGetStarted}
                className="bg-dark text-white px-8 py-4 rounded-full text-lg font-extrabold border-2 border-dark shadow-brutal hover:-translate-y-1 transition-transform"
              >
                Jetzt starten
              </button>
              <a
                href="#how"
                className="bg-white text-dark px-8 py-4 rounded-full text-lg font-extrabold border-2 border-dark shadow-brutal hover:-translate-y-1 transition-transform text-center"
              >
                Mehr erfahren
              </a>
            </div>
          </motion.div>

          <motion.div
            className="flex-shrink-0 hidden md:block"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-72 h-[500px] bg-dark rounded-[2.5rem] p-4 shadow-brutal-lg border-2 border-dark">
              <div className="w-full h-full bg-surface-0 rounded-[2rem] p-6 flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🏌️</span>
                  <span className="text-lg font-extrabold">Belek 2025</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Golf", "Fluege", "Chat", "Fotos", "Wetten", "Poker"].map((mod) => (
                    <span key={mod} className="bg-white border-2 border-dark/20 rounded-full px-4 py-1.5 text-sm font-bold">{mod}</span>
                  ))}
                </div>
                <div className="bg-accent-mint/30 border-2 border-dark/10 rounded-2xl p-4 mt-auto">
                  <p className="text-xs font-bold text-dark/40 mb-1">LEADERBOARD</p>
                  <div className="flex items-center gap-2">
                    <span className="bg-accent-gold border-2 border-dark w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                    <span className="text-sm font-bold">Mathias</span>
                    <span className="ml-auto text-sm font-extrabold">42 Pkt</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-white border-y-2 border-dark/10 py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-16 tracking-tight">So funktioniert's</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: "1", title: "Crew erstellen", desc: "Erstelle deine Crew und lade Freunde mit einem einfachen Link ein.", emoji: "🤝" },
              { num: "2", title: "Trip planen", desc: "Waehle Module wie Golf, Fluege, Zimmer oder Extras — ganz nach eurem Trip.", emoji: "🗓" },
              { num: "3", title: "Gemeinsam erleben", desc: "Scores tracken, Fotos teilen, chatten und Wetten abschliessen — alles live.", emoji: "🏆" },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                className="bg-surface-0 border-2 border-dark rounded-2xl p-8 text-center shadow-brutal"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
              >
                <span className="text-4xl mb-4 block">{step.emoji}</span>
                <div className="bg-accent-mint border-2 border-dark w-10 h-10 rounded-xl mx-auto flex items-center justify-center text-lg font-extrabold shadow-brutal-sm mb-4">{step.num}</div>
                <h3 className="text-xl font-extrabold mb-2">{step.title}</h3>
                <p className="text-dark/50 text-sm leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-16 tracking-tight">Alles fuer eure Crew</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { emoji: "🏌️", title: "Golf Scoring", desc: "Stableford, Strokeplay, Teams, Scramble, Best Ball." },
              { emoji: "💬", title: "Crew Chat", desc: "Echtzeit-Chat mit Link-Previews und Bilder-Sharing." },
              { emoji: "📸", title: "Fotos & Medien", desc: "Gemeinsame Foto-Galerie fuer alle Trip-Erinnerungen." },
              { emoji: "✈️", title: "Fluege & Logistik", desc: "Fluege, Zimmer und Packages an einem Ort." },
              { emoji: "🎯", title: "Wetten & Challenges", desc: "Wettet untereinander und habt Spass." },
              { emoji: "🏆", title: "Leaderboard", desc: "Punkte ueber alle Aktivitaeten hinweg." },
            ].map((feat, i) => (
              <motion.div
                key={feat.title}
                className="bg-white border-2 border-dark/10 rounded-2xl p-6 hover:-translate-y-1 transition-transform"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <span className="text-3xl block mb-3">{feat.emoji}</span>
                <h3 className="text-lg font-extrabold mb-1">{feat.title}</h3>
                <p className="text-dark/50 text-sm">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-dark text-white py-20 text-center">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Bereit fuer euren naechsten Trip?</h2>
          <p className="text-white/50 text-lg mb-8">Starte jetzt mit deiner Crew.</p>
          <button
            onClick={onGetStarted}
            className="bg-accent-mint text-dark px-10 py-4 rounded-full text-lg font-extrabold border-2 border-dark shadow-brutal hover:-translate-y-1 transition-transform"
          >
            Jetzt starten
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t-2 border-dark/10">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-accent-mint border-2 border-dark w-7 h-7 rounded-lg flex items-center justify-center text-xs font-extrabold">C</span>
            <span className="font-extrabold text-sm">CREW</span>
          </div>
          <p className="text-dark/30 text-xs font-bold">&copy; 2025 crew-haus.com</p>
        </div>
      </footer>
    </div>
  );
}
