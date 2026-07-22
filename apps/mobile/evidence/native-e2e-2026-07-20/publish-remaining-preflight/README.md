# Publish remaining native preflight — historical static harness

Status: **HISTORISCHER STATISCHER HARNESS; KEINE AKTUELLE ACCEPTANCE.** Die
statische Allowlist startet selbst keine Ports, Datenbanken, Runner,
Simulatoren oder Apps. Das vorhandene `runtime/` stammt aus einem späteren,
partiellen Diagnoselauf, enthält auch einen fehlgeschlagenen Bericht und ist
weder Teil von `SHA256SUMS` noch commitwürdige Evidence. Die aktuelle bindende
lokale Acceptance ist separat unter
`../../native-e2e-2026-07-22/publish-remaining-final` eingefroren und
abschlussauditiert.

`preflight-gates.json` bewahrt die ursprünglichen Gates vom 20. Juli als
historischen Snapshot und protokolliert zusätzlich den portfreien statischen
Re-Audit vom 22. Juli: 24 Maestro-YAMLs geparst, beide Oracle-Entrypoints mit
Node geprüft und für Bun gebündelt, Runner-Guard-Suite 18 Pass/1
umgebungsbedingter Skip sowie Biome ohne Befund. `SHA256SUMS` bindet exakt die
28 statischen Nutzdateien; die Hashliste selbst und `runtime/` sind
ausgeschlossen.

## Verbleibende Acceptance-Matrix

| Bereich               | Bindender Native-Beweis                                                                                                                                                                                  | Oracle                                                                                             | Bead                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| Template Large Text   | `10-template-large.yaml`: SCR-013 -> Template-Recovery, alle drei Vorlagen, Auswahl und versionierte Übernahme bei `accessibility-extra-large`                                                           | bestehender `publish-native-success-final/control.mjs state` plus DB-Oracle `roles-active`         | `.2.1`, `.2.1.2`       |
| Place Large Text      | `20-place-large.yaml`: Suche, Carya-Auswahl und Hauptort-Bindung bei `accessibility-extra-large`                                                                                                         | bestehender API-/DB-Root-Orakelstand                                                               | `.2.1`, `.2.1.2`       |
| Setup offline/restart | `30-setup-cache-online.yaml`, echter Prozess-Neustart, `31-setup-cached-restart.yaml`, Reconnect und `32-setup-online-recovery.yaml`                                                                     | UI beweist nur gespeicherten Kontext, ausschliesslich Refresh-CTA und danach autoritativen Refetch | `.2.1`, `.2.1.2`       |
| Basics Large Text     | `40-basics-large.yaml`: gesamtes bestehendes Formular und beide Aktionen scrollbar bei `accessibility-extra-large`                                                                                       | keine Mutation; View-/Screen-Gates                                                                 | `.2.2`                 |
| Basics-Konflikt       | `41`–`44`: offline lokale Wahrheit, externer produktiver PATCH, `VERSION_CONFLICT`, beide Wahrheiten und versionierte Recovery                                                                           | `event-db-oracle.mjs basics-conflict` und `basics-recovered`                                       | `.2`, `.2.2`           |
| Publish-Konflikt      | `45`–`47`: geprüfter ready Stand; exakter One-shot-Barrier nach Attempt-Persistenz; produktiver Beschreibung-Entzug; freigegebener echter `eventsPublish`-409; beide Wahrheiten; sichere Basics-Recovery | `event-db-oracle.mjs publish-conflict` und `publish-recovered`; kein erfolgreicher Publish-Record  | `.2`, `.2.2`           |
| Rollen                | produktive Einladungen für Organisator:in, Teilnehmer:in und Betrachter:in; `93-manager-positive.yaml`, `94-denied-routes.yaml` für beide Read-only-Rollen                                               | `control.mjs role-oracle active`, DB `roles-active`                                                | `.2`, `.2.1.2`, `.2.2` |
| Membership loss       | Organisator:in zunächst mit echten Controls, danach produktives Membership-Remove und `95-membership-loss.yaml` aus derselben Sitzung                                                                    | `control.mjs role-oracle organizer-removed`, DB `organizer-removed`                                | `.2`, `.2.1.2`, `.2.2` |

## Feste Runtime-Grenzen nach Portfreigabe

- isolierte App-ID: `app.crew.next.publishremaining`
- iPhone 16e, iOS 26.2, 390x844; Large Text exakt `accessibility-extra-large`
- isolierte Event-DB: `crew_native_e2e_event_test_publish_remaining_0720`
- isolierte User-DB: `crew_native_e2e_user_test_publish_remaining_0720`
- vorhandener produktiver Gateway/User/Event-Runner; nur der Evidence-Harness besitzt einen fail-closed Control-Barrier, Produkt-Service-Routen und UI-State bleiben unverändert
- `publish-native-success-final/control.mjs setup` und `prepare` erzeugen die vier bekannten Roots; dieses Paket ergänzt ausschliesslich einen blanken Rollen-Setup-Root und produktive Memberships
- Bearer, Magic Links, Sessions und Einladungstoken bleiben nur im Prozessspeicher

## Deterministische Reihenfolge

1. Runner auf den beiden exakten Datenbanken starten, danach bestehendes `setup` und `prepare` ausführen. Die Owner-App meldet sich ausschliesslich über `91-sign-in-request` mit `crew.local@example.test`, `control.mjs open-delivered owner` und `92-session-ready` an.
2. Content Size `accessibility-extra-large`: `10-template-large`, `20-place-large`, `40-basics-large`; saubere Raw-/390x844-Screenshots erfassen und visuell prüfen.
3. Content Size `medium`: `30-setup-cache-online`; Transport detach; echter App-`terminate`/`launch`; `31-setup-cached-restart`; Transport attach; `32-setup-online-recovery`.
4. Transport detach; `41-basics-conflict-queue`; echter Neustart; `42-basics-conflict-restart`; Transport attach; `control.mjs bump-basics-conflict`; `43-basics-conflict-visible`; DB `basics-conflict`; `44-basics-conflict-recover`; DB `basics-recovered`.
5. `45-publish-ready`; `control.mjs arm-publish-barrier`; `46-publish-conflict-visible` starten, sodass die App den Attempt persistiert und der echte `eventsPublish` den Barrier erreicht. Parallel `control.mjs drift-publish-conflict`: Der Befehl wartet auf `reached`, führt erst dann den produktiven Beschreibung-PATCH aus und gibt danach exakt den gehaltenen Request frei. `46` muss mit dem echten Gateway/Event-Service-409 abschliessen; danach DB `publish-conflict`, `47-publish-conflict-recover`, DB `publish-recovered`. Bei jedem Orchestrierungsfehler `control.mjs cancel-publish-barrier`; der gehaltene Request endet dann fail-closed mit 503 und wird nie weitergeleitet.
6. Erst nach den revisionsgenauen Konflikt-Oracles `control.mjs prepare-roles`; dadurch verändern Memberships die erwarteten Revisionen 3–7 nicht vorzeitig. Danach `role-oracle active` und DB-Phase `roles-active`.
7. Für jeden Rollenwechsel ausschliesslich `90-logout`, `91-sign-in-request` mit der festen Fixture-Adresse, `control.mjs open-delivered <role>`, `92-session-ready`.
8. Organisator:in: `93-manager-positive`; danach `control.mjs remove-organizer`, `95-membership-loss`, API-/DB-Oracles.
9. Teilnehmer:in und Betrachter:in jeweils separat mit `94-denied-routes`; API-Oracle erwartet auf beiden Roots exakt HTTP 403, nicht 404.
10. App deinstallieren, Content Size `medium`, alle exakt isolierten Prozesse/DBs entfernen, Fremdprozesse unberührt lassen und erst dann Evidence-Hashes erzeugen.

## Abnahmegrenzen

- Die YAMLs enthalten keine Fixture-State-Selektion und keine versteckte Session-Umschaltung.
- Konflikte entstehen über echte Offline-Outbox plus produktive Gateway-PATCH-/Publish-Operationen.
- Der Barrier matcht nur `POST /core/v1/event-roots/evt_publish_basics_final/publish` plus `crew-e2e.ios`, hält keine Request-, Header-, Body-, Token- oder Idempotency-Daten und synthetisiert keinen Konfliktstatus.
- Teilnehmer:in/Betrachter:in erhalten Root-Mitgliedschaft, aber niemals Manager-Readiness oder Write-Controls. Ein entfernter Organizer wird tenant-concealed mit 404.
- Dieses Paket schliesst kein Bead. Schliessen erst nach ausgeführten Native-Berichten, visueller Raw-Prüfung, Oracles, Full Gates und Cleanup.
