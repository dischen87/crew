# Crew Publish Native Success Final

Status: **HISTORISCHER, SANITISIERTER PASS für den damals belegten iOS-Publish-Slice. Nicht als aktuelle visuelle Abnahme verwenden. Die aktuelle bindende lokale Acceptance ist separat unter `../../native-e2e-2026-07-22/publish-remaining-final` eingefroren und abschlussauditiert.**

## Ergebnis

- Der immutable Event-Service-v1-Blueprint blieb absichtlich Englisch. Die deutsche Option-2-Darstellung wurde ausschliesslich in der Mobile-UI lokalisiert und damals nativ geprüft. Die absichtlichen `Native …` E2E-Fixture-Titel blieben unverändert.
- Die drei serverautoritativen Setup-Blocker wurden auf einem echten iPhone-16e-Simulator durchlaufen: Vorlage übernehmen, Capability ergänzen und Hauptort binden.
- Basisdaten wurden zweimal offline dauerhaft gespeichert, jeweils durch einen echten App-Prozess-Neustart getragen und anschliessend synchronisiert.
- Zwischen den beiden Offline-Zyklen wurde dieselbe Bundle-ID deinstalliert und neu installiert. Die Keychain-Sitzung blieb erhalten, SQLite wurde frisch aufgebaut und der Serverstand neu eingelesen.
- Die Publish-Review bestand bei 390x844 sowohl mit normaler Schrift als auch mit `accessibility-extra-large`; die Publish-CTA wurde jeweils durch echten Scroll erreicht.
- Genau ein Publish wurde serverseitig abgeschlossen. Nach einem weiteren echten App-Neustart zeigt der Events-Index `Native Publish Journey` sauber als `Veröffentlicht`.
- Der anschliessende Fix bindet den dauerhaften Published-Zustand an die Kombination aus lokalem Root-Status `published` und der serverautoritativen Readiness `ready=false` + `EVENT_STATUS_NOT_DRAFT`. Nach einem frischen App-Prozess-Neustart zeigt auch der direkte SCR-013-Deep-Link den bestehenden Published-Erfolg, ohne Publish-CTA oder zweite Mutation.
- Die finale Outbox ist leer: `Ausstehend: 0`, `Aufmerksamkeit: 0`.

## Historisch verifizierte lokalisierte UI-Texte

Diese Tabelle beschreibt ausschliesslich die damalige Mobile-Darstellung, nicht den unveränderten englischen Server-v1-Vertrag. Aktuelle Typografie und Copy werden nicht aus diesen historischen Frames abgeleitet.

| Vorher                 | Final             |
| ---------------------- | ----------------- |
| Travel / Trip          | Reise             |
| Arrival                | Anreise           |
| Lodging                | Unterkunft        |
| Travel reference       | Reisereferenz     |
| Golf tour              | Golfreise         |
| Golf round             | Golfrunde         |
| Team event / Teamevent | Team-Event        |
| Team activity          | Teamaktivität     |
| Venue                  | Veranstaltungsort |
| EVENT SETUP            | EVENT-SETUP       |

Vorlagen-Zusammenfassungen:

- Reise: `Anreise, Unterkunft und Transport.`
- Golfreise: `Reise, Unterkunft, Transfers, Golfplätze und Runden.`
- Team-Event: `Ort, Agenda, Aktivitäten und Teameinteilung.`

Der technische Satz über die serverseitige Standardkonfiguration wurde aus der UI entfernt. Da nur Datenwerte und UI-Texte geändert wurden, war keine OpenAPI-Schema-Regeneration erforderlich.

## Gerät und Build

Die reproduzierbaren Eckdaten stehen in `build-verification.json`.

- iPhone 16e, iOS 26.2
- 390x844 logisch, 1170x2532 roh
- Debug-Simulator-Build, arm64
- Bundle-ID `app.crew.next.publishfinal`
- signiertes Bundle erfolgreich verifiziert
- ausführbare Datei SHA-256 `9b3a107aec942d2bc94457ba163d3be4869d7715255659a61237a949a7d5b305`
- Content Size nach Abschluss wieder `medium`

Die Routing-Remediation wurde als frischer Build derselben isolierten Bundle-ID geprüft. `build-remediation-verification.json` belegt `BUILD SUCCEEDED`, strikte Codesign-Verifikation, arm64 sowie die ausführbare SHA-256 `3c5182c64898eb180a182c3d72aa67171bc0ecf4a6f055700a68b23068cf1993`.

## Native Ablaufbeweise

Alle 28 XML-Berichte direkt unter `reports/` haben `failures="0"`.

1. Owner-Anmeldung und vier serverseitig erzeugte Recovery-Roots.
2. Vorlage: Auswahl und Übernahme mit den finalen deutschen Vorlagen-Texten.
3. Capability: normal und Large Text, serverseitige Auflösung und erneute Readiness-Prüfung.
4. Ort: Suche, Auswahl und Bindung von `Carya Golf Club` als Hauptort.
5. Erster Offline-Zyklus:
   - Beschreibung und Termine offline gespeichert.
   - echter `terminate`/`launch`.
   - Outbox `1/0`.
   - Reconnect und Sync.
   - DB-Oracle: ein gehashter Device-Stream, Mutation Sequenz 1 `applied`, nächste Sequenz 2.
6. Reinstallation:
   - gleiche Bundle-ID deinstalliert und neu installiert.
   - Keychain-Sitzung führt direkt in den angemeldeten Events-Shell.
   - frischer Events-Index und Root-Snapshot werden vor dem Editor-Zugriff neu aufgebaut.
7. Zweiter Offline-Zyklus:
   - finaler Beschreibungstext offline gespeichert.
   - echter `terminate`/`launch`.
   - Outbox `1/0`.
   - Reconnect und Sync.
   - DB-Oracle: zwei unterschiedliche gehashte Device-Streams; beide Mutation Sequenz 1 `applied`, beide nächste Sequenz 2.
8. Publish-Review normal und `accessibility-extra-large`.
9. Genau eine Veröffentlichung.
10. Read-only Neustart/Refetch im Events-Index mit Status `Veröffentlicht` sowie finale Outbox `0/0`.
11. Nach der Routing-Korrektur: frischer App-Prozess-Neustart, direkter SCR-013-Deep-Link und dauerhafter Published-Zustand ohne Entwurfsblocker, Publish-CTA oder zweite Publish-Mutation.

## Oracles

- `api-oracle-output.json`: Gateway-Status `published`, Version 4, Root-Revision 6.
- `db-oracle-output.json`: vier Root-Aggregate, finale Basiswerte sowie aggregierte Zähler für zwei getrennte Device-Streams und zwei angewandte Receipts; keine stabile Gerätekennung wird persistiert.
- `device-lifecycle-first.json` und `device-lifecycle-second.json`: aggregierter Stream-/Sequenzbeweis ohne stabile Gerätekennung.
- `publish-idempotency-oracle-output.json`: genau ein Published-Event-Change, genau ein `event.published`-Feed-Change und genau ein abgeschlossenes `eventsPublish`-Idempotency-Record mit HTTP 200.
- `reopen-api-oracle-output.json`: der nach dem Reopen gelesene Root ist `published`; die autoritative Readiness ist `ready=false` mit exakt `EVENT_STATUS_NOT_DRAFT` auf `status`.
- `publish-reopen-oracle-output.json`: nach Prozess-Neustart und read-only Reopen weiterhin genau ein Published-Event-Change, ein `event.published`-Feed-Change und ein abgeschlossenes `eventsPublish`-Record für den Root.
- `publish-idempotency-oracle.mjs`, `device-lifecycle-oracle.mjs` und `db-oracle.mjs` brechen bei jeder Abweichung hart ab und akzeptieren nur die isolierte Testdatenbank.

## Visuelle Abnahme

Finale, saubere Screenshots ohne Dev-/Refresh-Overlay:

- `logical/10-template-selected-normal-390x844.png`
- `logical/20-capability-ready-normal-390x844.png`
- `logical/20-capability-ready-large-390x844.png`
- `logical/30-place-selected-normal-390x844.png`
- `logical/41-basics-offline-normal-390x844.png`
- `logical/43-outbox-pending-normal-390x844.png`
- `logical/47-ready-review-normal-390x844.png`
- `logical/47a-ready-review-large-390x844.png`
- `logical/48-published-final-normal-390x844.png`
- `logical/remediation/48b-published-review-reopen-normal-390x844.png`
- `logical/50-reinstalled-current-normal-390x844.png`
- `logical/52-second-restart-normal-390x844.png`

Die zugehörigen 1170x2532-Originale liegen unter `raw/`.

## Superseded Audit-Trail

Die folgenden Artefakte sind absichtlich getrennt und zählen nicht zur finalen Visual- oder Test-Abnahme:

- `reports/superseded/48-publish-post-success-selector.xml`: Der einzige Publish-Tap war bereits erfolgreich; erst der nachgelagerte zu kurze Text-Selektor `Server bestätigt` schlug fehl. API und DB wurden vor jeder weiteren Aktion geprüft.
- `reports/superseded/48-published-review-route-refetch.xml`: Belegt den vor der Korrektur reproduzierten Routing-Fehler. Der gleiche autoritative `EVENT_STATUS_NOT_DRAFT`-Refetch wird im aktuellen Build bewusst zusammen mit dem verifizierten Published-Root als bestehender Erfolg gerendert.
- `raw/superseded/` und `logical/superseded/`: unmittelbare Erfolgsansicht mit blauem RN-Refresh-Overlay; nicht als finale visuelle Abnahme verwendet.

Die damals bindende sanitisierte SCR-013-Abnahme ist `remediation/48b-published-review-reopen-normal-*`; der frühere Events-Index-Beweis bleibt als unabhängige historische Published-Refetch-Abnahme erhalten.

## Code-Gates

- Mobile Publish/Setup: 4 Suites, 29 Tests, alle grün.
- Remediation-Fokus: Publish Screen/View 2 Suites, 22 Tests; einschliesslich servergebundenem Published-Reopen, fehlendem/fremdem/widersprüchlichem Readiness-Nachweis und archiviertem/abgesagtem/unbekanntem Fail-closed-Verhalten.
- Mobile TypeScript: grün.
- Event Service TypeScript: grün.
- Event-Template PostgreSQL-Integration: 6 Tests / 60 Assertions, grün; isolierte temporäre DB entfernt.
- Native Finalberichte: 28/28 grün, jeweils `failures="0"`.
- Native Remediation-Berichte: 12/12 grün, jeweils `failures="0"`; der bindende Reopen-Bericht ist `reports/remediation/48b-published-review-reopen.xml`.
- Docker Compose konnte nicht geprüft werden, da in dieser Umgebung keine Docker-CLI installiert ist.

## Beads

Mit `gastownhall/beads` wurden die erreichten Beweise an folgenden Themen dokumentiert:

- `crew-paq.3.5.4.2`
- `crew-paq.3.5.4.2.1`
- `crew-paq.3.5.4.2.2`

Keines wurde vorschnell geschlossen. `crew-paq.3.5.4.2` dokumentiert nun die behobene Published-Reopen-Route samt negativem Authority-Test und Native-/DB-Beweis. Das Bead bleibt nur für die bereits separat abgegrenzte Conflict-/Full-Release-Matrix in Arbeit; für den Reopen besteht kein offener Produktentscheid mehr.

## Cleanup und Sicherheit

- Test-Bundle deinstalliert; die bestehende Baseline-App `app.crew.next` blieb installiert.
- Isolierte Ports 3000, 3106, 6380, 8085 und 8082 sind frei.
- Der fremde Metro-Prozess auf 8081 blieb unverändert.
- Beide exakt benannten Publish-Testdatenbanken wurden entfernt.
- Temporäre Redis- und DerivedData-Artefakte wurden wiederherstellbar in den Papierkorb verschoben.
- Keine Zugangstoken, Magic Links, DB-Verbindungsstrings, lokalen Benutzerpfade, Simulator-UDIDs, Native-Request-IDs oder stabilen Device-Fingerprints werden im sanitisierten Paket persistiert.
- Kein Commit und kein Push wurde durch diesen Agenten ausgeführt.
