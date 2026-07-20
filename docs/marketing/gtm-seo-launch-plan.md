# Crew Next GTM- und SEO-Launchplan

- Status: Launchplan mit Evidence-Gates
- Datum: 2026-07-20
- Bead: `crew-8pe` (Refresh von `crew-paq.10.4`)
- Claim-Reconciliation: `crew-paq.10.10`
- Contract alignment: `crew-paq.4.8`
- Positionierung: [Crew Next Positionierung](./positioning.md)
- Launch-Copy: [Crew Next Launch Copy](./launch-copy.md)
- UX-Sprache: [Crew Next UX Copy Matrix](./ux-copy-matrix.md)
- Produktbasis: [Organizer- und Participant-Journeys](../product/organizer-participant-journeys.md), [Mobile Screen Inventory](../product/figma-screen-inventory.md)

## Ziel und Leitplanken

Der Launch optimiert zuerst auf belegtes Lernen mit passenden
Organisator:innen, danach auf erfolgreiche Event-Koordination. Reichweite ist
kein Ziel, solange Activation, Invite-Conversion und die beiden Verticals nicht
belegt sind.

Option 2 (`Crew Board`) ist die verbindliche visuelle Richtung für alle
nativen Produkt-, Kampagnen- und Launch-Flächen. Frühere Alternativen dürfen
weder gewählt noch mit Option 2 gemischt werden.

### Claim-Register

| Claim                                                                                                              | Stand                                                                                                                                                                               | Externe Verwendung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew Next wird für Golfreisen und Team-Events entwickelt.                                                          | **Current**                                                                                                                                                                         | Zulässig in einer echten Closed-Preview-Fläche. Keine Verfügbarkeit implizieren.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Das Backend-Modell besitzt getrennte Identity-/Event-Grenzen sowie Travel-, Golf-Tour- und Team-Event-Startformen. | **Current, Engineering-Proof**                                                                                                                                                      | Nur in technischer Evidence; kein Kundennutzen daraus ableiten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Native iOS-/Android-Experience                                                                                     | **Lokale Release-Runtime-Builds Current; Experience `[P-MOBILE]`, Release `[P-RELEASE]`**                                                                                           | Konfigurierte und unkonfigurierte iOS-/Android-Release-Artefakte bauen fail-closed. Der konfigurierte Wert ist ausschliesslich `https://gateway.staging.example.invalid`; Android-Evidence ist lokal debug-key-signiert, nicht distribution-signiert. Die Design-2-`PrivateUnavailable`-Recovery besitzt [lokale iOS-/Android-Interaktions-Evidence](../../apps/mobile/evidence/private-unavailable-option-2/README.md), belegt aber weder Deployment noch Store-Readiness; Android-TalkBack-Sprachausgabe und vollständige App-Data-Bytegleichheit werden nicht behauptet. Keine kundengerichtete Verfügbarkeit vor Live-Gateway-Trace, Crew-eigener Signatur, vollständiger Accessibility-/Journey-Evidence, Deployment und Store-Freigabe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Event prüfen und autoritativ veröffentlichen                                                                       | **Backend/Gateway/Mobile-Client + produktiv gerouteter nativer Option-2-Flow Current; Experience `[P-PUBLISH]`**                                                                    | Engineering-Proof darf Readiness, Versionierung, den expliziten Command und die code-/test-current Bearbeitungswege für fehlende Grunddaten sowie verbindliche Template-/Capability-/Ort-Blocker benennen. Kundengerichtete Verfügbarkeit erst nach nativer Device-Evidence und participant-sichtbarem service-backed Publish-, Stale- und Recovery-E2E.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Nutzbare Offline-Experience                                                                                        | `[P-OFFLINE]`                                                                                                                                                                       | Erst nach Airplane-Mode, Force-quit, Reconnect, Duplikat-, Tombstone- und Konfliktbeleg auf beiden Plattformen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Golf-Runden und Stableford-Scoring                                                                                 | **Backend/Gateway/SQLite + lokale native Design-2-iOS- und Android-Evidence Current; Experience `[P-GOLF]`**                                                                        | Engineering-Proof darf 18-Loch-Setup, actor-gebundene Scores, serverseitiges Stableford, rollenreduzierte Projektionen und das API-only Turkey-Fixture benennen. Die iPhone-16e-Scorekarte belegt Queueing, vollständigen Konfliktvergleich/Requeue, read-only Ranking, echtes Scrollen und Accessibility Large bei 390 × 844. Ein [lokaler Android-Release-shaped Service-Lauf](../../apps/mobile/evidence/golf-scorecard-option-2/android-release-service/README.md) belegt 503, Prozess-Neustart, verlorene Erfolgsantwort, identischen Replay, exakt eine Servermutation und konvergente Participant-/Organizer-Projektion; APK und Gateway blieben lokal und sind kein Distributions-, Deployment- oder Store-Beleg. Keine Acquisition-Copy vor vollständiger iOS-/Android-Journey- und Accessibility-Parität, zweimal idempotentem vollständigem Fixture, Deployment und Release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Team-Zuteilungen und Entscheidungen                                                                                | **Backend/Gateway/SQLite + produktive native Design-2-Routen Current; Experience `[P-TEAM]`**                                                                                       | Engineering-Proof darf die autoritativen Team-Flows, `SCR-032/033` und die iPhone-Evidence benennen. Der [gemeinsame `ScreenFrame`-Inset-Fix](../../apps/mobile/evidence/native-e2e-2026-07-20/team-feed-ime-release-evidence/README.md) hält den Android-TeamFeed-Composer in lokaler API-36-ReleaseEvidence bei 2,0-Schrift vollständig über der IME und macht den Submit nach normalem Scrollen erreichbar. `crew-paq.8.2.2.3` ist geschlossen; Evidence-Manifest, volle Mobile-Suite mit 63/63 Suites und 514/514 Tests, TypeScript, Lint und Prettier sind grün. Native Attention-, Live-Announcement- und Custom-Action-Ausführung fehlen weiterhin. Keine Acquisition-Copy vor geschlossenem Gate, vollständigem Rollen-/Konflikt-/Accessibility-Beleg und zweimal idempotentem Team-Fixture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Autorisierungsgebundener Recap- und Share-Link-Lifecycle                                                           | **Title-only und exact-body Backend/Gateway/Mobile-Client/SQLite, exact-body 90-Tage-Retention sowie servereigene Design-2-Consent-UX Engineering-Current; Experience `[P-RECAP]`** | Engineering-Proof darf immutable Generation, versioniertes Lesen, Quell-/Membership-Revalidierung, Removal-Tombstones, account-/root-isolierten Offline-Cache, manager-only sieben-Tage-Links, exact-version Event-/Feed-Body-Grants und bounded DB-clock Metadata-Retention benennen. `crew-paq.2.15.4.3.2`, `.4` und `.5` sind geschlossen: Native konsumiert das reloadbare, ID-freie `externalConsent`-Read-Model ordinalgebunden, persistiert keine Entscheide in SQLite und leitet Autor-/Manager-Aktionen nur aus `actorCanDecide` ab. Fokus- und vollständige Mobile-Data-Gates sowie eine [isolierte iOS-Release-shaped Design-2-Matrix](../../apps/mobile/evidence/recap-consent-option-2/README.md) belegen Grant, Withdrawal, Autor:in, Manager, Participant:in, Viewer und Drift; die Matrix nutzt Fixtures und ist kein deployter Backend-E2E. Participant-Sharing bleibt verboten; Caption/Media bleibt gated, Provenance bleibt vertragsgemäss verboten. Privacy-/Legal-Approval, öffentlicher Consumer, real service-backed Rollen-/Removal-/Recovery-E2E und Android-Parität fehlen. Keine Launch-/Acquisition-Aussage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Place-Enrichment                                                                                                   | **Backend/Worker/Gateway/Mobile-Client Current; Experience Planned**                                                                                                                | Engineering-Proof darf budgetierte asynchrone Jobs sowie Select, Status und Retry benennen. Keine Acquisition-Copy vor deploytem und überwachtem Worker-/Provider-Betrieb, nativer Fläche sowie Offline-/Device-E2E.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Product-Feedback                                                                                                   | **Backend/Gateway/Mobile-Client/SQLite + produktiv gerouteter Design-2-Code Current; Experience `[P-FEEDBACK]`**                                                                    | Engineering-Proof darf die bereinigten Feedback-Flows und die persistente Zustellqueue benennen. Die [frühere kombinierte Replay-Evidence](../../apps/mobile/evidence/feedback-release-replay/README.md) bleibt eingefroren; ihre Manifeste sind wegen späterer Cleanup-/Retry-Fixes kein Current-Tree-Source-Manifest. Neu belegt ein [frischer non-debuggable Android-`releaseEvidence`-Lauf](../../apps/mobile/evidence/feedback-android-release-replay/README.md) den vollständigen App-Pfad über Produktions-Screen, verschlüsselte SQLite, `FeedbackSubmissionController`, `FeedbackDeliveryPump`, Gateway und Event Service. Das APK war lokal mit dem Repository-Debug-Zertifikat v2/v3 signiert. Nur der etablierte isolierte Loopback-Gateway-, Request-ID- und Fixture-Bootstrap-Harness war evidence-spezifisch; Feedback-Runtime, Controller, Queue, Secure UUID und Default-SHA blieben unverändert. Der Lauf ergab exakt `503/503/503/201`, über vier Requests stabile Fingerprints, keinen fünften Cold-Start-Resend und DB-Aggregate `1/1/0/0/1`. Damit ist der Android-Akzeptanzbeleg vollständig; `crew-paq.3.10` ist geschlossen. Normal Release bleibt unverändert HTTPS-only und fail-closed; lokale Signatur und Loopback-Harness belegen weder Shipping-Konfiguration noch Distribution, Deployment oder Store-Release. Retry-Timer (`crew-paq.6.2.5`) und exakte Behandlung von `409 IDEMPOTENCY_IN_PROGRESS` (`crew-paq.6.2.6`) sind geschlossen; fokussierte Gates und die volle Mobile-Suite mit 63/63 Suites und 514/514 Tests sind grün. Community-Writes bleiben online-only. Keine Acquisition-Copy vor vollständiger nativer Large-Text-/Device-, service-backed Screenshot-Recovery-, deployter Runtime- und Launch-Evidence. |
| Community als private, root-scoped Crew-Kommunikation                                                              | **Current scope; Experience `[P-MOBILE]`**                                                                                                                                          | Als Produktgrenze erklärbar: Kommunikation findet innerhalb eines berechtigten Events statt. Keine öffentliche Discovery, Personen-/Event-Follows, cross-event Profile oder offene Social-Network-Copy. Das Folgen einer bereinigten Feedback-Meldung ist ein aktiver-root-gebundener Item-Zustand, kein Social Graph.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Produktionsreife, Datenschutzwirkung, Skalierung oder Zeitersparnis                                                | **Unbelegt**                                                                                                                                                                        | Nur mit Deployment-, Review-, Pilot- und gemessener Outcome-Evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Jede Seite und Kampagne nennt ihr Claim-Gate im Content-Brief. Interne Labels
werden vor Veröffentlichung entfernt, aber nur gegen ein verlinktes
Evidence-Paket. Current Claims bleiben im Präsens; Planned Claims stehen in
Preview-/Zukunftssprache.

### Aktueller Web- und Messstatus

Die folgenden Repository-Flächen sind **keine** Crew-Next-Launch-Evidence:

| Fläche                    | Beobachteter Stand                                                                                                                                                                                                                                                             | Launch-Folge                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web`            | Deploybare Legacy-PWA mit Legacy-API, eigener bestehender Produkt-Copy und manuell quarantänisiertem Legacy-Workflow.                                                                                                                                                          | Bleibt eine Legacy-Kohortenfläche. Sie darf weder als Crew-Next-Landing noch als Beleg für Next-Claims, Next-CTA oder Next-Analytics gezählt werden.                                                                                                        |
| `apps/web` Closed Preview | Lokale, script-freie Option-2-Preview in `de-CH`; statischer Build und Legacy-Join-`404` sind geprüft. Die Route bleibt `noindex`; ohne konfigurierte, absolute HTTPS-Kontaktadresse zeigt sie bewusst nur einen deaktivierten CTA. Browser-renderte Mobile-/Desktop-QA fehlt. | Ist eine aktuelle Code-/Copy-Grundlage, aber weder launchfähig noch veröffentlicht. Vor Freigabe fehlen mindestens datenschutzgeprüfter Kontaktweg, gerenderte Browser-QA, Deployment-/Live-Beleg sowie eine ausdrückliche Analytics-/Consent-Entscheidung. |

Auch ein in diesem Dokument als `Current` bezeichnetes Claim, die vorhandene
Preview-Route oder eine aktuelle Metrikdefinition belegt deshalb keine
Instrumentierung, Deployment-, Live- oder Conversion-Evidence.

### Nicht-Ziele

- keine gekauften Listen, ungefragten Massennachrichten oder Invite-Spam;
- keine Paid Acquisition vor belegter Activation;
- kein separates Growth-Data-Warehouse, CDP oder Attribution-Graph;
- keine SEO-Seitenfabrik, Keyword-Stuffing oder automatisch übersetzte Thin
  Pages;
- keine Experimente an Auth-, Permission-, Error-, Consent- oder
  Delivery-Truth-Copy; und
- keine Optimierung auf Downloads, wenn Events nicht koordiniert werden.

## ICP und Qualifikation

### Acquisition-ICPs

| ICP                  | Situation                                                                                             | Beobachtbarer Schmerz                                                                                  | Qualifikationsfragen                                                                                                                | Disqualifier                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Golf-Tour-Organizer  | Verantwortet eine mehrteilige Golfreise mit Reise, Aufenthalt, Transfers, Runden und Live-Änderungen. | Plan verteilt sich über Chat, Tabellen, Kalender und Einzelabsprachen; unterwegs ist Empfang unsicher. | Welches letzte Event hast du organisiert? Welche Informationen änderten sich? Wie erfuhren alle davon? Was funktionierte ohne Netz? | Sucht primär Tee-Time-Buchung, Payment, öffentliches Ticketing oder einen reinen Score-Rechner. |
| Team-Event-Organizer | Verantwortet Offsite oder Team-Event mit Agenda, Sessions, Aktivitäten und Teilnehmenden.             | Mehrere Versionen der Agenda, manuelle Rückfragen und unklare Live-Änderungen.                         | Wer besitzt den Plan? Wie werden Teilnehmende eingeladen? Was passiert bei Agenda-Änderungen? Wo gehen Antworten verloren?          | Sucht Projektportfolio, HR-Scheduling, CRM oder Desktop-first Enterprise-Administration.        |

Participant:innen und Viewer sind entscheidende Produktnutzer:innen, aber keine
primären Acquisition-ICPs. Ihr Verhalten entscheidet, ob Organizer-Nutzen
tatsächlich entsteht.

### Qualifizierter Preview-Lead

Ein Preview-Lead ist qualifiziert, wenn die Person:

1. ein reales Golf- oder Team-Event in den nächsten zwölf Monaten verantwortet
   oder kürzlich verantwortet hat;
2. mindestens zwei Koordinationsflächen nutzt oder einen konkreten
   Informations-/Änderungsbruch beschreibt;
3. Owner- oder Organizer-Entscheidungsrecht besitzt; und
4. zu Problem-Interview und späterem Evidence-Piloten bereit ist.

Kontaktangaben allein sind kein qualifizierter Lead.

## Kanalpriorität

| Priorität | Kanal                       | Phase                                             | Versprechen und CTA                                                                    | Kernmetrik                                                               | Stop-/Scale-Regel                                                                                                                                                  |
| --------: | --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|         1 | Founder-led Closed Preview  | sofort                                            | Current Claim; `Closed Preview anfragen`                                               | qualifizierte Gespräche und wiederholt beobachtete Probleme              | Stoppe Outreach-Volumen, wenn Gespräche keinen wiederkehrenden Koordinationsbruch zeigen. Skaliere erst nach mindestens je sechs Golf- und Team-Problemgesprächen. |
|         2 | Owned Search / SEO          | Phase 0 nach echter Crew-Next-Zielroute, DE-first | People-first Guides mit Current Claims; Preview-CTA                                    | non-brand Impressions, organische Klicks, qualifizierte Preview-Anfragen | Veröffentliche nur Seiten mit eigenem Erfahrungs-, Research- oder Template-Wert. Kein Cluster wächst ohne Search- oder Gesprächssignal.                            |
|         3 | Rollenrichtiger Invite-Loop | `[P-MOBILE]`, `[P-PUBLISH]` plus Vertical-Gate    | Organizer lädt ein; Participant öffnet genau das berechtigte und veröffentlichte Event | Invite-Preview -> Redeem -> First Value                                  | Keine Referral-Belohnung und kein Participant-Invite. Skaliere erst bei sicherer Deep-Link-, Publish- und Permission-Evidence.                                     |

App Store und Product Page sind nach `[P-MOBILE]`, `[P-PUBLISH]`, `[P-GOLF]`
und `[P-TEAM]` Conversion-Flächen, kein vierter Kanal-Bet. Paid Search, Paid Social,
Influencer-Programme und breite PR
bleiben aus, bis mindestens 20 qualifizierte Organizer-Starts und 10
`first_coordination_success`-Events über beide Verticals vorliegen.

## Gate-basierte Launchphasen

| Phase                           | Eintritt                                                              | Arbeit                                                                                                                                                | Exit-Evidence                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 – Claim- und Messbereitschaft | Positionierung und Launch-Copy vorhanden                              | Current/Planned pro Fläche prüfen; echte Preview-Zielroute; Event-Dictionary, Consent und Owner benennen; Search Console vorbereiten.                 | Kein toter CTA; Claim-Review bestanden; Tracking-QA ohne Secrets; indexierbare Seiten technisch prüfbar.                                             |
| 1 – Problem Evidence            | Phase 0 erfüllt                                                       | Je sechs reale Golf-/Team-Gespräche; vorhandenen Tool-Mix und letzte konkrete Brüche dokumentieren; Closed-Preview-Landing testen.                    | Wiederkehrender Schmerz in beiden Segmenten; mindestens je zwei passende Design-Partner; Positionierung wird korrekt wiedergegeben.                  |
| 2 – Closed Alpha                | `[P-MOBILE]`, `[P-PUBLISH]` und mindestens ein Vertical-Gate erfüllt  | Organizer begleitet aktivieren; ersten Plan erstellen und veröffentlichen; Einladung bis Participant First Value beobachten; Support manuell und eng. | 10 qualifizierte Root-Starts; Publish-Pfad und Funnel vollständig messbar; keine offenen P0/P1 Auth-, Datenverlust- oder Permission-Defekte.         |
| 3 – Dual-Vertical Beta          | `[P-PUBLISH]`, `[P-GOLF]`, `[P-TEAM]`; `[P-OFFLINE]` für Offline-Copy | Beide Verticals end-to-end; reale Verbindungsunterbrechung; erste veröffentlichte Planänderung bis Participant-Open; DE-SEO-Pillars veröffentlichen.  | Mindestens 10 `first_coordination_success`-Events, beide Verticals vertreten; Publish-, Offline- und Device-Evidence verlinkt; Claim-Gates promoted. |
| 4 – Öffentlicher Launch         | Phase 3 plus Release-/Privacy-/Operations-Gates                       | Launch-Landing und App-Store-Copy aktivieren; EN nur transcreated; App-Store- und SEO-Snippets prüfen; Support und Monitoring live.                   | Funnel, Support, Search Console und Store-Metadaten haben Owner; kein Planned Claim im Präsens; Launch-Review signiert.                              |

Die Zahlen sind operative Lernschwellen, keine statistischen
Wirksamkeitsbehauptungen.

## Funnel und Erfolgsmetriken

### Produktdefinitionen

| Stufe                        | Exakte Definition                                                                                                                                                                               | Gate                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `qualified_preview_lead`     | Erfüllt alle vier ICP-Kriterien; menschlich bestätigt.                                                                                                                                          | Definition Current; Erfassung erst nach Phase-0-Workflow                                  |
| `organizer_start`            | Qualifizierte:r Organizer:in startet im Produkt einen neuen Root.                                                                                                                               | `[P-MOBILE]`                                                                              |
| `event_activation_reached`   | Root hat Titel und Zeitzone, mindestens einen relevanten Planpunkt und der Owner erreicht die teilnehmergetreue Review-Fläche.                                                                  | `[P-MOBILE]` plus Vertical-Gate                                                           |
| `invite_connected`           | Eine rollenrichtige Einladung wurde erstellt, sicher geöffnet, eingelöst und der initiale Snapshot vollständig lokal committed.                                                                 | `[P-MOBILE]`                                                                              |
| `participant_first_value`    | Eingeladene Person öffnet nach vollständigem Sync den Event-Hub oder den relevanten Now/Next-Planpunkt.                                                                                         | `[P-MOBILE]`, `[P-PUBLISH]`                                                               |
| `first_coordination_success` | Aktivierter Root + eingelöste Einladung + Participant First Value + eine danach veröffentlichte, participant-sichtbare Planänderung wird vom Participant auf der bestätigten Revision geöffnet. | `[P-MOBILE]`, `[P-PUBLISH]` plus Vertical-Gate; Offline-Variante zusätzlich `[P-OFFLINE]` |

`first_coordination_success` ist die Launch-North-Star-Metrik. Sie misst keine
Eventqualität oder Zeitersparnis, sondern den ersten nachweisbaren
Koordinationskreislauf.

### Funnel-Formeln

| Metrik                       | Formel                                                       | Segmentierung                                      |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Qualified preview rate       | `qualified_preview_lead / preview_request_submitted`         | source channel, Golf/Team                          |
| Organizer activation rate    | `distinct activated roots / distinct organizer starts`       | Vertical, Setup, Build                             |
| Invite creation rate         | `roots with invite created / activated roots`                | Role invited, Vertical                             |
| Invite preview rate          | `distinct valid invite previews / invites shared`            | Vertical, platform; keine Token-ID in Analytics    |
| Invite redemption rate       | `distinct redeemed invites / distinct valid invite previews` | Vertical, signed-out return required ja/nein       |
| Participant first-value rate | `participants reaching first value / redeemed participants`  | Vertical, platform, bootstrap restart ja/nein      |
| Coordination success rate    | `roots with first_coordination_success / activated roots`    | Vertical, online/offline Evidence-Kohorte          |
| Time to activation           | Median und p75 von Organizer Start bis Activation            | Vertical; kleine Samples als directional markieren |
| Time to first coordination   | Median und p75 von Activation bis Success                    | Vertical; keine individuelle Performance-Bewertung |

Downloads, App-Opens, Pageviews und Raw Invite Sends sind Diagnosemetriken,
keine Erfolgsmetriken.

## SEO-Strategie

### Prinzipien

1. Inhalte dienen einer klaren Organizer-Frage und enthalten eigene Erfahrung,
   Research oder ein direkt nutzbares Modell. Google empfiehlt hilfreiche,
   verlässliche, people-first Inhalte statt Search-first-Massenproduktion:
   [Helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content),
   [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
2. Keyword-Cluster sind Hypothesen, keine Volumenclaims. Erst Search Console und
   echte Gespräche bestimmen Ausbau oder Stopp.
3. Seiten mit Planned Product Claims bleiben `noindex` oder in ehrlicher
   Preview-/Zukunftssprache, bis ihr Gate erfüllt ist.
4. DE-CH ist die Ausgangssprache. EN erscheint nur als echte Transcreation mit
   eigener Intent-Prüfung. Lokalisierte Paare referenzieren sich selbst und
   gegenseitig über `hreflang`; Google beschreibt die Variantenregeln hier:
   [Localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions).
5. Kein künstliches Freshness-Datum, kein Keyword-Stuffing, keine skalierten
   AI-Seiten und keine erfundenen Reviews oder Case Studies.

### Intent-Cluster

| Cluster           | DE-Intent                                                                          | EN-ready Intent                                    | People-first Antwort                                                                                       | Produkt-Claim                                                |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Kategorie         | Gruppenevent planen, Gruppenablauf organisieren, Eventplan für Teilnehmende        | plan a group event, shared event plan              | Wann ein gemeinsamer Plan besser passt als lose Chat-/Tabellen-Koordination; ehrliche Auswahlkriterien.    | Current Preview; Nutzen im Präsens erst `[P-MOBILE]`.        |
| Golfreise         | Golfreise planen, Golftrip organisieren, Ablauf Golfreise                          | plan a golf trip, golf trip itinerary              | Erprobte Planstruktur für Reise, Aufenthalt, Transfers und Runden; Checkliste ohne Buchungsclaim.          | Startform `[I-BACKEND]`; vollständige Experience `[P-GOLF]`. |
| Team-Event        | Team-Event planen, Offsite Agenda, Teamtag organisieren                            | plan a team offsite, offsite agenda                | Agenda-, Session-, Aktivitäts- und Change-Plan mit Rollen und klarer Owner-Verantwortung.                  | Startform `[I-BACKEND]`; vollständige Experience `[P-TEAM]`. |
| Live-Koordination | Planänderung Gruppe kommunizieren, Event bei schlechtem Empfang, Offline Eventplan | communicate event changes, offline group itinerary | Praktischer Ablauf für Version, Zustellstatus und Fallback bei Netzverlust; Crew-Lösung nur nach Evidence. | Problemseite Current; Produktlösung `[P-OFFLINE]`.           |

### Technische Mindestbasis

- statische oder serverseitig gerenderte, crawlbare Hauptinhalte; kein
  Login-Zwang für Marketingseiten;
- pro URL eindeutiger, präziser `<title>`, sichtbarer H1, kurze Meta Description,
  self-canonical und sinnvoller interner Linktext;
- `lang="de-CH"`; EN-Paar erst bei vollständiger Transcreation mit `hreflang`
  für `de-CH`, `en` und optional `x-default`;
- Root-Sitemap mit absoluten canonical-200-URLs und Einreichung in Search
  Console nach Googles [Sitemap-Anleitung](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap);
- `robots.txt` blockiert keine Ressourcen, die Google zum Rendern braucht;
  gated Seiten nutzen `noindex`, nicht nur robots blocking;
- Core Web Vitals am 75. Perzentil: LCP höchstens 2,5 s, INP höchstens 200 ms,
  CLS höchstens 0,1, gemäss [web.dev](https://web.dev/articles/defining-core-web-vitals-thresholds);
- Search Console nach Page, Query, Country und Device prüfen; Clicks,
  Impressions und CTR als Trend priorisieren, nicht Average Position allein:
  [Search Console Performance](https://support.google.com/webmasters/answer/17010961);
- `SoftwareApplication` Structured Data erst nach realem Store-Listing, korrektem
  Preis/OS und zulässigem echtem Review/Rating. Keine Ratings erfinden; vor
  Einsatz mit [Rich Results Test und Google-Richtlinie](https://developers.google.com/search/docs/appearance/structured-data/software-app) prüfen.

## Content-Backlog

Alle URLs sind Vorschläge, keine bereits vorhandenen Seiten. Content Owner ist
standardmässig Mathias, bis ein anderer DRI explizit eingetragen ist.

| Prio | Asset / Arbeitstitel DE                                                     | EN-ready Intent                      | Eigenwert                                                                   | Claim-Gate                                                 | CTA                                                  | Erfolgssignal                                   |
| ---: | --------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
|   P0 | `/de-ch/` – Der gemeinsame Plan für eure Gruppe                             | one shared plan for your group       | fokussierte Kategorie- und ICP-Erklärung                                    | Current Closed Preview; Launch `[P-MOBILE]`, `[P-PUBLISH]` | Closed Preview anfragen                              | qualifizierte Preview-Rate                      |
|   P0 | Golfreise planen: eine Struktur für Reise, Aufenthalt, Transfers und Runden | how to plan a golf trip              | aus realen Interviews validierte Ablaufstruktur und Checkliste              | Produktnutzen `[P-GOLF]`                                   | Closed Preview anfragen                              | non-brand Impressions, qualifizierte Golf-Leads |
|   P0 | Team-Event planen: Owner, Agenda, Sessions und Live-Änderungen              | how to plan a team offsite           | aus realen Interviews validiertes Agenda- und Change-Modell                 | Produktnutzen `[P-TEAM]`                                   | Closed Preview anfragen                              | non-brand Impressions, qualifizierte Team-Leads |
|   P1 | Golfreise-Checkliste vor Abflug und vor jeder Runde                         | golf trip planning checklist         | nutzbare HTML-Checkliste; kein gated PDF nötig                              | Crew-CTA `[P-GOLF]`                                        | Checkliste verwenden; sekundär Preview im Seitenende | Completion-Feedback, organische Klicks          |
|   P1 | Offsite-Agenda, die Änderungen aushält                                      | resilient team offsite agenda        | Beispielagenda plus Update-Protokoll                                        | Crew-CTA `[P-TEAM]`                                        | Agenda übernehmen; sekundär Preview im Seitenende    | Scroll-/Copy-Nutzung nur mit Consent; Leads     |
|   P1 | Chat und Tabelle zu einem aktuellen Eventplan zusammenführen                | replace scattered event coordination | neutrales Entscheidungsmodell, wann bestehende Tools reichen und wann nicht | Current Problem-Content; Produktclaim `[P-MOBILE]`         | Closed Preview anfragen                              | qualifizierte CTA-Klicks                        |
|   P2 | Gruppenevent bei schlechtem Empfang koordinieren                            | offline event coordination           | netzunabhängiger Fallback- und Statusleitfaden                              | Crew-Lösung `[P-OFFLINE]`                                  | Nach Gate: Event erstellen                           | Search Intent und Coordination Success          |
|   P2 | Pilotbericht Golf / Team                                                    | golf trip or offsite case study      | echte Ausgangslage, Ablauf, Grenzen und Outcome mit Freigabe                | nur nach abgeschlossenem Pilot                             | Event erstellen                                      | assistierte qualifizierte Starts                |
|   P2 | EN-Transcreation der bewiesenen Gewinnerseiten                              | validated English intent             | neue Intent-Recherche, keine maschinelle 1:1-Kopie                          | Gate der jeweiligen DE-Seite                               | äquivalenter CTA                                     | non-brand EN Clicks und qualifizierte Starts    |

P0 umfasst nur drei Seiten. P1 startet erst, wenn Interviews mindestens einen
passenden Intent bestätigen. P2 startet erst nach dem jeweiligen Evidence-Gate.

## Experimente und Entscheidungsregeln

| ID  | Experiment                                                                                        | Primärmetrik                                                            | Guardrails                                                               | Mindest-Evidence                                                                                  |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| E1  | Landing-Hero A „gemeinsamer Plan“ gegen B „jetzt und als Nächstes“ aus der Launch-Copy            | korrekte Kategorie-/Nutzenwiedergabe; später qualifizierte Preview-Rate | identischer CTA; keine künstliche Dringlichkeit                          | zuerst je 10 qualitative Fünf-Sekunden-Tests; A/B erst ab 200 qualifizierten Sessions je Variante |
| E2  | Golf- und Team-Pillar mit eigener Intent-Copy, nicht personalisiert                               | qualifizierte Leads pro organischer Landingpage                         | kein Segment-Retargeting aus privaten Eventdaten                         | je sechs ICP-Gespräche plus erste Search-Console-Query-Signale                                    |
| E3  | Onboarding Welcome A „Ein Plan für eure Gruppe“ gegen B „Beginne mit dem Plan, den alle brauchen“ | `starting_shape_selected / onboarding_started` und Activation Rate      | `[P-MOBILE]`; keine Error-/Permission-Copy ändern; Abbruch als Guardrail | 100 qualifizierte Organizer pro Variante oder als directional ausweisen                           |
| E4  | SEO Title/Description eines bestehenden Pillars sequenziell verbessern                            | Search-Console Clicks und CTR bei stabiler Query-/Page-Gruppe           | kein Cloaking, keine Bot/User-Varianten, Inhalt bleibt korrekt           | mindestens vier Wochen pro Fassung und keine gleichzeitige Content-Änderung                       |

Vor Start werden Hypothese, Einheit, Primärmetrik, Guardrails, Dauer und
Stop-Regel festgehalten. Unter der Mindest-Evidence gibt es keinen „Gewinner“,
sondern nur ein Richtungssignal. Auth, Consent, Invite-Verfügbarkeit,
Berechtigungen und Delivery-Truth werden nie experimentiert.

## Analytics-Eventvertrag

Der Vertrag bleibt vendor-neutral. Search Console deckt SEO-Impressions und
Clicks ohne eigenes Keyword-Scraping ab. Für Web und Produkt wird höchstens ein
privacy-geprüfter Analytics-Empfänger genutzt; Rohdaten werden nicht zusätzlich
in ein Growth-Warehouse kopiert.

### Events

Der native, vendor-neutrale Facade-Vertrag ist aktuell nur für
`organizer_start`, `initial_sync_completed`, `participant_first_value` und
`first_coordination_success` implementiert. Ein App-Trigger und ein
privacy-geprüfter Sink sind noch nicht verdrahtet; deshalb gilt auch für diese
vier Events: Contract Current, Delivery Planned. Alle weiteren Zeilen sind
Zielverträge für die jeweilige Gate-Phase.

| Event                        | Autoritative Auslösung                                           | Minimale Properties                                                     | Gate                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `landing_view`               | indexierbare Landingpage sichtbar                                | `page_id`, `locale`, `source_channel`, `experiment_id`, `variant`       | Vertrag definiert; Instrumentierung Phase 0 nach echter Next-Fläche und Consent                                    |
| `content_view`               | Pillar/Guide sichtbar                                            | `content_id`, `cluster`, `locale`, `source_channel`                     | Vertrag definiert; Instrumentierung Phase 0 nach echter Next-Fläche und Consent                                    |
| `primary_cta_clicked`        | einziger Haupt-CTA aktiviert                                     | `surface`, `cta_id`, `content_id?`, `experiment_id?`, `variant?`        | Vertrag definiert; Instrumentierung Phase 0 nach echter Next-Fläche und Consent                                    |
| `preview_request_submitted`  | echte Preview-Anfrage serverseitig angenommen                    | `source_channel`, `vertical_interest`, `locale`; keine Formtexte        | Vertrag definiert; erst nach realer Zielroute und bestätigter Serverannahme emittieren; Marketing-Consent getrennt |
| `qualified_preview_lead`     | menschliche ICP-Prüfung abgeschlossen                            | `vertical`, `qualification_version`, `source_channel`                   | Definition Current; Erfassung erst nach dokumentiertem CRM-/Beads-Workflow, nicht als Browser-Event                |
| `onboarding_started`         | erste Onboarding-Fläche sichtbar                                 | `platform`, `app_version`, `locale`, `experiment_id?`, `variant?`       | `[P-MOBILE]`                                                                                                       |
| `starting_shape_selected`    | Auswahl lokal committed                                          | `shape` (`golf_tour`, `team_event`, `blank`), `platform`, `app_version` | `[P-MOBILE]`; Contract und Delivery Planned                                                                        |
| `organizer_start`            | Root-Create serverseitig bestätigt                               | `vertical`, `platform`                                                  | `[P-MOBILE]`; Facade Contract Current, App-Trigger und Delivery Planned                                            |
| `event_activation_reached`   | Activation-Definition erstmals server-/projektionsseitig erfüllt | `vertical`, `plan_item_family`, `platform`, `app_version`               | `[P-MOBILE]` plus Vertical-Gate                                                                                    |
| `invite_created`             | Event-Service bestätigt Einladung                                | `vertical`, `role`, `policy_bucket`; kein Token, keine E-Mail           | `[P-MOBILE]`                                                                                                       |
| `invite_previewed`           | sichere gültige Preview angezeigt                                | `vertical`, `role`, `signed_in`, `platform`; kein Token                 | `[P-MOBILE]`                                                                                                       |
| `invite_redeemed`            | Membership atomar bestätigt                                      | `vertical`, `role`, `signed_out_return`, `platform`                     | `[P-MOBILE]`                                                                                                       |
| `initial_sync_completed`     | finaler Snapshot-Swap committed                                  | `vertical`, `page_count_bucket`, `restart_count_bucket`, `platform`     | `[P-MOBILE]`; Facade Contract Current, App-Trigger und Delivery Planned                                            |
| `participant_first_value`    | Event-Hub oder relevanter Now/Next-Target nach Sync geöffnet     | `vertical`, `entry_surface`, `platform`                                 | `[P-MOBILE]`, `[P-PUBLISH]`; Facade Contract Current, App-Trigger und Delivery Planned                             |
| `plan_update_published`      | participant-sichtbare Revision bestätigt                         | `vertical`, `update_family`, `online_state`                             | `[P-MOBILE]`, `[P-PUBLISH]` plus Vertical-Gate                                                                     |
| `plan_update_opened`         | berechtigter Participant öffnet bestätigte Revision              | `vertical`, `entry_surface`, `online_state`                             | `[P-MOBILE]`, `[P-PUBLISH]` plus Vertical-Gate                                                                     |
| `first_coordination_success` | alle North-Star-Bedingungen erstmals erfüllt                     | `vertical`, `online_state`, `platform_mix`                              | `[P-MOBILE]`, `[P-PUBLISH]` plus Vertical-Gate; Facade Contract Current, App-Trigger und Delivery Planned          |

### Gemeinsame Properties und Datenschutz

Der aktuelle native Facade-Envelope enthält ausschließlich
`schema_version`, `event_name`, die stabile interne `actor_user_id`,
`occurred_at` und die oben genannten exakten Event-Properties. Er kennt keine
freien Texte, Root-IDs, E-Mail-Adressen, Tokens oder Feedback-Diagnostik. Die
folgenden gemeinsamen Properties beschreiben den breiteren, noch geplanten
Web-/Produktvertrag und dürfen erst nach Privacy- und Retention-Review ergänzt
werden:

- `schema_version`, `occurred_at`, `locale`, `platform`, `app_version` und eine
  erlaubte `source_channel`-Enum;
- zufällige Analytics Event-ID zur Deduplikation;
- account- und root-bezogene Funnel-Keys nur pseudonymisiert und nur mit
  dokumentierter Retention;
- UTM-Werte auf erlaubte Source-/Medium-/Campaign-Enums normalisieren; keine
  vollständigen Referrer- oder Query-Strings speichern;
- keine Namen, E-Mails, Invite-/Access-Token, Eventtitel, Nachrichtentexte,
  Antworten, Scores, genaue Orte, Screenshots, Presigned URLs oder private IDs;
- keine Eventdaten an Ad-Netzwerke und kein Cross-Context-Profiling;
- Operational-/Security-Telemetrie bleibt von Marketing-Analytics getrennt;
- Consent, Rechtsgrundlage, Retention, Export und Löschung werden vor
  Instrumentierung mit Privacy/Security festgelegt, nicht durch diesen Plan
  behauptet.

Backend-Zustände wie Invite Redeemed oder Published kommen aus dem owning
Service; Mobile-Views erst nach SQLite-Commit. Ein UI-Klick darf keinen
serverseitigen Erfolg vortäuschen.

## Owner-Checkliste

Bis zur expliziten Delegation ist Mathias DRI; die Rollen zeigen, welche
Kompetenz den Nachweis abzeichnen muss.

| Owner-Rolle          | Vor dem nächsten Gate konkret zu prüfen                                                                            | Strukturelle Evidence                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Product / Founder    | ICP-Protokolle, Claim-Register, Phase-Exit und North-Star-Definition freigeben.                                    | verlinkte Interview-Synthese; Claim-Diff; signierter Gate-Entscheid            |
| Content / SEO        | Für jede Seite Intent, eigene Evidence, Current/Planned, DE-Quelle, EN-Transcreation, CTA und Review-Datum führen. | Content-Brief; Quellen; SERP-/Search-Console-Snapshot; kein Thin Duplicate     |
| Engineering Web      | echter CTA, crawlbares HTML, Title/H1/Meta, canonical, sitemap, robots/noindex, hreflang und CWV prüfen.           | URL Inspection; Sitemap-Status; Lighthouse plus Feld-CWV sobald vorhanden      |
| Product Analytics    | Event-Dictionary versionieren; autoritative Trigger, Deduplikation, Funnel-Queries und QA-Datensatz prüfen.        | Event-Schema; Testmatrix; Beispielquery; Duplicate-/Missing-Event-Report       |
| Privacy / Security   | Consent, Datenfluss, Retention, Pseudonymisierung, DSAR/Löschung und verbotene Felder prüfen.                      | freigegebene Data Map; Payload-Sample ohne Secrets; Löschtest                  |
| Design / Research    | Message-, Onboarding- und Invite-Tests barrierefrei durchführen; keine Dark Patterns.                              | Testskript; Teilnehmerprofil; Findings; VoiceOver-/TalkBack-Evidence nach Gate |
| Mobile / Backend     | Mobile- und Vertical-Gates, Deep Links, Auth Return, Invite-Rollen und Delivery-Truth belegen.                     | Device-Aufnahmen; Gateway/API-/DB-/SQLite-Evidence; Fixture-Reconciliation     |
| Operations / Support | Support-Zielroute, Monitoring, Incident Owner und Feedbackkanal vor Public Launch bestätigen.                      | erreichbarer Support; Alert-Test; Runbook; Launch-Watch-Plan                   |

Ein Gate gilt nur als bestanden, wenn die Evidence verlinkt und reproduzierbar
ist. „Code vorhanden“, „Seite geschrieben“ oder „Tracking eingebaut“ genügt
nicht.

## Launch-Review-Rhythmus

- wöchentlich in Phase 1–3: qualitative Findings, Funnel-Brüche, Claim-Risiken
  und Supportfälle; keine Vanity-Rankings;
- vierwöchentlich: Search Console Page-/Query-Trends, Content-Entscheide und
  technische Indexierung;
- pro Build/Release: Event-Schema-, Claim-, Store-Metadata- und Deep-Link-Diff;
- pro Gate: schriftlicher Promote/Stop/Iterate-Entscheid mit Owner und Evidence;
- quartalsweise nach Public Launch: Inhalte nur bei echter materieller Änderung
  aktualisieren, zusammenführen oder entfernen.

## Strukturelle Abnahme

Der Plan ist abnahmefähig, wenn:

1. genau zwei Acquisition-ICPs, drei priorisierte Kanäle und gate-basierte
   Phasen definiert sind;
2. Current und Planned Claims pro Funnel-, SEO- und Content-Fläche getrennt
   bleiben und jede Publish-Aussage `[P-PUBLISH]` verlangt;
3. SEO vier Intent-Cluster, technische Mindestbasis und einen priorisierten
   Backlog mit CTA und Messsignal besitzt;
4. `first_coordination_success` und alle Funnel-Formeln exakt definiert sind;
5. Experimente Primärmetrik, Guardrail und Mindest-Evidence nennen;
6. Analytics Events autoritative Trigger und verbotene Daten benennen; und
7. jede Launch-Disziplin Owner und reproduzierbare Evidence hat.
