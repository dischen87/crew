# CREW — App Store / TestFlight Distribution

Dieses Projekt verwendet **Capacitor** um die bestehende React Web-App als native iOS-App zu verpacken. Damit kann die App via **TestFlight** an Tester verteilt und anschliessend im **App Store** veröffentlicht werden.

---

## Voraussetzungen

| Was                      | Details                                              |
|--------------------------|------------------------------------------------------|
| **Mac mit Xcode**        | Xcode 15+ (kostenlos im Mac App Store)               |
| **Apple Developer Account** | $99/Jahr — [developer.apple.com](https://developer.apple.com) |
| **Node.js / Bun**       | Bereits im Projekt vorhanden                         |
| **CocoaPods**            | `sudo gem install cocoapods` (einmalig)              |

---

## Schnellstart (5 Schritte)

### 1. iOS-Projekt generieren

```bash
cd packages/web

# Web-App bauen & iOS-Projekt erstellen
bun run native:build

# Falls noch kein ios/ Ordner existiert:
bun run native:init
bun run native:sync
```

### 2. Xcode-Projekt öffnen

```bash
bun run native:open
```

Dies öffnet `packages/web/ios/App/App.xcworkspace` in Xcode.

### 3. In Xcode konfigurieren

1. **Signing & Capabilities**
   - Team: Wähle dein Apple Developer Team
   - Bundle Identifier: `com.crewhaus.app` (oder eigener)
   - Signing Certificate: "Automatically manage signing" aktivieren

2. **App Icons**
   - Öffne `Assets.xcassets` → `AppIcon`
   - Füge die Icons in allen benötigten Grössen hinzu (1024x1024 für Store)

3. **Display Name**: "CREW" (bereits in capacitor.config.ts gesetzt)

### 4. TestFlight Build erstellen

1. In Xcode: **Product → Archive**
2. Nach erfolgreichem Archive: **Distribute App → App Store Connect**
3. Auf [App Store Connect](https://appstoreconnect.apple.com) einloggen
4. Unter **TestFlight** → Build auswählen → Tester einladen

### 5. Tester einladen

- **Interner Test**: Bis zu 100 Tester (Team-Mitglieder mit Apple Developer Account)
- **Externer Test**: Bis zu 10.000 Tester per E-Mail oder öffentlichem Link
- Tester installieren die **TestFlight App** aus dem App Store und erhalten einen Einladungslink

---

## Build-Befehle

| Befehl                   | Beschreibung                                         |
|--------------------------|------------------------------------------------------|
| `bun run native:build`   | Web bauen + iOS synchronisieren                      |
| `bun run native:sync`    | Nur iOS-Projekt aktualisieren (nach Code-Änderungen) |
| `bun run native:open`    | Xcode-Projekt öffnen                                 |
| `bun run native:run`     | Auf verbundenem iPhone oder Simulator starten        |

---

## Architektur

```
React App (Vite Build)
    ↓
dist/ (statische HTML/JS/CSS)
    ↓
Capacitor sync → kopiert dist/ in iOS-Projekt
    ↓
iOS WebView (WKWebView) → zeigt die App nativ an
    ↓
Native Plugins (StatusBar, Keyboard, Push, Haptics)
```

**Wichtig**: Die App läuft in einem nativen WebView, hat aber Zugriff auf native APIs:
- StatusBar-Styling (angepasst an CREW-Farben)
- Push Notifications
- Haptic Feedback
- Native Keyboard-Handling
- Safe Area Support (Notch, Home Indicator)

---

## API-Konfiguration

Die native App braucht absolute URLs (kein Vite-Proxy). Die API-URL wird automatisch gesetzt:

- **Web (dev)**: Vite-Proxy → `/v2` → `localhost:3000`
- **Web (prod)**: Relativer Pfad `/v2`
- **Native App**: Absolute URL `https://crew-haus.com/v2`

Zum Überschreiben: `VITE_API_URL` Environment Variable beim Build setzen:
```bash
VITE_API_URL=https://staging.crew-haus.com/v2 bun run native:build
```

---

## App Store Veröffentlichung

Nach erfolgreichem TestFlight-Test:

1. Auf [App Store Connect](https://appstoreconnect.apple.com):
   - App-Informationen ausfüllen (Beschreibung, Keywords, Screenshots)
   - Kategorie: "Reisen" + "Sport"
   - Altersfreigabe festlegen
   - Screenshots für iPhone (6.7" und 6.1") + iPad

2. Build auswählen und zur Prüfung einreichen
3. Apple Review dauert in der Regel 24-48 Stunden

---

## Splash Screen & App Icon

### Splash Screen
Konfiguriert in `capacitor.config.ts`:
- Hintergrundfarbe: `#f0ddf5` (CREW Lavender)
- Auto-Hide nach 1.5 Sekunden

### App Icon generieren
Erstelle ein 1024x1024px Icon und nutze einen Generator:
- [appicon.co](https://www.appicon.co/) — generiert alle benötigten Grössen
- Ergebnis in `ios/App/App/Assets.xcassets/AppIcon.appiconset/` kopieren

---

## Troubleshooting

**"No signing certificate found"**
→ In Xcode: Preferences → Accounts → Apple ID hinzufügen → Download Manual Profiles

**"App Transport Security" Fehler**
→ API muss über HTTPS laufen (crew-haus.com hat bereits SSL)

**Weisser Bildschirm auf dem Gerät**
→ `bun run native:build` nochmal ausführen, dann `bun run native:sync`

**Push Notifications funktionieren nicht**
→ APNs Key in Apple Developer Portal erstellen und im Backend konfigurieren
