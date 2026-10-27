// The Infinite Monkey Theorem, running on a GitHub profile.
//
//   node scripts/monkey.mjs type    daily run: 10M random keystrokes
//   node scripts/monkey.mjs feed    a visitor fed a banana: 1M bonus keystrokes
//   node scripts/monkey.mjs render  redraw the SVGs and README from saved state
//
// Each run checks the random stream for the longest stretch that also appears
// in Hamlet, updates data/state.json, and regenerates assets/*.svg + README.md.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const OWNER = "marcellosso";
const REPO = `${OWNER}/${OWNER}`;
const DAILY_KEYSTROKES = 10_000_000;
const BANANA_KEYSTROKES = 1_000_000;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz ";
const SNIPPET_LENGTH = 30;

const PROJECTS = [
  {
    repo: "penciled",
    title: "penciled.js",
    description: "Persistent text highlights and notes on any web page. 15 kB, built on the CSS Custom Highlight API.",
    language: "TypeScript",
    site: "penciled.org",
    url: "https://www.penciled.org",
  },
  {
    repo: "localhost",
    title: "localhost",
    description: "One window to start, stop and watch every local dev server. Free and open source for macOS, Windows and Linux.",
    language: "Rust",
    site: "getlocalhost.app",
    url: "https://www.getlocalhost.app",
  },
  {
    repo: "better-auth-localization",
    title: "better-auth-localization",
    description: "A Better Auth plugin that translates error messages automatically, so your users see them in their language.",
    language: "TypeScript",
    site: "npm",
    url: "https://www.npmjs.com/package/better-auth-localization",
  },
];

const LANGUAGE_COLORS = { TypeScript: "#3178c6", Rust: "#dea584" };

const THEMES = {
  dark: {
    fg: "#e6edf3",
    dim: "#7d8590",
    panel: "#161b22",
    border: "#30363d",
    key: "#21262d",
    accent: "#f5c518",
    match: "#3fb950",
    matchBg: "rgba(63,185,80,0.18)",
    art: "monkey-night.png",
  },
  light: {
    fg: "#1f2328",
    dim: "#656d76",
    panel: "#f6f8fa",
    border: "#d0d7de",
    key: "#ffffff",
    accent: "#b98900",
    match: "#1a7f37",
    matchBg: "rgba(26,127,55,0.14)",
    art: "monkey-day.png",
  },
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

// ---------- Hamlet ----------

const hamletRaw = readFileSync(`${root}data/hamlet.txt`, "utf8");

// Lowercase letters with every run of anything else collapsed to one space,
// plus a map from each normalized character back to its raw position.
function normalize(raw) {
  let text = "";
  const toRaw = [];
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i].toLowerCase();
    if (c >= "a" && c <= "z") {
      if (pendingSpace && text.length) {
        text += " ";
        toRaw.push(i - 1);
      }
      pendingSpace = false;
      text += c;
      toRaw.push(i);
    } else {
      pendingSpace = true;
    }
  }
  return { text, toRaw };
}

const hamlet = normalize(hamletRaw);
const substringSets = [];
function hamletHas(s) {
  const k = s.length;
  if (!substringSets[k]) {
    const set = new Set();
    for (let i = 0; i + k <= hamlet.text.length; i++) set.add(hamlet.text.slice(i, i + k));
    substringSets[k] = set;
  }
  return substringSets[k].has(s);
}

// Where in the play a normalized match lives: act, scene and the raw line.
function locate(match) {
  const start = hamlet.text.indexOf(match);
  const rawStart = hamlet.toRaw[start];
  const rawEnd = hamlet.toRaw[start + match.length - 1] + 1;
  const before = hamletRaw.slice(0, rawStart);
  const act = [...before.matchAll(/^ACT ([IVX]+)/gm)].pop()?.[1] ?? "I";
  const scene = [...before.matchAll(/^SCENE ([IVX]+)\./gm)].pop()?.[1] ?? "I";
  const lineStart = hamletRaw.lastIndexOf("\n", rawStart) + 1;
  let lineEnd = hamletRaw.indexOf("\n", rawEnd);
  if (lineEnd === -1) lineEnd = hamletRaw.length;
  return {
    act,
    scene,
    line: hamletRaw.slice(lineStart, lineEnd).trim(),
    matchInLine: [rawStart - lineStart, rawEnd - lineStart],
  };
}

// ---------- The monkey ----------

function type(count) {
  const chars = new Array(count);
  let n = 0;
  while (n < count) {
    for (const byte of randomBytes(Math.min(65536, (count - n) * 2))) {
      if (byte >= 243) continue; // 243 = 9 * 27, keeps every key equally likely
      chars[n++] = ALPHABET[byte % 27];
      if (n === count) break;
    }
  }
  const stream = chars.join("");

  let bestLength = 0;
  let bestAt = 0;
  for (let i = 0; i + bestLength < stream.length; i++) {
    while (i + bestLength < stream.length && hamletHas(stream.slice(i, i + bestLength + 1))) {
      bestLength++;
      bestAt = i;
    }
  }

  const match = stream.slice(bestAt, bestAt + bestLength);
  const lead = Math.max(0, Math.floor((SNIPPET_LENGTH - bestLength) / 2));
  const snippetStart = Math.max(0, bestAt - lead);
  return {
    match,
    snippet: stream.slice(snippetStart, snippetStart + Math.max(SNIPPET_LENGTH, bestLength)),
    matchStart: bestAt - snippetStart,
  };
}

// ---------- State ----------

const statePath = `${root}data/state.json`;
const today = () => new Date().toISOString().slice(0, 10);

function loadState() {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, "utf8"));
  return {
    startedOn: today(),
    keystrokes: 0,
    runs: 0,
    bananas: 0,
    best: null,
    latest: null,
    lastRunAt: null,
    donors: [],
    stars: {},
  };
}

function dayNumber(state, date = today()) {
  return Math.floor((Date.parse(date) - Date.parse(state.startedOn)) / 86_400_000) + 1;
}

function record(state, count, fedBy) {
  const result = type(count);
  state.keystrokes += count;
  state.runs += 1;
  state.lastRunAt = new Date().toISOString();
  state.latest = { ...result, keystrokes: count, fedBy };
  const isRecord = !state.best || result.match.length > state.best.match.length;
  if (isRecord) state.best = { match: result.match, day: dayNumber(state), fedBy };
  return { result, isRecord };
}

async function refreshStars(state) {
  const headers = { "User-Agent": OWNER, Accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  await Promise.all(
    PROJECTS.map(async ({ repo }) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, { headers });
        if (res.ok) state.stars[repo] = (await res.json()).stargazers_count;
      } catch {
        // Offline or rate-limited: keep the last known count.
      }
    }),
  );
}

// ---------- SVG helpers ----------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("en-US");
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${body}\n</svg>\n`;

// log10 of the years until the monkey types all of Hamlet at the daily pace.
function hamletExponent() {
  const perYear = DAILY_KEYSTROKES * 365;
  return Math.round(hamlet.text.length * Math.log10(ALPHABET.length) - Math.log10(perYear));
}

function wrap(text, width) {
  const lines = [""];
  for (const word of text.split(" ")) {
    const line = lines[lines.length - 1];
    if (line && (line + " " + word).length > width) lines.push(word);
    else lines[lines.length - 1] = line ? `${line} ${word}` : word;
  }
  return lines;
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function banner(state, t) {
  const art = readFileSync(`${root}assets/${t.art}`).toString("base64");
  const { snippet, matchStart, match } = state.latest;
  const W = 1200;
  const H = 360;
  const artW = Math.round((H * 141) / 64);
  const px = artW + 20;
  const pw = W - px;
  const ix = px + 22;

  // Typing timeline, shared by the text, the cursor and the keyboard.
  const STEP = 0.14;
  const typingEnd = snippet.length * STEP;
  const D = typingEnd + 4;
  const kt = (s) => (s / D).toFixed(4);
  const cw = 11.6;
  const ty = 186;

  const chars = [...snippet]
    .map((c, i) => {
      const inMatch = i >= matchStart && i < matchStart + match.length;
      const show = `<animate attributeName="opacity" values="0;1;1" keyTimes="0;${kt(i * STEP)};1" dur="${D}s" calcMode="discrete" repeatCount="indefinite"/>`;
      const glyph = c === " " ? "·" : c;
      return `<text x="${(ix + i * cw).toFixed(1)}" y="${ty}" fill="${inMatch ? t.match : c === " " ? t.border : t.fg}" font-weight="${inMatch ? 700 : 400}" opacity="0">${esc(glyph)}${show}</text>`;
    })
    .join("\n");

  const reveal = (extra = "") =>
    `opacity="0"><animate attributeName="opacity" values="0;1;1" keyTimes="0;${kt(typingEnd)};1" dur="${D}s" calcMode="discrete" repeatCount="indefinite"/>${extra}`;

  const matchX = ix + matchStart * cw - 3;
  const matchW = match.length * cw + 6;
  const highlight = match.length
    ? `<rect x="${matchX.toFixed(1)}" y="${ty - 19}" width="${matchW.toFixed(1)}" height="26" rx="4" fill="${t.matchBg}" ${reveal()}</rect>
<text x="${(matchX + matchW / 2).toFixed(1)}" y="${ty + 26}" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="600" fill="${t.match}" ${reveal()}↑ that's Hamlet!</text>`
    : "";

  const cursorXs = [...snippet, ""].map((_, i) => (ix + i * cw).toFixed(1));
  const cursorTimes = cursorXs.map((_, i) => kt(i * STEP));
  const cursor = `<rect x="${ix}" y="${ty - 17}" width="2.5" height="22" fill="${t.accent}">
<animate attributeName="x" values="${cursorXs.join(";")}" keyTimes="${cursorTimes.join(";")}" dur="${D}s" calcMode="discrete" repeatCount="indefinite"/>
<animate attributeName="opacity" values="1;0;1" dur="1s" calcMode="discrete" repeatCount="indefinite"/>
</rect>`;

  // Light up each key at the moment its letter is typed.
  const pressTimes = {};
  [...snippet].forEach((c, i) => (pressTimes[c] ??= []).push(i * STEP));
  const keyAnim = (c) => {
    const times = pressTimes[c];
    if (!times) return "";
    const keyTimes = ["0"];
    const values = [t.key];
    for (const s of times) {
      keyTimes.push(kt(s), kt(s + STEP * 0.8));
      values.push(t.accent, t.key);
    }
    keyTimes.push("1");
    values.push(t.key);
    return `<animate attributeName="fill" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${D}s" calcMode="discrete" repeatCount="indefinite"/>`;
  };
  const KW = 30;
  const KH = 22;
  const GAP = 4;
  const ky = 232;
  const keys = KEY_ROWS.flatMap((row, r) =>
    [...row].map((c, k) => {
      const x = ix + r * 10 + k * (KW + GAP);
      const y = ky + r * (KH + GAP);
      return `<rect x="${x}" y="${y}" width="${KW}" height="${KH}" rx="4" fill="${t.key}" stroke="${t.border}">${keyAnim(c)}</rect>
<text x="${x + KW / 2}" y="${y + 15}" text-anchor="middle" font-size="11" fill="${t.dim}">${c}</text>`;
    }),
  );
  const spaceY = ky + 3 * (KH + GAP);
  keys.push(
    `<rect x="${ix + 70}" y="${spaceY}" width="${6 * KW}" height="${KH}" rx="4" fill="${t.key}" stroke="${t.border}">${keyAnim(" ")}</rect>`,
  );

  const day = dayNumber(state);
  return svg(
    W,
    H,
    `<defs><clipPath id="art"><rect width="${artW}" height="${H}" rx="16"/></clipPath></defs>
<g clip-path="url(#art)">
  <image href="data:image/png;base64,${art}" width="${artW}" height="${H}" preserveAspectRatio="none" style="image-rendering:pixelated;image-rendering:crisp-edges"/>
</g>
<rect x="0.5" y="0.5" width="${artW - 1}" height="${H - 1}" rx="16" fill="none" stroke="${t.border}"/>
<rect x="${px + 0.5}" y="0.5" width="${pw - 1}" height="${H - 1}" rx="16" fill="${t.panel}" stroke="${t.border}"/>
<g font-family="${MONO}">
  <circle cx="${ix + 5}" cy="28" r="5" fill="#ff5f57"/><circle cx="${ix + 21}" cy="28" r="5" fill="#febc2e"/><circle cx="${ix + 37}" cy="28" r="5" fill="#28c840"/>
  <text x="${px + pw - 22}" y="32" text-anchor="end" font-size="12" fill="${t.dim}">monkey.typewriter · day ${day}</text>
  <text x="${ix}" y="94" font-size="23" font-weight="800" fill="${t.fg}">I AM A CODING MACHINE</text>
  <text x="${ix}" y="148" font-size="13" fill="${t.accent}">$ monkey --type ${state.latest.fedBy ? `--banana=@${esc(state.latest.fedBy)}` : "--keys=10M"}</text>
  <g font-size="19">${chars}</g>
  ${highlight}
  ${cursor}
  ${keys.join("\n")}
</g>`,
  );
}

function stats(state, t) {
  const W = 1200;
  const H = 316;
  const tileW = (W - 3 * 16) / 4;
  const exponent = hamletExponent();
  const tile = (i, label, value, unit = "", sup = "") => {
    const x = i * (tileW + 16);
    return `<rect x="${x + 0.5}" y="0.5" width="${tileW - 1}" height="111" rx="14" fill="${t.panel}" stroke="${t.border}"/>
<text x="${x + 22}" y="34" font-family="${MONO}" font-size="12" letter-spacing="1.5" fill="${t.dim}">${label}</text>
<text x="${x + 22}" y="84" font-family="${MONO}" font-size="30" font-weight="800" fill="${t.fg}">${value}${sup ? `<tspan font-size="17" dy="-14">${sup}</tspan>` : ""}${unit ? `<tspan font-size="14" font-weight="400" fill="${t.dim}" dy="${sup ? 14 : 0}"> ${unit}</tspan>` : ""}</text>`;
  };

  const best = state.best;
  const where = locate(best.match);
  // Trim long lines around the match so the quote fits.
  let { line } = where;
  let [ms, me] = where.matchInLine;
  const MAX = 78;
  if (line.length > MAX) {
    const from = Math.max(0, Math.min(ms - 24, line.length - MAX));
    line = (from > 0 ? "…" : "") + line.slice(from, from + MAX) + (from + MAX < line.length ? "…" : "");
    const shift = from > 0 ? from - 1 : 0;
    ms -= shift;
    me -= shift;
  }
  const credit = best.fedBy ? ` thanks to @${esc(best.fedBy)}'s banana 🍌` : "";

  return svg(
    W,
    H,
    `${tile(0, "DAY", fmt(dayNumber(state)))}
${tile(1, "KEYSTROKES", fmt(state.keystrokes))}
${tile(2, "BANANAS EATEN", fmt(state.bananas))}
${tile(3, "HAMLET ETA", "10", "years", fmt(exponent))}
<rect x="0.5" y="128.5" width="${W - 1}" height="${H - 129}" rx="14" fill="${t.panel}" stroke="${t.border}"/>
<text x="26" y="166" font-family="${MONO}" font-size="12" letter-spacing="1.5" fill="${t.dim}">LONGEST SHAKESPEARE SO FAR · ${best.match.length} CHARACTERS</text>
<text x="26" y="222" font-family="${MONO}" font-size="40" font-weight="800" fill="${t.match}" xml:space="preserve">“${esc(best.match)}”</text>
<text x="26" y="262" font-family="Georgia, 'Times New Roman', serif" font-size="19" font-style="italic" fill="${t.fg}" xml:space="preserve">${esc(line.slice(0, ms))}<tspan fill="${t.match}" font-weight="700" text-decoration="underline">${esc(line.slice(ms, me))}</tspan>${esc(line.slice(me))}</text>
<text x="26" y="290" font-family="${SANS}" font-size="14" fill="${t.dim}">Hamlet, Act ${where.act}, Scene ${where.scene} · typed by accident on day ${best.day}${credit}</text>`,
  );
}

function card(project, state, t) {
  const W = 400;
  const H = 220;
  const stars = state.stars[project.repo];
  const n = PROJECTS.indexOf(project) + 1;
  const lines = wrap(project.description, 44)
    .slice(0, 3)
    .map((l, i) => `<text x="24" y="${102 + i * 22}" font-family="${SANS}" font-size="15" fill="${t.dim}">${esc(l)}</text>`)
    .join("\n");
  return svg(
    W,
    H,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${t.panel}" stroke="${t.border}"/>
<text x="24" y="36" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${t.accent}">MONKEY OUTPUT #${String(n).padStart(2, "0")} · IT WORKS</text>
<text x="24" y="70" font-family="${MONO}" font-size="${project.title.length > 18 ? 19 : 24}" font-weight="800" fill="${t.fg}">${esc(project.title)}</text>
${lines}
<line x1="24" x2="${W - 24}" y1="180" y2="180" stroke="${t.border}"/>
<circle cx="30" cy="200" r="6" fill="${LANGUAGE_COLORS[project.language]}"/>
<text x="42" y="205" font-family="${SANS}" font-size="13" fill="${t.dim}">${project.language}${stars != null ? `   ★ ${fmt(stars)}` : ""}</text>
<text x="${W - 24}" y="205" text-anchor="end" font-family="${MONO}" font-size="13" fill="${t.fg}">${esc(project.site)} →</text>`,
  );
}

function feedButton(t) {
  // An 8x7 pixel banana.
  const banana = ["......##", ".....##.", "....###.", "...####.", ".#####..", "#####...", ".###...."];
  const pixels = banana
    .flatMap((row, y) =>
      [...row].map((c, x) => (c === "#" ? `<rect x="${24 + x * 4}" y="${15 + y * 4}" width="4" height="4" fill="${y < 2 ? "#7a5a12" : "#f5c518"}"/>` : "")),
    )
    .join("");
  return svg(
    300,
    58,
    `<rect x="1" y="1" width="298" height="56" rx="12" fill="${t.panel}" stroke="${t.accent}" stroke-width="2"/>
<g>${pixels}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.2s" repeatCount="indefinite"/></g>
<text x="70" y="36" font-family="${MONO}" font-size="17" font-weight="800" letter-spacing="1" fill="${t.fg}">FEED THE MONKEY</text>`,
  );
}

// ---------- README ----------

const picture = (name, alt, attrs = "") =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg"><img src="assets/${name}-light.svg" alt="${alt}" ${attrs}></picture>`;

function readme(state) {
  const feedUrl = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent("🍌 Feed the monkey")}&body=${encodeURIComponent("Here's a banana. Get typing. 🐒\n\n(Just hit **Create**. The monkey eats it, types a million keys and replies with what it wrote.)")}`;
  const donors = state.donors.length
    ? state.donors
        .slice(0, 40)
        .map(
          (d) =>
            `<a href="https://github.com/${d.login}" title="@${d.login}: ${d.bananas} banana${d.bananas === 1 ? "" : "s"}"><img src="https://github.com/${d.login}.png?size=80" width="40" height="40" alt="@${d.login}"></a>`,
        )
        .join(" ")
    : "<i>Nobody yet. The monkey is hungry, be the first.</i>";
  const cards = PROJECTS.map(
    (p) => `<a href="${p.url}">${picture(`card-${p.repo}`, `${p.title}: ${p.description}`, 'width="32%"')}</a>`,
  ).join("\n");

  return `<!-- Generated by scripts/monkey.mjs. Edit the script, not this file. -->
<p align="center">${picture("banner", "Pixel-art monkeys and a typewriter terminal: I AM A CODING MACHINE")}</p>

<p align="center">
  <b>Hey, I'm Marcel.</b> Developer from Santos, Brazil 🇧🇷<br/>
  I build all kinds of things: libraries, desktop apps, websites, even the occasional small game.<br/>
  This profile is one of them. It's running an experiment right now.
</p>

### 🐒 The experiment

Give a monkey a typewriter and infinite time, and it will eventually type the complete works of Shakespeare. That's the [infinite monkey theorem](https://en.wikipedia.org/wiki/Infinite_monkey_theorem). I'm testing it.

Every day a GitHub Action gives my monkey **${fmt(DAILY_KEYSTROKES)} random keystrokes** and checks whether any of them landed on *Hamlet*. Here's how it's going:

<p align="center">${picture("stats", `Day ${dayNumber(state)}: ${fmt(state.keystrokes)} keystrokes, longest Hamlet match so far: "${state.best.match}"`)}</p>

<p align="center">
  <a href="${feedUrl}">${picture("feed", "Feed the monkey a banana", 'width="300"')}</a><br/>
  <sub>Each banana buys ${fmt(BANANA_KEYSTROKES)} extra keystrokes right away. The monkey replies with what it typed, and you join the wall below.</sub>
</p>

<p align="center"><b>🍌 Banana donors</b><br/><br/>${donors}</p>

### 🧪 Things the monkey typed that actually work

<p align="center">
${cards}
</p>

### 🧰 Tools in the monkey's paws

<p><img src="https://skillicons.dev/icons?i=ts,react,nextjs,nodejs,tailwind,astro,rust,tauri,swift,postgres&theme=dark" alt="TypeScript, React, Next.js, Node.js, Tailwind, Astro, Rust, Tauri, Swift, Postgres"/></p>

### 📫 Say hi

Questions about one of my projects? Open an issue on the repo. For anything else, email [marcel.losso@gmail.com](mailto:marcel.losso@gmail.com).

<sub>Last run ${state.lastRunAt.slice(0, 16).replace("T", " ")} UTC · Hamlet text from <a href="https://www.gutenberg.org/ebooks/1524">Project Gutenberg</a> · <a href="scripts/monkey.mjs">how it works</a></sub>
`;
}

function render(state) {
  for (const [name, t] of Object.entries(THEMES)) {
    writeFileSync(`${root}assets/banner-${name}.svg`, banner(state, t));
    writeFileSync(`${root}assets/stats-${name}.svg`, stats(state, t));
    writeFileSync(`${root}assets/feed-${name}.svg`, feedButton(t));
    for (const p of PROJECTS) writeFileSync(`${root}assets/card-${p.repo}-${name}.svg`, card(p, state, t));
  }
  writeFileSync(`${root}README.md`, readme(state));
}

// ---------- Main ----------

const mode = process.argv[2] ?? "render";
const state = loadState();

if (mode === "type") {
  const { result, isRecord } = record(state, DAILY_KEYSTROKES);
  console.log(`typed ${fmt(DAILY_KEYSTROKES)} keys, best today: "${result.match}"${isRecord ? " (new record!)" : ""}`);
} else if (mode === "feed") {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const login = event.issue.user.login;
  let donor = state.donors.find((d) => d.login === login);
  let comment;
  if (donor?.lastFed === today()) {
    comment = `🐒 *pats belly* Already had your banana today, @${login}. Come back tomorrow!`;
  } else {
    const { result, isRecord } = record(state, BANANA_KEYSTROKES, login);
    state.bananas += 1;
    if (!donor) state.donors.push((donor = { login, bananas: 0 }));
    donor.bananas += 1;
    donor.lastFed = today();
    // Most recent feeder first.
    state.donors = [donor, ...state.donors.filter((d) => d !== donor)];
    const where = locate(result.match);
    comment = [
      `🐒🍌 *nom.* Thanks @${login}! That banana bought ${fmt(BANANA_KEYSTROKES)} keystrokes. Somewhere in the mess:`,
      "",
      "```",
      result.snippet,
      " ".repeat(result.matchStart) + "^".repeat(result.match.length),
      "```",
      "",
      `**"${result.match}"** (${result.match.length} characters) appears in Hamlet, Act ${where.act}, Scene ${where.scene}:`,
      `> ${where.line}`,
      "",
      isRecord
        ? `🏆 **That's a new all-time record!** You're on the profile now.`
        : `The record is still **"${state.best.match}"** (${state.best.match.length} characters). Your avatar is on the banana wall either way.`,
    ].join("\n");
  }
  writeFileSync(`${root}comment.md`, comment);
  console.log(comment);
} else if (mode !== "render") {
  throw new Error(`unknown mode: ${mode}`);
}

await refreshStars(state);
writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
render(state);
