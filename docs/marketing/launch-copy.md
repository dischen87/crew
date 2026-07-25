# Crew Next Launch Copy

- Status: Launch-ready copy with internal claim gates
- Datum: 2026-07-20
- Bead: `crew-8pe` (Refresh von `crew-paq.10.3`)
- Claim-Reconciliation: `crew-paq.10.10`
- Contract alignment: `crew-paq.4.8`
- Positionierung: [Crew Next Positionierung](./positioning.md)
- Produktbasis: [Organizer- und Participant-Journeys](../product/organizer-participant-journeys.md), [Mobile Screen Inventory](../product/figma-screen-inventory.md)

## Verwendung und Claim-Gates

Die Texte innerhalb der Copy-Blöcke sind kundengerichtet. Angaben wie
`[P-MOBILE]` sind interne Freigabehinweise und werden nie veröffentlicht.

Option 2 (`Crew Board`) ist die verbindliche visuelle Richtung für alle
nativen Produkt- und Launch-Flächen. Frühere Alternativen dürfen weder gewählt
noch mit Option 2 gemischt werden.

| Gate             | Bedeutung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[I-BACKEND]`    | Backend-Grundlage ist im Repository implementiert und getestet; keine Aussage über Release oder Kundenerlebnis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `[P-MOBILE]`     | Lokale iOS-/Android-Release-Builds und fail-closed Runtime-Konfiguration sind belegt, aber nur mit Dokumentations-`.invalid` und ohne Live-Gateway. Die Design-2-`PrivateUnavailable`-Recovery besitzt lokale iOS-/Android-Interaktions-Evidence; sie ist nicht deployed oder Store-ready, Android-TalkBack-Sprachausgabe und vollständige App-Data-Bytegleichheit sind nicht belegt. Erst nach release-signierten Artefakten, Gateway-only-Netzwerktrace, Accessibility- und vollständiger Journey-Evidence veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `[P-PUBLISH]`    | Backend-, Gateway- und Mobile-Client-Verträge sowie der produktiv geroutete native Option-2-Flow `SCR-013` sind implementiert. Fehlende Grunddaten und verbindliche Template-/Capability-/Ort-Blocker besitzen code- und test-current Bearbeitungswege. Erst nach nativem Device-Review-/Publish-Beleg sowie participant-sichtbarem service-backed E2E-, Stale- und Recovery-Beleg veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `[P-OFFLINE]`    | Erst nach Airplane-Mode, Force-quit, Reconnect, Duplikat-, Tombstone- und Konfliktbeleg auf beiden Plattformen veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `[P-GOLF]`       | Round-Setup, actor-gebundene Scores, Stableford, rollenreduzierter Sync, SQLite und ein API-only Turkey-Fixture sind Engineering-Current. Die Design-2-Scorekarte belegt auf dem iPhone 16e Queueing, Konfliktvergleich/Requeue, read-only Ranking, Scrollen und Accessibility Large. Ein lokaler Android-Release-shaped Service-Lauf belegt 503, Prozess-Neustart, verlorene Erfolgsantwort, identischen Replay, exakt eine Servermutation und konvergente Projektionen; APK und Gateway blieben lokal, ohne Distribution-, Deployment- oder Store-Beleg. Feature-Copy erst nach vollständiger iOS-/Android-Journey- und Accessibility-Parität, zweimal idempotent gelaufenem vollständigem Golf-Fixture, Deployment und Release veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `[P-TEAM]`       | Autoritative Team-Flows und die produktiv gerouteten Design-2-Flächen `SCR-032/033` sind code-/test-current; iPhone-Evidence deckt die 390 × 844-Flächen ab. Der gemeinsame `ScreenFrame`-Inset-Fix hält den Android-TeamFeed-Composer in lokaler API-36-ReleaseEvidence bei 2,0-Schrift vollständig über der IME und macht den Submit nach normalem Scrollen erreichbar. `crew-paq.8.2.2.3` ist geschlossen. Der dokumentierte Green-Stand mit 63 Suites, 514 Tests, TypeScript, Lint und Prettier stammt vom 20. Juli 2026 und ist kein Current-Tree-Zähler; der aktuelle Tree wird vor Freigabe vollständig neu geprüft. Native Attention-, Live-Announcement- und Custom-Action-Ausführung fehlen weiterhin. Feature-Copy erst nach geschlossenem Gate, vollständigem Rollen-/Konflikt-/Accessibility-Beleg und zweimal idempotent gelaufenem Team-Fixture veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `[P-ENRICHMENT]` | Budgetierter asynchroner Worker sowie Select-, Status- und Retry-Verträge sind in Backend, Gateway und generiertem Mobile-Client implementiert. Feature-Copy erst nach deploytem und überwachtem Worker-/Provider-Betrieb, nativer Fläche sowie Offline-/Device-E2E veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `[P-FEEDBACK]`   | Backend, Gateway, Mobile-Client, SQLite und die produktiv gerouteten Design-2-Flows sind implementiert; Diagnose- und Screenshot-Consent sind getrennt und standardmässig aus. Der frühere iOS-/Android-Replay bleibt eingefrorene historische Evidence; seine Manifeste sind wegen späterer Cleanup-/Retry-Fixes kein Current-Tree-Source-Manifest. Neu belegt ein frischer, non-debuggable, lokal mit Repository-Debug-Zertifikat v2/v3 signierter Android-`releaseEvidence`-Build den vollständigen App-Pfad über Produktions-Screen, verschlüsselte SQLite, `FeedbackSubmissionController`, `FeedbackDeliveryPump`, Gateway und Event Service. Nur der etablierte isolierte Loopback-Gateway-, Request-ID- und Fixture-Bootstrap-Harness ist evidence-spezifisch; Feedback-Runtime, Controller, Queue, Secure UUID und Default-SHA blieben unverändert. Der Lauf ergab exakt `503/503/503/201`, über vier Requests stabile Fingerprints, keinen fünften Cold-Start-Resend und DB-Aggregate `1/1/0/0/1`. Damit ist der Android-Akzeptanzbeleg vollständig; `crew-paq.3.10` ist geschlossen. Normal Release bleibt unverändert HTTPS-only und fail-closed; lokale Signatur und Loopback-Harness belegen weder Shipping-Konfiguration noch Distribution, Deployment oder Store-Release. Retry-Timer (`crew-paq.6.2.5`) und exakte Behandlung von `409 IDEMPOTENCY_IN_PROGRESS` (`crew-paq.6.2.6`) sind geschlossen. Der dokumentierte Green-Stand mit 63 Suites und 514 Tests stammt vom 20. Juli 2026 und ist kein Current-Tree-Zähler; der aktuelle Tree wird vor Freigabe vollständig neu geprüft. Community-Writes bleiben online-only. Feature-Copy erst nach vollständiger nativer Large-Text-/Device-, service-backed Screenshot-Recovery-, deployter Runtime- und Launch-Evidence veröffentlichen. |
| `[P-RECAP]`      | Title-only und exact-field Backend-/Gateway-/Mobile-Verträge, account-/root-isolierter SQLite-Cache und bounded 90-Tage-Metadaten-Retention sind repository-getestet. Design-2 besitzt exakte Body- und Caption-Text-Vorschau/Auswahl sowie servereigene Autor-/Manager-Entscheide; Caption-Refs sind frei von internen IDs, opaque und nur für die Sitzung verfügbar; Medienmetadaten enthalten sie nicht. Caption-Text ist server-default-off und darf erst nach Privacy-/Legal-Freigabe sowie Device-/Release-Evidence aktiviert werden; Attachment-Bytes, Medien-URLs und identifizierbare Medien bleiben verboten. Die bestehende iOS-Release-shaped Matrix belegt Body-Rollen/Grant/Withdrawal/Drift mit Fixtures, nicht den neuen Caption-Devicepfad oder ein deploytes Backend. Participant-Sharing, Provenance und interne IDs bleiben verboten. Deployment, öffentlicher Consumer, real service-backed Rollen-/Removal-/Recovery-E2E und Android-Parität fehlen. Keine Acquisition-Copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `[P-RELEASE]`    | Konfigurierte und fail-closed iOS-/Android-Release-Builds sind lokal belegt. Die verwendete `https://gateway.staging.example.invalid` ist nur eine reservierte Dokumentations-Origin; Android-Smokes wurden ausschliesslich lokal mit dem Debug-Key signiert. Erst nach Crew-eigener Release-Signatur, freigegebenem Produktions-HTTPS-Gateway, deploytem/authentifiziertem Smoke sowie Store- und Operations-Freigabe veröffentlichen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Solange `[P-MOBILE]` oder `[P-PUBLISH]` offen ist, darf nur die
Closed-Preview-Fassung live gehen.
Place-Enrichment- und Feedback-Feature-Copy bleibt zusätzlich hinter
`[P-ENRICHMENT]` beziehungsweise `[P-FEEDBACK]`.
App-Store-Metadaten bleiben bis zur Erfüllung ihrer Gates Entwurf.

## Landingpage

### Closed Preview – jetzt zulässige Fassung

**DE**

> **Eyebrow:** CREW NEXT · CLOSED PREVIEW
>
> **Headline:** Der gemeinsame Plan für eure Gruppe.
>
> **Text:** Crew Next wird für Golfreisen und Team-Events entwickelt. Ein
> mobiles Zuhause soll Organisator:innen und Teilnehmer:innen zeigen, was jetzt
> und als Nächstes zählt.
>
> **CTA:** Closed Preview anfragen

**EN**

> **Eyebrow:** CREW NEXT · CLOSED PREVIEW
>
> **Headline:** One shared plan for your group.
>
> **Text:** Crew Next is being built for golf trips and team events. One mobile
> home is designed to show organizers and participants what matters now and
> next.
>
> **CTA:** Request closed preview

Der CTA benötigt einen realen, datenschutzgeprüften Kontaktweg; ohne ihn bleibt
die Fläche unveröffentlicht.

**Repository-Stand 2026-07-20:** `apps/web` setzt diese Fassung als lokale,
script-freie Option-2-Closed-Preview in `de-CH` um. Der statische Build emittiert
nur die Preview-Seite; der alte Join-Pfad liefert `404`. Die Route bleibt
`noindex`, und ohne konfigurierte absolute HTTPS-Kontaktadresse ist der CTA
bewusst deaktiviert. Browser-renderte Mobile-/Desktop-, Fokus-,
Reduced-Motion- und 200%-Zoom-QA ist lokal bestanden. Ein datenschutzgeprüfter
Kontaktweg, Deployment-/Live-Evidence und eine Analytics-/Consent-Entscheidung
fehlen weiterhin. Die Fassung oben ist damit **in Code und Copy vorhanden,
aber nicht publikationsfreigegeben**; sie
belegt weder Preview-Conversion noch Next-Analytics.

### Launch-Fassung

**Freigabe:** `[P-MOBILE]`, `[P-PUBLISH]`, `[P-GOLF]`, `[P-TEAM]`;
Offline-Abschnitt zusätzlich `[P-OFFLINE]`.

#### Hero

**DE**

> **Eyebrow:** CREW NEXT
>
> **Headline:** Der gemeinsame Plan für eure Gruppe.
>
> **Text:** Plane Golfreisen und Team-Events, lade alle gezielt ein und halte
> Änderungen dort fest, wo sie hingehören. Jede Person sieht, was für sie jetzt
> und als Nächstes zählt.
>
> **CTA:** Event erstellen

**EN**

> **Eyebrow:** CREW NEXT
>
> **Headline:** One shared plan for your group.
>
> **Text:** Plan golf trips and team events, invite people with the right role,
> and keep changes where they belong. Everyone sees what matters to them now
> and next.
>
> **CTA:** Create event

#### Ein Kern, zwei konkrete Eventformen

**DE**

> **Golfreise:** Reise, Unterkunft, Transfers und Runden werden zu einem
> verständlichen Ablauf für die ganze Crew.
>
> **Team-Event:** Agenda, Sessions und Aktivitäten nutzen denselben klaren Kern –
> ohne Golf- oder Reisezwang.

**EN**

> **Golf trip:** Travel, accommodation, transfers, and rounds become one clear
> schedule for the whole crew.
>
> **Team event:** The agenda, sessions, and activities use the same clear core—
> without forcing travel or golf concepts.

#### Organisieren und teilnehmen

**DE**

> **Für Organisator:innen:** Beginne mit einer passenden Struktur, veröffentliche
> den aktuellen Plan und teile Änderungen im richtigen Zusammenhang.
>
> **Für Teilnehmer:innen:** Öffne das Event und sieh sofort den nächsten
> relevanten Schritt.

**EN**

> **For organizers:** Start with a useful structure, publish the current plan,
> and share changes in the right context.
>
> **For participants:** Open the event and see the next relevant step.

#### Private Crew-Kommunikation

**DE**

> Community bedeutet bei Crew die geschlossene Kommunikation innerhalb eines
> Events. Updates und erlaubte Beiträge bleiben bei der jeweiligen Crew; es gibt
> keinen öffentlichen oder eventübergreifenden Feed.

**EN**

> Community in Crew means private communication inside one event. Updates and
> permitted contributions stay with that event's crew; there is no public or
> cross-event feed.

#### Ehrlicher Status bei schwacher Verbindung

**DE**

> Bereits synchronisierte Inhalte bleiben lesbar. Wenn du etwas änderst, zeigt
> Crew klar: gespeichert, vorgemerkt, benötigt Aufmerksamkeit oder
> synchronisiert. Keine lokale Änderung wird als zugestellt ausgegeben.

**EN**

> Previously synced content stays readable. When you make a change, Crew clearly
> shows whether it is saved, queued, needs attention, or is synced. A local
> change is never presented as delivered.

#### Abschluss

**DE**

> **Headline:** Startet mit einem gemeinsamen Plan.
>
> **CTA:** Event erstellen

**EN**

> **Headline:** Start with one shared plan.
>
> **CTA:** Create event

Hero und Abschluss verwenden bewusst denselben einzigen CTA.

## App Store

### Aktuelle Apple-Grenzen

| Feld             |                                                                                   Limit | Offizielle Quelle                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name             |                                                                            2–30 Zeichen | [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)                                                                                              |
| Subtitle         |                                                                              30 Zeichen | [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)                                                                                              |
| Promotional Text |                                                                             170 Zeichen | [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)                                                                    |
| Description      |                                                               4.000 Zeichen, Plain Text | [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)                                                                    |
| Keywords         | 100 Bytes; Komma ohne Leerzeichen; keine Wiederholung aus Name, Subtitle oder Kategorie | [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [App Store search](https://developer.apple.com/app-store/search/) |

**Freigabe aller Metadaten:** `[P-MOBILE]`, `[P-PUBLISH]`, `[P-GOLF]`,
`[P-TEAM]`, `[P-RELEASE]`; die Offline-Passage der Description zusätzlich
`[P-OFFLINE]`.

Englische Metadaten werden erst nach englischem Runtime-, Device- und
Locale-Evidence freigegeben. Bis dahin bleibt der Storefront-Launch deutsch.

### Deutsch

| Feld             | Copy                                                                                                                                                        |             Länge |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: |
| Name             | `Crew Next`                                                                                                                                                 |    9 / 30 Zeichen |
| Subtitle         | `Events gemeinsam organisieren`                                                                                                                             |   29 / 30 Zeichen |
| Promotional Text | `Golfreise oder Team-Event: Crew hält den gemeinsamen Ablauf und die nächsten Schritte für Organisator:innen und Teilnehmer:innen in einem Event zusammen.` | 153 / 170 Zeichen |
| Keywords         | `golfreise,teamreise,offsite,agenda,ablauf,einladung,teilnehmer,reisegruppe,eventkoordination`                                                              |    92 / 100 Bytes |

**Description – 908 / 4.000 Zeichen**

```text
Crew Next gibt eurer Gruppe einen gemeinsamen, aktuellen Plan.

Als Organisator:in startest du mit einer passenden Struktur für eine Golfreise oder ein Team-Event, ergänzt Ablauf und Einladungen und veröffentlichst Änderungen dort, wo sie hingehören.

Als Teilnehmer:in siehst du, was jetzt und als Nächstes zählt. Du öffnest den Plan, beantwortest relevante Anfragen und teilst erlaubte Beiträge im Kontext des Events.

Bereits synchronisierte Inhalte bleiben bei schwacher Verbindung lesbar. Bei Änderungen zeigt Crew ehrlich, ob sie gespeichert, vorgemerkt, zu prüfen oder synchronisiert sind. Konflikte überschreiben keine Version still.

Eine Golfreise kann Reise, Unterkunft, Transfers und Runden abbilden. Ein Team-Event nutzt denselben Kern für Agenda, Sessions und Aktivitäten – ohne Golf- oder Reisezwang.

Crew koordiniert das Gruppenerlebnis. Buchung, Ticketing und Zahlungen gehören nicht zu v1.
```

### English

| Field            | Copy                                                                                                                            |               Length |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------: |
| Name             | `Crew Next`                                                                                                                     |    9 / 30 characters |
| Subtitle         | `Plan group events together`                                                                                                    |   26 / 30 characters |
| Promotional text | `Golf trip or team event: Crew keeps the shared schedule and next steps for organizers and participants together in one event.` | 125 / 170 characters |
| Keywords         | `golftrip,offsite,agenda,schedule,invitation,participant,retreat,travelgroup,coordination`                                      |       88 / 100 bytes |

**Description – 848 / 4,000 characters**

```text
Crew Next gives your group one shared, current plan.

As an organizer, start with a useful structure for a golf trip or team event, add the schedule and invitations, and publish changes where they belong.

As a participant, see what matters now and next. Open the plan, answer relevant requests, and share permitted contributions in the context of the event.

Previously synced content stays readable when connectivity is poor. When something changes, Crew clearly shows whether it is saved, queued, needs attention, or is synced. Conflicts never overwrite a version silently.

A golf trip can cover travel, accommodation, transfers, and rounds. A team event uses the same core for its agenda, sessions, and activities—without forcing travel or golf concepts.

Crew coordinates the group experience. Booking, ticketing, and payments are outside v1.
```

## Einladungs- und Share-Nachrichten

Platzhalter werden vor dem nativen Share-Sheet mit bereits autorisierten,
sicheren Werten ersetzt. Invite-Token erscheinen nur in `{inviteUrl}` und nie
in Analytics, Logs oder Preview-Texten.

### Organizer lädt ein

**Freigabe:** `[P-MOBILE]`.

**DE**

```text
Einladung zu {eventTitle}

Du bist als {roleLabel} zu {eventTitle}{dateClause} eingeladen. Öffne Crew, prüfe die Angaben und entscheide, ob du beitreten möchtest.

Event öffnen: {inviteUrl}
```

**EN**

```text
Invitation to {eventTitle}

You’re invited to {eventTitle}{dateClause} as {roleLabel}. Open Crew, review the details, and decide whether to join.

Open event: {inviteUrl}
```

Einziger CTA: `Event öffnen` / `Open event`.

### Organizer teilt einen veröffentlichten Plan

**Freigabe:** `[P-MOBILE]`, `[P-PUBLISH]`; Link nur für aktuell berechtigte
Mitglieder.

**DE**

```text
Der Plan für {eventTitle} ist veröffentlicht. Öffne ihn in Crew und sieh, was für dich als Nächstes zählt.

Plan öffnen: {eventUrl}
```

**EN**

```text
The plan for {eventTitle} is published. Open it in Crew to see what matters to you next.

Open plan: {eventUrl}
```

Einziger CTA: `Plan öffnen` / `Open plan`.

### Organisator:in teilt einen freigegebenen Rückblick

**Freigabe:** `[P-RECAP]`; Backend und Verträge können einen siebentägigen
title-only oder exact-field Link nur für Owner oder Organizer nach bestätigter
Online-Antwort erstellen und widerrufen. Die folgende Nachricht bleibt
Entwurfs-Copy: `crew-paq.2.15.4.3.2`, `.4` und `.5` sind geschlossen. Die
Design-2-Fläche konsumiert das servereigene, reloadbare
`externalConsent`-Read-Model fail-closed und zeigt Autor-/Manager-Aktionen nur
aus `actorCanDecide`; seine Caption-Refs sind frei von internen IDs, opaque und
nur für die Sitzung verfügbar. Eine isolierte iOS-Release-shaped Fixture-Matrix belegt
Grant, Withdrawal, Rollen und Drift. Ein deployter öffentlicher Consumer,
Privacy-/Legal-Freigabe, real service-backed Device-/Plattform-E2E und
Android-Parität bleiben unbelegt, deshalb bleibt die Nachricht gesperrt.

**DE**

```text
Hier ist der freigegebene Rückblick auf {eventTitle}.

Rückblick ansehen: {recapUrl}
```

**EN**

```text
Here’s the published recap of {eventTitle}.

View recap: {recapUrl}
```

Einziger CTA: `Rückblick ansehen` / `View recap`.

Participants erhalten bewusst keine Invite- oder Recap-Share-Copy: In v1
erstellen nur Owner und Organizer Einladungen und externe Rückblicklinks.
Participant-Sharing ist in der aktuellen
[External-Recap-Consent-Policy](../product/external-recap-consent-policy.md) und
im Vertrag nicht erlaubt. Exact-version Event-/Feed-Bodies und Caption-Text sind
im Backend nur mit den erforderlichen Feld- und Autoritätsgrants test-current;
Caption-Text bleibt server-default-off, Medien bleiben verboten und Provenance
bleibt vertragsgemäss ausgeschlossen.
Privacy-/Legal-Approval, Deployment und ein öffentlicher Consumer sind nicht
belegt — `crew-paq.2.15.4`.

## Onboarding und First-Event-Aktivierung

**Freigabe:** `[P-MOBILE]`; Startformen zusätzlich `[P-GOLF]` und `[P-TEAM]`.

Die erste Aktivierung ist erreicht, wenn ein benanntes Event mindestens einen
relevanten Planpunkt hat und der Owner die teilnehmergetreue Vorschau erreicht.
Das ist eine zu testende Produktdefinition, kein belegter Activation-Uplift.

| Surface           | DE                                                                                                                                            | EN                                                                                                                               | Einziger CTA                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Welcome           | **Ein Plan für eure Gruppe.** Erstelle dein erstes Event und gib allen denselben Ausgangspunkt.                                               | **One plan for your group.** Create your first event and give everyone the same starting point.                                  | `Event erstellen` / `Create event`       |
| Starting shape    | **Womit startet ihr?** Wähle Golf-Tour, Team-Event oder einen leeren Entwurf. Vor der Veröffentlichung prüft Crew alle verbindlichen Angaben. | **What are you planning?** Choose a golf trip, team event, or blank draft. Before publishing, Crew checks every required detail. | `Dieses Setup nutzen` / `Use this setup` |
| Event details     | **Macht das Event erkennbar.** Name, Zeitzone und optionale Daten geben der Crew den richtigen Kontext.                                       | **Make the event recognizable.** A name, time zone, and optional dates give the crew the right context.                          | `Details speichern` / `Save details`     |
| Empty plan        | **Was passiert zuerst?** Füge den ersten Tag, die erste Runde, Session oder Aktivität hinzu.                                                  | **What happens first?** Add the first day, round, session, or activity.                                                          | `Zum Plan hinzufügen` / `Add to plan`    |
| Activation review | **Sieh es wie deine Crew.** Prüfe den Plan aus Teilnehmerperspektive, bevor du jemanden einlädst.                                             | **See it as your crew will.** Review the plan from a participant’s perspective before inviting anyone.                           | `Event prüfen` / `Review event`          |
| Invite readiness  | **Bereit für deine Crew.** Erstelle eine Einladung mit der passenden Rolle.                                                                   | **Ready for your crew.** Create an invitation with the right role.                                                               | `Einladung erstellen` / `Create invite`  |

## Kleine A/B-Testmenge

Nur eine Variable pro Test ändern; CTA und Zielroute bleiben gleich.

### A/B 1 – Landingpage-Hero

**Gate:** `[P-MOBILE]`, `[P-PUBLISH]`, `[P-GOLF]`, `[P-TEAM]`, entsprechend
der Launch-Fassung. Vorher darf nur die Closed-Preview-Fassung mit ihrem
Preview-CTA getestet werden.

| Variante             | DE                                       | EN                                      | CTA                                |
| -------------------- | ---------------------------------------- | --------------------------------------- | ---------------------------------- |
| A – gemeinsamer Plan | `Der gemeinsame Plan für eure Gruppe.`   | `One shared plan for your group.`       | `Event erstellen` / `Create event` |
| B – now/next         | `Was jetzt zählt. Und was danach kommt.` | `What matters now—and what comes next.` | `Event erstellen` / `Create event` |

Primärsignal: korrekte Kategorie- und Nutzenwiedergabe im Fünf-Sekunden-Test;
Conversion ist sekundär, solange Traffic und Produktreife niedrig sind.

### A/B 2 – App-Store-Subtitle

**Gate:** `[P-MOBILE]`, `[P-PUBLISH]`, `[P-GOLF]`, `[P-TEAM]`, entsprechend
dem Gate aller App-Store-Metadaten.

| Variante            |                              DE |   Länge | EN                           |   Länge |
| ------------------- | ------------------------------: | ------: | ---------------------------- | ------: |
| A – Kategorie       | `Events gemeinsam organisieren` | 29 / 30 | `Plan group events together` | 26 / 30 |
| B – Kernversprechen |      `Ein Plan für eure Gruppe` | 24 / 30 | `One plan for your group`    | 23 / 30 |

Primärsignal: Product-Page-Conversion; vorher prüfen, dass Variante B zusammen
mit Name und Screenshots die Event-Kategorie noch eindeutig vermittelt.

### A/B 3 – Welcome

**Gate:** `[P-MOBILE]`.

| Variante      | DE                                         | EN                                    | CTA                                |
| ------------- | ------------------------------------------ | ------------------------------------- | ---------------------------------- |
| A – Gruppe    | `Ein Plan für eure Gruppe.`                | `One plan for your group.`            | `Event erstellen` / `Create event` |
| B – Organizer | `Beginne mit dem Plan, den alle brauchen.` | `Start with the plan everyone needs.` | `Event erstellen` / `Create event` |

Primärsignal: Anteil der qualifizierten Organizer, die `Starting shape` erreichen;
Abbruch und Fehlklicks bleiben Guardrails.

## Publish-Check

Vor Veröffentlichung jeder Fläche:

1. Gate-Labels entfernen, aber nur nach verlinktem Evidence-Paket.
2. Genau einen CTA und eine Zielroute bestätigen.
3. Golf- und Team-Copy gegen die tatsächlich ausgelieferten Verticals prüfen.
4. Offline-Sätze gegen reale iOS-/Android-Aufnahmen und Delivery-State-Texte
   prüfen.
5. App-Store-Längen erneut in Unicode-Zeichen beziehungsweise Keyword-Bytes
   messen und Metadaten auf Apple-Policy-Änderungen prüfen.
6. Invite- und Share-Links mit Cold, Warm, Signed-out, Offline, Revoked und
   Denied testen; keine Secrets in Preview, Analytics oder Logs.
7. Für jede Publish-Aussage `[P-PUBLISH]` gegen Readiness, versionierten
   Publish-Übergang und participant-sichtbaren Gateway-E2E-Beleg prüfen.
