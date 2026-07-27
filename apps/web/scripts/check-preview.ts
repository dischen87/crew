import { readFile, readdir } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
const legacyJoinSource = await readFile(
  new URL("../src/pages/join/[code].astro", import.meta.url),
  "utf8"
);
const pages = (await readdir(dist, { recursive: true })).filter((name) =>
  name.endsWith(".html")
);
const assetNames = await readdir(new URL("_astro/", dist));
const css = (
  await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(new URL(`_astro/${name}`, dist), "utf8"))
  )
).join("\n");

function requireMatch(value: string, pattern: RegExp, message: string) {
  if (!pattern.test(value)) throw new Error(message);
}

function rejectMatch(value: string, pattern: RegExp, message: string) {
  if (pattern.test(value)) throw new Error(message);
}

requireMatch(html, /<html lang="de-CH">/, "de-CH document language is missing");
requireMatch(
  html,
  /<title>Crew Next Closed Preview \| Der gemeinsame Plan für eure Gruppe<\/title>/,
  "Preview title is missing"
);
requireMatch(
  html,
  /name="description" content="Crew Next wird für Golfreisen und Team-Events entwickelt\. Ein mobiles Zuhause soll zeigen, was jetzt und als Nächstes zählt\."/,
  "Preview description is missing"
);
requireMatch(
  html,
  /name="robots" content="noindex, nofollow, noarchive"/,
  "Preview noindex is missing"
);
requireMatch(
  html,
  /rel="canonical" href="https:\/\/crew-haus\.com\/"/,
  "Canonical URL is missing"
);
requireMatch(
  html,
  /property="og:title" content="Crew Next Closed Preview \| Der gemeinsame Plan für eure Gruppe"/,
  "Open Graph title must match the document title"
);
requireMatch(
  html,
  /property="og:description" content="Crew Next wird für Golfreisen und Team-Events entwickelt\. Ein mobiles Zuhause soll zeigen, was jetzt und als Nächstes zählt\."/,
  "Open Graph description must match the page description"
);
requireMatch(
  html,
  /property="og:locale" content="de_CH"/,
  "Open Graph locale is missing"
);
requireMatch(
  html,
  /property="og:url" content="https:\/\/crew-haus\.com\/"/,
  "Open Graph URL must match canonical"
);
requireMatch(html, /CREW NEXT · CLOSED PREVIEW/, "Approved eyebrow is missing");
requireMatch(
  html,
  /<h1[^>]*>Der gemeinsame Plan für eure Gruppe\.<\/h1>/,
  "Approved H1 is missing"
);
requireMatch(
  html,
  /Crew Next wird für Golfreisen und Team-Events entwickelt\. Ein mobiles\s+Zuhause soll Organisator:innen und Teilnehmer:innen zeigen, was jetzt\s+und als Nächstes zählt\./,
  "Approved Closed Preview body copy is missing"
);
requireMatch(html, /href="#hauptinhalt"/, "Skip link is missing");
requireMatch(
  html,
  /<header\b[\s\S]*<main id="hauptinhalt"[^>]*tabindex="-1"[\s\S]*<footer\b/,
  "Landmark or skip-link target order is missing"
);
requireMatch(
  html,
  /<button[^>]*disabled[^>]*aria-describedby="contact-status"/,
  "Unconfigured CTA must stay disabled"
);
requireMatch(
  html,
  /Die öffentliche Closed Preview sammelt noch keine Anfragen\. Den\s+Kontaktweg schalten wir erst nach der Datenschutzprüfung frei\./,
  "Disabled CTA explanation is missing"
);
requireMatch(
  html,
  /Crew Next · Öffentliche Closed Preview · kein allgemeiner Produktlaunch/,
  "Public Closed Preview footer is missing"
);
requireMatch(
  html,
  /Konzeptbild · verbindliche Designrichtung · keine finale Produktansicht/,
  "Concept disclosure is missing"
);
requireMatch(
  html,
  /alt="Konzeptansicht des Crew Boards für eine Golfreise mit Tagesplan und nächster Aktion\."/,
  "Concept image alternative text is missing"
);
requireMatch(
  html,
  /@font-face[\s\S]*DM Sans[\s\S]*\.ttf/,
  "Local DM Sans is missing"
);
requireMatch(
  html,
  /rel="icon" type="image\/png" href="\/_astro\/crew-logo\.[^"]+\.png"/,
  "Real Crew favicon is missing"
);

if (pages.length !== 1 || pages[0] !== "index.html")
  throw new Error("Preview must emit exactly one HTML page");
if ((html.match(/<title>/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one title");
if ((html.match(/name="description"/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one description");
if ((html.match(/name="robots"/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one robots directive");
if ((html.match(/rel="canonical"/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one canonical URL");
if ((html.match(/property="og:url"/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one Open Graph URL");
if ((html.match(/<h1\b/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one H1");
if ((html.match(/Closed Preview anfragen/g) ?? []).length !== 1)
  throw new Error("Preview must have exactly one primary CTA");

rejectMatch(
  html,
  /href="#"|App Store|Google Play|Jetzt starten|<form\b|googleapis\.com|crew:\/\//i,
  "Legacy claim, route, form, or dead link leaked into Preview"
);
rejectMatch(
  html,
  /\b(?:offline|stableford|scorekarte|rückblick|recap)\b|jetzt verfügbar|in produktion|produktionsreif/i,
  "Launch-gated feature or availability copy leaked into Closed Preview"
);
rejectMatch(
  html,
  /nicht veröffentlicht|Noch nicht öffentlich/i,
  "Public Closed Preview must not describe itself as unpublished"
);
rejectMatch(
  html,
  /\b(?:analytics|gtag|plausible|posthog|segment|mixpanel|datalayer)\b|<iframe\b/i,
  "Analytics, tracking, or embedded collection leaked into Closed Preview"
);
rejectMatch(
  html,
  /href="https:\/\/[^"/]*@/i,
  "Contact URL credentials must never be emitted"
);
rejectMatch(html, /<script\b/i, "Preview must remain script-free");
requireMatch(css, /focus-visible/, "Visible keyboard focus style is missing");
requireMatch(
  `${html}\n${css}`,
  /prefers-reduced-motion:reduce/,
  "Reduced-motion rule is missing"
);
requireMatch(
  css,
  /@media\(max-width:820px\)/,
  "Tablet/mobile layout rule is missing"
);
requireMatch(
  css,
  /@media\(max-width:520px\)/,
  "Small-mobile layout rule is missing"
);
rejectMatch(
  css,
  /\b(?:animation|transition):/,
  "Preview must not add non-essential motion"
);

requireMatch(
  legacyJoinSource,
  /getStaticPaths\(\)[\s\S]*return \[\];/,
  "Legacy invite route must remain inert"
);
rejectMatch(
  legacyJoinSource,
  /crew:\/\/|App Store|Google Play|\/v2\/auth\/join|api\.crew-haus\.com|<form\b|<script\b|localStorage/i,
  "Legacy invite source must not retain public, store, deep-link, API, form, or storage claims"
);

console.log("Closed Preview static contract passed");
