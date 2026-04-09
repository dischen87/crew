# PRD: Scrolling Fix — Alle Devices

**Status:** Implementiert  
**Datum:** 2026-04-09  
**Priorität:** Hoch (Bug-Fix)

---

## Problem

Auf Android-Geräten (Chrome, Samsung Browser) funktioniert das Scrollen auf sämtlichen Pages nicht korrekt. Inhalte werden abgeschnitten oder lassen sich nicht scrollen. Der Grund: Die App nutzte `min-h-screen` als äusseren Container, was auf mobilen Browsern mit dynamischer Adressleiste (die ein- und ausblendet) zu falschen Viewport-Berechnungen führt.

## Root Cause

1. **`min-h-screen` statt fixer Höhe:** Der äussere Container (`App.tsx`) nutzte `min-h-screen flex flex-col`. Da `min-h-screen` = `min-height: 100vh`, kann der Container über den Viewport hinauswachsen. Dadurch greift `overflow-y-auto` auf dem `<main>`-Element nicht, weil der Parent unbegrenzt ist.
2. **`100vh` vs `100dvh`:** Android Chrome ändert die Viewport-Höhe dynamisch (Adressleiste). `100vh` berücksichtigt das nicht, `100dvh` (Dynamic Viewport Height) schon.
3. **Fehlende `min-h-0` auf Flex-Children:** In Flexbox ist der Default `min-height: auto`, was bedeutet, dass ein Flex-Child nicht kleiner als sein Inhalt werden kann. `overflow-y-auto` funktioniert dadurch nicht.
4. **Fehlende Touch-Scrolling Optimierungen:** `-webkit-overflow-scrolling: touch` fehlte für Momentum-Scrolling auf iOS/Android.
5. **`viewport-fit=cover` fehlte:** Nötig für `env(safe-area-inset-*)` auf iOS/Android.

## Änderungen

### 1. `index.html` — Viewport Meta Tag
- **Vorher:** `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- **Nachher:** Zusätzlich `viewport-fit=cover` für korrekte Safe-Area-Insets

### 2. `index.css` — Globale Scroll-Fixes
- `html`, `body`, `#root`: Feste Höhe mit `100dvh` (Fallback `100%`)
- `body`: `overflow-y: hidden` — verhindert Body-Scroll, nur inner Container scrollen
- Globaler CSS-Selektor für alle `overflow-y-auto` / `overflow-y-scroll` Elemente:
  - `-webkit-overflow-scrolling: touch` (Momentum-Scrolling)
  - `overscroll-behavior-y: contain` (verhindert Pull-to-Refresh/Bounce)

### 3. `App.tsx` — Haupt-Layout (Kern-Fix)
- **Äusserer Container:** `min-h-screen` → `fixed inset-0` + `height: 100dvh`
  - Der Container ist jetzt exakt so gross wie der Viewport
  - Flex-Children (Header, Main, Nav) teilen sich den Platz korrekt auf
- **Header:** `sticky top-0` → `shrink-0` (kein Sticky nötig, da nicht im Scroll-Container)
- **Main-Content:** Zusätzlich `min-h-0` — erlaubt dem Flex-Child kleiner als sein Inhalt zu werden, sodass `overflow-y-auto` greift
- **Loading-State:** Ebenfalls `fixed inset-0` + `100dvh`

### 4. `Login.tsx` — Login-Seite
- `min-h-screen` → `minHeight: '100dvh'` (inline Style für dvh-Support)
- Zusätzlich `overflow-y-auto` für lange Formulare (Emoji-Picker)

### 5. `Landing.tsx` — Landing Page
- `min-h-screen` → `minHeight: '100dvh'`
- Zusätzlich `overflow-y-auto` da die Seite mehrere Sektionen hat

### 6. `Profile.tsx` — Profil-Overlay
- Zusätzlich `overscroll-contain` + `height: 100dvh`
- Verhindert, dass Scroll-Events an den darunterliegenden Content durchgereicht werden

### 7. `OnboardingGuide.tsx` — Onboarding-Overlay
- Zusätzlich `height: 100dvh` für konsistente Höhe auf Android

## Betroffene Seiten (Scroll-Verhalten)

| Seite | Scroll-Typ | Fix |
|-------|-----------|-----|
| **Home** | Vertikal (Cards, Leaderboard) | Via App.tsx main container |
| **Golf** | Vertikal (Runden-Liste, Scorecard) | Via App.tsx main container |
| **Leaderboard** | Vertikal (Tabelle, Podium) | Via App.tsx main container |
| **Chat** | Vertikal (Messages, eigener Container) | Bereits `100dvh` |
| **Photos** | Vertikal (Grid) | Via App.tsx main container |
| **More** | Vertikal (Tabs, Flights, Map, etc.) | Via App.tsx main container |
| **Login** | Vertikal (Formular + Emoji-Picker) | Eigener `100dvh` + `overflow-y-auto` |
| **Landing** | Vertikal (Multi-Section Page) | Eigener `100dvh` + `overflow-y-auto` |
| **Profile** | Vertikal (Overlay) | `fixed inset-0` + `100dvh` |
| **GiphyPicker** | Vertikal (GIF-Grid) | Bereits `100dvh` |
| **OnboardingGuide** | Kein Scroll (Step-by-Step) | `100dvh` für Höhe |

## Test-Plan (Staging)

### Geräte-Matrix
- [ ] **Android Chrome** (Samsung Galaxy, Pixel)
- [ ] **Android Samsung Browser**
- [ ] **iOS Safari** (iPhone)
- [ ] **iOS Chrome** (iPhone)
- [ ] **Desktop Chrome**
- [ ] **Desktop Firefox**
- [ ] **Desktop Safari**

### Test-Szenarien pro Page
1. **Home:** Nach unten scrollen bis "Teilnehmer"-Sektion sichtbar, zurück nach oben
2. **Golf:** Runden-Liste scrollen, Scorecard öffnen, alle 18 Löcher durchscrollen
3. **Leaderboard:** Komplette Tabelle scrollen, Podium + Runden-Übersicht sichtbar
4. **Chat:** Messages scrollen, neue Nachricht senden (auto-scroll), GIF-Picker öffnen und scrollen
5. **Photos:** Foto-Grid scrollen, Foto öffnen (Modal)
6. **More:** Zwischen Sub-Tabs wechseln, Flight-Cards scrollen, Location-Map + Liste scrollen, Admin-Panel (lange Liste) scrollen
7. **Login:** Emoji-Picker scrollen, Formular ausfüllen
8. **Landing:** Gesamte Seite durchscrollen (Hero → How → Features → CTA → Footer)
9. **Profile:** Alle Abschnitte scrollen (Avatar, Tee, Details, Logout)

### Spezielle Android-Tests
- [ ] Adressleiste ein-/ausblenden während Scroll
- [ ] Pull-to-Refresh darf NICHT triggern
- [ ] Keyboard-Öffnung (Chat-Input, Login) verschiebt Layout korrekt
- [ ] PWA-Modus (installierte App) — identisches Verhalten

## Technische Details

### `100dvh` Browser-Support
- Chrome 108+ (Android/Desktop)
- Safari 15.4+ (iOS/macOS)
- Firefox 94+
- Fallback: `100%` (via CSS, dvh wird ignoriert falls nicht unterstützt)

### Warum `fixed inset-0` statt `h-screen`?
- `h-screen` = `height: 100vh` → berücksichtigt nicht die dynamische Adressleiste
- `fixed inset-0` + `height: 100dvh` → korrekte Höhe auf allen Devices
- `fixed` verhindert auch Body-Scroll, was zusätzliche Sicherheit bietet
