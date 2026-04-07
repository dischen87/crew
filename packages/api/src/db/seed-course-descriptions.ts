/**
 * Seed course & hole descriptions for Belek golf courses
 * Run with: bun src/db/seed-course-descriptions.ts
 */
import { sql } from "./client";

const courseDescriptions: Record<string, { description: string; website: string }> = {
  "Montgomerie Golf Course": {
    description: "Von Colin Montgomerie entworfener Championship-Platz im Maxx Royal Resort. 18 Loch mit strategischen Wasserhinderissen, welligen Fairways und schnellen Greens. Bekannt für seine anspruchsvollen Par-3-Löcher und das spektakuläre Finish über Wasser.",
    website: "https://www.montgomeriemaxxroyal.com",
  },
  "Cullinan Links Golf Course": {
    description: "Links-Platz direkt am Mittelmeer, designed von European Golf Design. Buggy-inklusive Service. Bekannt für Küstenwinde und spektakuläre Meerblicke. Der einzige Platz in der Türkei mit Flutlichtanlage.",
    website: "https://www.cullinanlinksgolfclub.com",
  },
  "Cornelia Faldo Golf Course": {
    description: "Von Sir Nick Faldo entworfener Platz im Cornelia Diamond Resort. Drei 9-Loch-Schleifen (King, Queen, Prince) ermöglichen verschiedene 18-Loch-Kombinationen. Breite Fairways mit subtilen Geländebewegungen.",
    website: "https://www.corneliaresort.com/EN/Cornelia-Golf-Club/faldo-course",
  },
  "Kaya Palazzo Golf Course": {
    description: "Exklusiver Platz eingebettet in duftende Pinienwälder. Technisch anspruchsvolle Fairways mit starken Höhenunterschieden. Das Signature Hole bietet einen eindrucksvollen Blick über das Taurus-Gebirge.",
    website: "https://www.kayapalazzohotels.com/en/kaya-palazzo-golf-club-2/",
  },
  "Carya Golf Course": {
    description: "Im Regnum Resort gelegen, bekannt für seine einzigartigen Heide-Landschaften und natürlichen Pinienwälder. Jedes Loch hat einen eigenen Namen und Charakter. Strategisches Design mit mehreren Risk-Reward-Situationen.",
    website: "https://www.caryagolf.com",
  },
};

const holeDescriptions: Record<string, Record<number, { name?: string; description: string }>> = {
  "Montgomerie Golf Course": {
    1: { description: "Die Reise beginnt! Präziser Abschlag nötig, um die zahlreichen Hindernisse zu vermeiden und gut in die Runde zu starten." },
    2: { description: "Kurzes Par 3 mit Birdie-Chance. Gute Gelegenheit, Schwung mitzunehmen oder sich zu erholen." },
    3: { description: "Ein langer Drive über die Ecke kann sich lohnen — aber Vorsicht vor dem tiefen Bunker rechts des Greens." },
    4: { description: "Risk vs. Reward: Mit einem langen, präzisen Abschlag kann dieses Par 5 in zwei Schlägen erreichbar sein." },
    5: { description: "Auge auf die Fahne! Der Abschlag muss das Wasser überwinden. Fokus ist alles." },
    6: { description: "Stroke-Index 1. Das wellige Fairway erfordert viel Überlegung für den langen Approach zum Green." },
    7: { description: "Erneut ist ein guter Drive nötig, um das Wasser zu überqueren und das gut verteidigte, erhöhte Green zu erreichen." },
    8: { description: "Nach den schweren Löchern etwas Erholung — aber Achtung vor dem Bach, der das Fairway kreuzt." },
    9: { description: "Ein gut platzierter Drive lässt einen einfacheren Winkel ins Green offen. Bunker schützen den Zugang." },
    10: { description: "Schönes, leicht abfallendes Par 4 — ein entspannter Start in die zweite Neun." },
    11: { description: "Abschlag auf den fast unerreichbaren Mittelbunker ausrichten für die beste Sicht auf den zweiten Schlag zum erhöhten Green." },
    12: { description: "Eines der härtesten Par 4 auf dem Platz. Bunker vor dem Green machen den Approach besonders anspruchsvoll." },
    13: { description: "Zwei mächtige Pinien mitten im Fairway stellen dein Können auf die Probe. Linienwahl ist entscheidend." },
    14: { description: "Genug Schläger nehmen, um das Wasser sicher zu überspielen. Ein mutiger Mitteleisen-Approach ist gefragt." },
    15: { description: "Das kürzeste Par 4 des Platzes — aber täuschend: Das Fairway wird zum Ende hin immer enger." },
    16: { description: "Einer von Colin Montgomeries Lieblingslöchern. Geniesse den Moment und die Umgebung." },
    17: { description: "Gefälle, Bunker und Pinien erzeugen mehrere Hindernisse. Präzision vor Länge." },
    18: { description: "Das Clubhaus ist in Sicht, aber ein langes Fairway liegt dazwischen. Tiefe Bunker links vermeiden für ein Birdie-Finish!" },
  },
  "Carya Golf Course": {
    1: { name: "Out", description: "Breites Fairway zum Auftakt. Mitte anvisieren für die ideale Approach-Linie zum bunkerlosen Green. Birdie-Chance!" },
    2: { name: "The Old Nursery", description: "Trügerisches Par 3 — das Green fällt vorne ab. Auf keinen Fall zu kurz! Gute Schlägerwahl ist entscheidend." },
    3: { name: "Dire Straits", description: "Strategische Wahl zwischen zwei Fairway-Routen: Rechts ist sicherer, links belohnt Mut mit besserem Winkel." },
    4: { name: "Heather Hills", description: "Linke Fairway-Seite bevorzugen für optimalen Approach-Winkel. Rechts droht ein blinder Schlag über Heidehügel." },
    5: { name: "Troubled Water", description: "Links-Rechts-Gefälle mit See-Hindernissen. Zu kurz = Wasser, zu lang = Ärger. Präzise Längenkontrolle nötig." },
    6: { name: "The Wall", description: "Erhöhtes Green hinter See und Mauer. Exakte Schlägerwahl, besonders bei vorderen Fahnenpositionenen." },
    7: { name: "The Long", description: "Geradliniges langes Loch. Lang und gerade spielen — dann gibt es keine Probleme." },
    8: { name: "The Siren", description: "Kurzes, spektakuläres Par 3 mit trügerischer Schwierigkeit. Vorsicht bei Fahne auf der linken Green-Seite." },
    9: { name: "Taurus", description: "Abschlag rechts im Fairway für den richtigen Approach-Winkel. Bergpanorama als Bonus geniessen." },
    10: { name: "The Plank", description: "Longhitter können in zwei das Green erreichen — aber Wasser lauert überall in der Nähe!" },
    11: { name: "The Kraken", description: "Fairway zwischen Wald und See erfordert Genauigkeit. Fairway finden ist Pflicht für eine gute Birdie-Chance." },
    12: { name: "The Square", description: "Dogleg über einen Rücken: Rechts der Mittelbunker positionieren für die kürzeste Route zum Green." },
    13: { name: "The Centaur", description: "Bergab-Schlag auf geteiltes Fairway. Höhere rechte Seite bevorzugen für den optimalen Approach." },
    14: { name: "The Coffin", description: "Bergauf-Par-3 — einen Schläger mehr nehmen! Zu kurze Bälle rollen zurück in die 'Sarg'-ähnliche Mulde." },
    15: { name: "Greed", description: "Kurzes Par 5, in zwei erreichbar — aber nur mit grosser Präzision. Nicht zu gierig sein!" },
    16: { name: "Bosphorous", description: "Abschlag Richtung rechter Bunker für den einfacheren Green-Approach. Tiefe Greenside-Hindernisse vermeiden." },
    17: { name: "Javelin", description: "Gerader Schlag, aber das Green hat Gefälle in alle Richtungen. Wasser links und hohe Bäume beachten." },
    18: { name: "Home", description: "Finalloch: Rechte Fairway-Seite bevorzugen, um das Wasser zu vermeiden. Approach zum erhöhten Green zwischen alten Pinien." },
  },
  "Cornelia Faldo Golf Course": {
    1: { description: "Solider Auftakt mit breitem Fairway. Links halten für den besten Winkel ins gut geschützte Green." },
    2: { description: "Leicht doglegartig nach rechts. Der zweite Schlag muss präzise sein — Bunker links und rechts." },
    3: { description: "Langes Par 3 über eine Senke. Lieber einen Schläger mehr nehmen als zu kurz zu sein." },
    4: { description: "Breites Fairway mit sanften Hügeln. Gute Chance auf Par, wenn der Drive das Fairway findet." },
    5: { description: "Strategisches Par 5 mit Wasser vor dem Green. In drei sicher spielen oder in zwei riskieren?" },
    6: { description: "Tückisches Par 4 mit erhöhtem Green. Der Approach muss auf der richtigen Seite landen." },
    7: { name: "Faldo's Choice", description: "Sir Nick Faldos Lieblingsloch. Dogleg links mit einem gut verteidigten Green. Strategie vor Kraft." },
    8: { description: "Kurzes Par 3 — aber das Green hat starkes Gefälle. Fahnenposition beachten!" },
    9: { description: "Starkes Finish der ersten Neun. Langes Par 4 mit schmalem Fairway und bunkerreichem Green." },
    10: { description: "Sanfter Neustart. Mittleres Par 4 mit gutem Fairway — Birdie-Chance zum Auftakt der zweiten Neun." },
    11: { description: "Par 5 mit zwei deutlichen Lay-up-Zonen. Geduld zahlt sich aus." },
    12: { description: "Kurzes, aber tückisches Par 4. Das Green ist stark onduliert — Putten wird zur Herausforderung." },
    13: { name: "Deception", description: "Täuschend schwieriges Loch. Was einfach aussieht, fordert Präzision bei Approach und Putt." },
    14: { description: "Mittleres Par 3 mit Wasser seitlich. Sicheres Spiel zur Green-Mitte ist klug." },
    15: { description: "Dogleg rechts — Longhitter können die Ecke abkürzen. Risiko und Belohnung." },
    16: { description: "Langes Par 4 mit welligem Fairway. Position des Drives bestimmt die Schwierigkeit des Approaches." },
    17: { description: "Par 5 Richtung Clubhaus. In zwei erreichbar für die Mutigen, sonst sicher in drei." },
    18: { description: "Finalloch mit Wasser rechts und Bunkern links. Ein starkes Finish erfordert Nerven." },
  },
  "Cullinan Links Golf Course": {
    1: { description: "Links-Style Eröffnung mit offenem Fairway. Der Küstenwind bestimmt die Schlägerwahl. Entspannter Auftakt." },
    2: { description: "Erstes Par 3 mit Blick aufs Meer. Wind aus dem Mittelmeer macht die Distanzkontrolle zur Herausforderung." },
    3: { description: "Dogleg links entlang der Küste. Der Drive muss den Fairway-Bunker links vermeiden." },
    4: { description: "Langes Par 5 mit Rückenwind möglich — Birdie-Gelegenheit für aggressive Spieler." },
    5: { description: "Schmales Fairway zwischen Dünen. Positionsspiel ist wichtiger als Länge." },
    6: { description: "Erhöhtes Green mit starkem Gegenwind vom Meer. Ein, zwei Schläger mehr sind Pflicht." },
    7: { description: "Signature Hole mit Panoramablick über das Mittelmeer und die Taurus-Berge." },
    8: { description: "Kurzes Par 4 — aber tiefe Pot-Bunker um das Green machen den Approach knifflig." },
    9: { description: "Starkes Halftime-Finish. Langes Par 4 zurück Richtung Clubhaus mit Seitenwind." },
    10: { description: "Zweite Neun startet am Fluss Besgöz. Wasser rechts zwingt zu einem Links-Start." },
    11: { description: "Par 3 über den Fluss. Bei Wind besonders anspruchsvoll — Schlägerwahl entscheidend." },
    12: { description: "Breites Fairway zwischen Pinien. Einziges wirklich windgeschütztes Loch der Runde." },
    13: { description: "Dogleg rechts mit strategischer Bunkerplatzierung. Die beste Linie geht über den linken Bunker." },
    14: { description: "Par 5 am Fluss entlang. In drei sicher spielen, der Fluss bestraft Gier." },
    15: { description: "Mittleres Par 4 mit stark onduliertem Green. Lag-Putten sind hier überlebenswichtig." },
    16: { description: "Zurück an die Küste — der Wind kehrt zurück. Tee-Shot-Placement über alles." },
    17: { description: "Vorletztes Loch mit Meerblick. Langes Par 3 ins Kreuzfeuer aus Wind und Bunker." },
    18: { description: "Finalloch Richtung Clubhaus. Breites Fairway belohnt einen mutigen letzten Drive." },
  },
  "Kaya Palazzo Golf Course": {
    1: { description: "Auftakt durch den Pinienwald. Gerades Fairway mit sanftem Anstieg. Solider Drive bringt Sicherheit." },
    2: { description: "Par 3 bergab durch die Bäume. Das Green liegt in einer natürlichen Senke — spektakulärer Blick." },
    3: { description: "Dogleg links um eine Baumgruppe. Wer die Ecke schneidet, wird mit einem kurzen Approach belohnt." },
    4: { description: "Langes Par 4 mit deutlichem Höhenunterschied. Der Approach ist bergauf — mehr Schläger nehmen!" },
    5: { description: "Par 5 bergab durch eine Schneise im Pinienwald. In zwei erreichbar, aber der Wald bestraft Fehlschläge." },
    6: { description: "Erhöhter Abschlag mit Blick übers Taurus-Gebirge. Geniess den Moment, dann konzentrier dich aufs Par 3." },
    7: { description: "Mittleres Par 4 mit Wasserhindernis vor dem Green. Lay-up oder Attacke — du entscheidest." },
    8: { description: "Langer, schmaler Fairway-Korridor durch den Wald. Genauigkeit ist Pflicht." },
    9: { description: "Halftime-Loch mit erhöhtem Green. Der Approach muss die richtige Ebene treffen." },
    10: { description: "Zweite Neun beginnt mit einem breiten Par 5. Entspannter Neustart nach der Pause." },
    11: { description: "Par 3 mit dem Signature-View über die Berge. Starker Höhenunterschied — Schlägeranpassung nötig." },
    12: { description: "Technisches Dogleg rechts. Position des Drives bestimmt alles für den zweiten Schlag." },
    13: { description: "Langes Par 4 bergauf. Eins der schwersten Löcher — Stroke-Index 1 aus gutem Grund." },
    14: { description: "Kurzes Par 4 bergab — Birdie-Chance! Aber das Green hat starkes Gefälle." },
    15: { description: "Par 5 durch die schönste Passage des Pinienwaldes. Drei solide Schläge reichen zum Par." },
    16: { description: "Par 3 über eine Schlucht. Spektakulär und einschüchternd — aber kurz." },
    17: { description: "Vorletztes Loch mit Wasser links. Sicherheit rechts, Risiko links mit Belohnung." },
    18: { description: "Finalloch bergab zum Clubhaus. Breites Fairway erlaubt einen letzten mutigen Drive." },
  },
};

async function seedDescriptions() {
  console.log("[Descriptions] Starting course description seed...");

  // Update course descriptions
  for (const [name, data] of Object.entries(courseDescriptions)) {
    const result = await sql`
      UPDATE golf_courses
      SET description = ${data.description}, website = ${data.website}
      WHERE name = ${name}
    `;
    console.log(`[Descriptions] ${name}: ${result.count} row(s) updated`);
  }

  // Update hole descriptions
  for (const [courseName, holes] of Object.entries(holeDescriptions)) {
    const [course] = await sql`SELECT id FROM golf_courses WHERE name = ${courseName}`;
    if (!course) {
      console.log(`[Descriptions] Course "${courseName}" not found, skipping holes`);
      continue;
    }

    for (const [holeNum, data] of Object.entries(holes)) {
      await sql`
        UPDATE golf_course_holes
        SET description = ${data.description}, name = ${data.name ?? null}
        WHERE course_id = ${course.id} AND hole_number = ${parseInt(holeNum)}
      `;
    }
    console.log(`[Descriptions] ${courseName}: ${Object.keys(holes).length} hole descriptions added`);
  }

  console.log("[Descriptions] Done!");
  await sql.end();
  process.exit(0);
}

seedDescriptions().catch((err) => {
  console.error("Description seed failed:", err);
  process.exit(1);
});
