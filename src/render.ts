import { SOURCES, TOPICS } from "./sources";
import type { Item } from "./parse";
import type { Edition } from "./index";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const srcById = new Map(SOURCES.map((s) => [s.id, s]));

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function longDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function ubTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" });
}

const CSS = `
:root{--bg:#0d0f0e;--fg:#d6dbd4;--muted:#7d867f;--dim:#4a524c;--accent:#7ee787;--accent2:#e3b341;--line:#222724;--hover:#151917}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#fbfbf8;--fg:#1d211e;--muted:#5f6862;--dim:#a3aaa4;--accent:#1a7f37;--accent2:#9a6700;--line:#e3e5df;--hover:#f1f2ec}}
:root[data-theme="light"]{--bg:#fbfbf8;--fg:#1d211e;--muted:#5f6862;--dim:#a3aaa4;--accent:#1a7f37;--accent2:#9a6700;--line:#e3e5df;--hover:#f1f2ec}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
a{color:inherit}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 64px}
header .brand{color:var(--accent);text-decoration:none;font-weight:700}
header .rule{color:var(--dim);overflow:hidden;white-space:nowrap;margin:6px 0 14px}
.prompt{color:var(--muted)}
.prompt b{color:var(--fg);font-weight:600}
nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin:14px 0 4px}
nav a{color:var(--muted);text-decoration:none}
nav a:hover{color:var(--accent)}
nav a::before{content:"[";color:var(--dim)} nav a::after{content:"]";color:var(--dim)}
h2{font-size:14px;margin:36px 0 10px;color:var(--accent2);font-weight:700}
h2 .count{color:var(--dim);font-weight:400}
ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:2.6em 1fr;padding:8px 6px;border-radius:4px}
li:hover{background:var(--hover)}
.n{color:var(--dim)}
.t{color:var(--fg);text-decoration:none;font-weight:600;overflow-wrap:anywhere}
.t:hover{color:var(--accent);text-decoration:underline}
.m{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.m a{color:var(--muted)}
.s{color:var(--muted);font-size:13px;margin-top:2px;overflow-wrap:anywhere}
.empty{color:var(--muted)}
footer{margin-top:48px;border-top:1px dashed var(--line);padding-top:16px;color:var(--muted);font-size:12.5px}
footer a{color:var(--muted)}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:28px;color:var(--muted)}
.pager a{text-decoration:none} .pager a:hover{color:var(--accent)}
.src{columns:2 220px;margin:8px 0 0;padding:0;list-style:none}
.src li{display:block;padding:1px 0}
.src li:hover{background:none}
.ok{color:var(--accent)} .err{color:#f85149}
@media (max-width:520px){li{grid-template-columns:2.1em 1fr}.wrap{padding-top:18px}}
`;

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A daily brief of technology, AI, software development, startups and Mongolian startup news.">
<link rel="alternate" type="application/rss+xml" title="news.tseku.dev" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230d0f0e'/%3E%3Ctext x='3' y='12' font-family='monospace' font-size='11' fill='%237ee787'%3E%3E%3C/text%3E%3C/svg%3E">
${extraHead}<style>${CSS}</style></head><body><div class="wrap">
<header><a class="brand" href="/">news.tseku.dev</a> <span class="prompt">— daily brief</span>
<div class="rule">────────────────────────────────────────────────────────────────────────────────────────────────────</div></header>
${body}
<footer>A daily digest of headlines and links, gathered automatically from public feeds every morning at 07:00 Ulaanbaatar time. Stories belong to their publishers.<br>
<a href="/archive">archive</a> · <a href="/feed.xml">rss</a> · <a href="/api/latest.json">json</a> · <a href="https://tseku.dev">tseku.dev</a></footer>
</div></body></html>`;
}

function itemHtml(it: Item, n: number): string {
  const src = srcById.get(it.source);
  const bits = [esc(src?.name ?? it.source), esc(host(it.url))];
  if (it.meta) bits.push(esc(it.meta));
  if (it.discuss && it.discuss !== it.url) bits.push(`<a href="${esc(it.discuss)}" rel="noopener">discuss</a>`);
  return `<li><span class="n">${String(n).padStart(2, "0")}</span><div>
<a class="t" href="${esc(it.url)}" rel="noopener">${esc(it.title)}</a>
<div class="m">${bits.join(" · ")}</div>${it.summary ? `<div class="s">${esc(it.summary)}</div>` : ""}</div></li>`;
}

export function renderEdition(ed: Edition, dates: string[], isLatest: boolean): string {
  const byTopic = new Map<string, Item[]>();
  for (const it of ed.items) {
    const topic = srcById.get(it.source)?.topic ?? "tech";
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(it);
  }
  const nav = TOPICS.map((t) => `<a href="#${t.id}">${esc(t.label.toLowerCase())}</a>`).join("");
  const sections = TOPICS.map((t) => {
    const list = byTopic.get(t.id) ?? [];
    const inner = list.length
      ? `<ol>${list.map((it, i) => itemHtml(it, i + 1)).join("")}</ol>`
      : `<p class="empty">  nothing new here today.</p>`;
    return `<section id="${t.id}"><h2>## ${esc(t.label)} <span class="count">(${list.length})</span></h2>${inner}</section>`;
  }).join("");

  const idx = dates.indexOf(ed.date);
  const older = idx >= 0 ? dates[idx + 1] : undefined;
  const newer = idx > 0 ? dates[idx - 1] : undefined;
  const pager = `<div class="pager"><span>${older ? `<a href="/d/${older}">← ${older}</a>` : ""}</span><span>${newer ? `<a href="${idx - 1 === 0 ? "/" : `/d/${newer}`}">${newer} →</a>` : ""}</span></div>`;

  const okSources = Object.values(ed.report).filter((r) => !r.startsWith("error")).length;
  const srcList = SOURCES.map((s) => {
    const r = ed.report[s.id] ?? "not run";
    const cls = r.startsWith("error") ? "err" : "ok";
    return `<li><span class="${cls}">●</span> ${esc(s.name)} <span class="m">${esc(r.startsWith("error") ? "unavailable" : r)}</span></li>`;
  }).join("");

  const body = `<p class="prompt">&gt; <b>${esc(longDate(ed.date))}</b>${isLatest ? "" : " (archive)"}<br>
&nbsp; ${ed.items.length} stories · updated ${ubTime(ed.generatedAt)} Ulaanbaatar · ${okSources}/${SOURCES.length} sources</p>
<nav>${nav}</nav>${sections}${pager}
<h2>## Sources</h2><ul class="src">${srcList}</ul>`;
  return page(`news.tseku.dev · ${ed.date}`, body);
}

export function renderArchive(dates: string[]): string {
  const list = dates.length
    ? `<ol>${dates.map((d, i) => `<li><span class="n">${String(i + 1).padStart(2, "0")}</span><div><a class="t" href="/d/${d}">${esc(longDate(d))}</a></div></li>`).join("")}</ol>`
    : `<p class="empty">No editions yet.</p>`;
  return page("news.tseku.dev · archive", `<p class="prompt">&gt; <b>archive</b></p>${list}`);
}

export function renderBuilding(): string {
  return page(
    "news.tseku.dev · building",
    `<p class="prompt">&gt; <b>building the first edition</b></p>
<p class="empty">This page reloads itself while it gathers today's stories. It usually takes under a minute.</p>`,
    `<meta http-equiv="refresh" content="5">`,
  );
}

export function renderNotFound(): string {
  return page("news.tseku.dev · not found", `<p class="prompt">&gt; <b>404</b></p><p class="empty">No edition here. <a href="/">Go to today's brief.</a></p>`);
}

export function renderFeed(ed: Edition | null, origin: string): string {
  const items = (ed?.items ?? [])
    .map((it) => {
      const src = srcById.get(it.source);
      return `<item><title>${esc(it.title)}</title><link>${esc(it.url)}</link><guid isPermaLink="false">${esc(it.url)}</guid>${
        it.date ? `<pubDate>${new Date(it.date).toUTCString()}</pubDate>` : ""
      }<category>${esc(src?.topic ?? "tech")}</category><description>${esc([src?.name, it.summary].filter(Boolean).join(" — "))}</description></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>news.tseku.dev</title><link>${esc(origin)}/</link><description>Daily brief: technology, AI, software development, startups and Mongolia.</description>${
    ed ? `<lastBuildDate>${new Date(ed.generatedAt).toUTCString()}</lastBuildDate>` : ""
  }${items}</channel></rss>`;
}
