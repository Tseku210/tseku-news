import { SOURCES, TOPICS } from "./sources";
import type { Item } from "./parse";
import type { Edition } from "./index";
import { rank, topPicks, type Ranked } from "./rank";
import type { Mark, SignalStats, StoryRow } from "./db";
import type { Trends } from "./trends";

// Who is looking. Signed in, every story gets like / save / hide buttons and
// opened stories are remembered; marks holds what was done to the stories shown.
export interface View {
  signedIn: boolean;
  marks?: Map<string, Mark>;
}
const PUBLIC: View = { signedIn: false };

// The nameplate printed at the top of every page.
const MASTHEAD = "The Tseku Daily";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const srcById = new Map(SOURCES.map((s) => [s.id, s]));
const topicLabel = new Map(TOPICS.map((t) => [t.id as string, t.label]));
const shortLabel = (id: string) => (id === "dev" ? "Dev" : topicLabel.get(id) ?? "");

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function longDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function ubTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" });
}

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Newsprint palettes. Topic hues survive only in small places (trend charts,
// the tint behind a story that has no picture) so the page stays black on paper.
const LIGHT = `--bg:#fbfaf6;--fg:#121212;--ink:#121212;--muted:#555350;--dim:#8a8781;--line:#dcd9d2;--rule:#121212;--chip:#efede7;--tint:#e9e6de;--link:#326891;--red:#c2281f;
--ai:#6f4bd8;--dev:#1f62c9;--startups:#c4530f;--tech:#0c7f6c;--mongolia:#bf2e61;--blogs:#957400`;
const DARK = `--bg:#121212;--fg:#e9e6df;--ink:#f1eee8;--muted:#aaa69e;--dim:#77746e;--line:#2d2c2a;--rule:#cfcbc2;--chip:#1e1e1d;--tint:#1c1c1b;--link:#8fb8dc;--red:#ff6a5c;
--ai:#a28bff;--dev:#58a6ff;--startups:#ff8a3d;--tech:#2ec4a6;--mongolia:#ff6b9a;--blogs:#e3b341`;

const SERIF = `"Source Serif 4","Source Serif Pro",Georgia,"Times New Roman",serif`;
const DISPLAY = `"Playfair Display",${SERIF}`;
const SANS = `"Libre Franklin","Franklin Gothic Medium","Helvetica Neue",Arial,sans-serif`;

const CSS = `
:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:12px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ${SERIF};-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px 64px}
.t-ai{--c:var(--ai)}.t-dev{--c:var(--dev)}.t-startups{--c:var(--startups)}.t-tech{--c:var(--tech)}.t-mongolia{--c:var(--mongolia)}.t-blogs{--c:var(--blogs)}

/* Masthead: date and edition on the left, nameplate in the middle, tools on the right,
   section links under a double rule. */
.mast{padding:14px 0 0}
.mast-top{display:grid;grid-template-columns:1fr auto 1fr;grid-template-areas:"left logo right";align-items:end;gap:16px;padding-bottom:12px}
.mast-left{grid-area:left;font:500 12.5px/1.45 ${SANS};color:var(--fg)}
.mast-left b{display:block;font-weight:700}
.mast-left span{color:var(--muted)}
.logo{grid-area:logo;font:900 58px/1 ${DISPLAY};letter-spacing:-.01em;color:var(--ink);text-align:center;white-space:nowrap;padding:0 8px}
.small .logo{font-size:38px}
.mast-right{grid-area:right;display:flex;justify-content:flex-end;align-items:center;gap:2px}
.mast-right a{display:grid;place-items:center;width:34px;height:34px;color:var(--muted)}
.mast-right a:hover,.mast-right a[aria-current]{color:var(--fg);background:var(--chip)}
.mast-right a.txt{width:auto;padding:0 10px;font:600 11px/34px ${SANS};text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--line);margin-left:8px}
.mast-right .theme{appearance:none;border:0;background:transparent;padding:0;cursor:pointer;display:grid;place-items:center;width:34px;height:34px;color:var(--muted)}
.mast-right .theme:hover{color:var(--fg);background:var(--chip)}
.theme .sun{display:none}
:root[data-theme="dark"] .theme .sun{display:block}:root[data-theme="dark"] .theme .moon{display:none}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .theme .sun{display:block}:root:not([data-theme="light"]) .theme .moon{display:none}}
.mast-right svg,.acts svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sections{display:flex;justify-content:center;gap:4px 26px;flex-wrap:wrap;padding:9px 0;border-top:1px solid var(--line);border-bottom:3px double var(--rule);font:600 12.5px/1.4 ${SANS}}
.sections a{color:var(--fg);white-space:nowrap}
.sections a:hover{text-decoration:underline;text-underline-offset:3px}
.sections small{color:var(--dim);font-weight:500;margin-left:5px}

/* Stories */
.kick{font:700 10.5px/1.3 ${SANS};text-transform:uppercase;letter-spacing:.09em;color:var(--fg);margin:0 0 6px}
.kick span{color:var(--muted);font-weight:500}
.story{position:relative}
.story h3,.story h4{margin:0;font-family:${SERIF};font-weight:700;color:var(--ink);overflow-wrap:anywhere;letter-spacing:-.005em}
.story h3{font-size:20px;line-height:1.2}
.story h4{font-size:16.5px;line-height:1.25}
.story h3 a::after,.story h4 a::after{content:"";position:absolute;inset:0;z-index:1}
.story:hover h3 a,.story:hover h4 a{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.story p{margin:7px 0 0;font-size:15px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}
.meta{font:500 10.5px/1.5 ${SANS};letter-spacing:.06em;text-transform:uppercase;color:var(--dim);overflow-wrap:anywhere}
.meta a{position:relative;z-index:2;color:var(--muted);text-decoration:underline;text-underline-offset:2px}
.meta .rt{color:var(--muted);font-weight:600}
.foot{margin-top:9px}
.foot .acts{margin:4px 0 -6px -7px}

.pic{position:relative;aspect-ratio:3/2;overflow:hidden;background:color-mix(in srgb,var(--c,var(--dim)) 16%,var(--tint))}
.pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:var(--tint)}
.ph{position:absolute;inset:0;display:grid;place-items:center;padding:12px;text-align:center;font:italic 600 22px/1.15 ${DISPLAY};color:color-mix(in srgb,var(--c,var(--fg)) 55%,var(--fg));opacity:.55;
  background:repeating-linear-gradient(135deg,transparent 0 7px,color-mix(in srgb,var(--fg) 5%,transparent) 7px 8px)}
figure{margin:0}
figcaption{margin-top:6px;font:400 11px/1.4 ${SANS};color:var(--dim);text-align:right}
.pic-top>.pic{margin-bottom:10px}
.thumb{float:right;width:96px;margin:2px 0 6px 14px;aspect-ratio:1}
.thumb .ph{font-size:12px}

/* Front page: lead package plus two text stories on the left, a picture story and briefs on the right. */
.front{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(0,1fr);margin-top:20px}
.front-main{padding-right:24px;border-right:1px solid var(--line)}
.front-side{padding-left:24px}
.lead{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.75fr);gap:24px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.lead .lead-text{display:flex;flex-direction:column}
.lead h3{font-size:30px;line-height:1.12;letter-spacing:-.015em}
.lead p{font-size:16px;-webkit-line-clamp:7}
.lead.no-pic{grid-template-columns:minmax(0,1fr)}
.lead.no-pic h3{font-size:40px;max-width:24ch}
.lead.no-pic p{font-size:18px;max-width:60ch}
.trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding-top:18px}
.trio>.story{padding:0 18px}
.trio>.story:first-child{padding-left:0}
.trio>.story:last-child{padding-right:0}
.trio>.story+.story{border-left:1px solid var(--line)}
.front-side>.story+.story,.col>.story+.story{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.front-side>.story:first-child h3{font-size:23px}

/* Topic sections */
.sec{margin-top:44px}
.sec-h{display:flex;align-items:baseline;gap:10px;margin:0 0 16px;padding-top:9px;border-top:2px solid var(--rule);font:700 15px/1.3 ${SANS};letter-spacing:.01em}
.sec-h small{font-weight:500;color:var(--dim);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.sec-h a.top{margin-left:auto;font-weight:500;font-size:12px;color:var(--dim)}
.sec-grid{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(0,1fr)}
.sec-main{padding-right:24px;border-right:1px solid var(--line)}
.sec-main:only-child{border-right:0;padding-right:0}
.sec-grid.solo{grid-template-columns:minmax(0,1fr)}
.solo .lead .pic{aspect-ratio:21/9}
.sec-main .lead h3{font-size:26px}
.sec-main>.lead:last-child,.front-main>.lead:last-child{border-bottom:0;padding-bottom:0}
.sec-grid>.col{padding-left:24px}
.trio.pair{grid-template-columns:repeat(2,minmax(0,1fr))}
.trio.across{padding-top:0}
.story.big h3{font-size:28px;line-height:1.12;letter-spacing:-.015em}
.story.big p{font-size:16px;-webkit-line-clamp:6}
details.more{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}
details.more summary{cursor:pointer;list-style:none;display:inline-block;font:600 11.5px/1.4 ${SANS};text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
details.more summary::after{content:" ↓"}
details.more[open] summary::after{content:" ↑"}
details.more summary::-webkit-details-marker{display:none}
details.more summary:hover{color:var(--fg)}
.cols3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:24px;margin-top:6px}

/* Rows: compact stories in lists (more, search, saved) */
.list{display:flex;flex-direction:column}
.list>.row:first-child{border-top:0}
.row{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}
.cols3 .row{border-top:1px solid var(--line)}
.row .row-text{flex:1;min-width:0}
.row h4{font-size:16px}
.row .meta{margin-top:5px}
.row .pic{width:72px;flex:none;aspect-ratio:1}
.row .ph{font-size:11px}

.empty{color:var(--muted);font-style:italic}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:44px;padding-top:12px;border-top:3px double var(--rule);font:600 12px/1.4 ${SANS};text-transform:uppercase;letter-spacing:.08em}
.pager a:hover{text-decoration:underline}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font:400 12.5px/1.6 ${SANS};text-align:center}
footer .logo{display:block;font-size:24px;margin-bottom:6px;color:var(--fg)}
footer a{text-decoration:underline;text-underline-offset:2px}
footer details{margin-top:8px}
footer details summary{cursor:pointer}
.src{columns:3 200px;margin:10px 0 0;padding:0;list-style:none;text-align:left}
.src li{padding:1px 0}
.ok{color:var(--tech)} .err{color:var(--red)}

/* Inner pages */
.intro{padding:26px 0 18px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.intro h1{margin:0;font:700 40px/1.1 ${SERIF};letter-spacing:-.015em;color:var(--ink)}
.intro p{margin:8px 0 0;color:var(--muted);font:400 13.5px/1.5 ${SANS}}
h2{font:700 15px/1.3 ${SANS};margin:36px 0 12px;padding-top:9px;border-top:2px solid var(--rule)}
h2 small{color:var(--dim);font-weight:500;font-size:12px;margin-left:6px;letter-spacing:.04em;text-transform:uppercase}
.simple ol{list-style:none;margin:0;padding:0;columns:2 320px;column-gap:32px}
.simple li{padding:10px 0;border-bottom:1px solid var(--line);break-inside:avoid;font-size:18px}
.simple li a{font-weight:600}
.simple li a:hover{text-decoration:underline}
.simple li span{font:500 11px/1 ${SANS};letter-spacing:.06em;margin-left:6px}

/* Like / save / hide sit on their own line under the source line. With a mouse they
   appear when the story is hovered or focused; a liked or saved mark always shows. */
.acts{position:relative;z-index:2;display:flex;gap:2px;flex:none}
.acts button{appearance:none;border:0;background:transparent;color:var(--dim);width:28px;height:28px;cursor:pointer;display:grid;place-items:center;padding:0;transition:opacity .15s,color .15s}
.acts svg{width:15px;height:15px}
@media (hover:hover){
  .acts button{opacity:0}
  .story:hover .acts button,.story:focus-within .acts button,.acts button[aria-pressed=true]{opacity:1}
}
.acts button:hover{background:var(--chip);color:var(--fg)}
.acts button:focus-visible{outline:2px solid var(--link);outline-offset:1px}
.acts [data-k=like][aria-pressed=true]{color:var(--red)}
.acts [data-k=save][aria-pressed=true]{color:var(--link)}
.acts [aria-pressed=true] svg{fill:currentColor}
.row>.acts{margin:0 -6px 0 0}
.is-read h3 a,.is-read h4 a{color:var(--muted)}
.is-read .pic{opacity:.75}
.undo{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0;border-top:1px dashed var(--line);color:var(--dim);font:400 13px/1.4 ${SANS}}
.undo button{appearance:none;border:1px solid var(--line);background:transparent;color:var(--fg);font:600 11px/1 ${SANS};text-transform:uppercase;letter-spacing:.08em;padding:7px 12px;cursor:pointer}
.sform{display:flex;gap:0;margin:18px 0 10px;border-bottom:2px solid var(--rule)}
.sform input{flex:1;min-width:0;font:400 22px/1.3 ${SERIF};padding:10px 0;border:0;background:transparent;color:var(--fg)}
.sform input:focus{outline:none}
.sform button,.btn{appearance:none;font:700 11.5px/1 ${SANS};text-transform:uppercase;letter-spacing:.1em;padding:12px 18px;border:0;background:var(--fg);color:var(--bg);cursor:pointer}
.sform button{align-self:center}
.stack{display:flex;flex-direction:column;gap:14px}
.tabs{display:flex;gap:22px;margin:4px 0 6px;border-bottom:1px solid var(--line);font:600 12px/1 ${SANS};text-transform:uppercase;letter-spacing:.08em}
.tabs a{padding:12px 0;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a[aria-current]{color:var(--fg);border-color:var(--rule)}
.panel{padding:4px 0}
.panel h3{margin:0 0 8px;font-size:16px}
.panel p{margin:0 0 8px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 0;padding:0;list-style:none}
.tags li,.tags a{font:500 13px/1.3 ${SANS};padding:5px 10px;border:1px solid var(--line);color:var(--fg)}
.tags a:hover{border-color:var(--rule)}
.tags small{color:var(--dim);margin-left:5px}
.meter{height:6px;background:var(--chip);overflow:hidden;margin:8px 0 4px}
.meter i{display:block;height:100%;background:var(--tech)}
.spark{display:grid;grid-template-columns:170px minmax(0,1fr) 44px;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.spark:first-of-type{border-top:0}
.spark .bars{display:flex;align-items:flex-end;gap:3px;height:34px}
.spark .bars i{flex:1;background:var(--c);min-height:2px;opacity:.85}
.spark .bars i.z{background:var(--line);opacity:1}
.spark b{font:600 14px/1.3 ${SANS};display:flex;align-items:center;gap:8px}
.spark b i{width:8px;height:8px;background:var(--c);flex:none}
.spark span{text-align:right;color:var(--dim);font:500 13px/1 ${SANS}}
.axis{display:flex;justify-content:space-between;color:var(--dim);font:400 12px/1.4 ${SANS};margin:2px 56px 0 182px}
.login{max-width:380px}
.login input{width:100%;font:400 18px/1.3 ${SERIF};padding:10px 0;border:0;border-bottom:2px solid var(--rule);background:transparent;color:var(--fg);border-radius:0}
.login input:focus{outline:none}
.note{color:var(--dim);font:400 13px/1.5 ${SANS}}
.err-msg{color:var(--red);font:400 14px/1.4 ${SANS}}

@media (max-width:960px){
  .front,.sec-grid{grid-template-columns:minmax(0,1fr)}
  .front-main,.sec-main{padding-right:0;border-right:0}
  .front-side,.sec-grid>.col{padding-left:0;margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
  .front-side{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px}
  .front-side>.story:first-child{grid-row:span 3}
  .front-side>.story+.story{margin-top:0}
  .front-side>.story:nth-child(2){border-top:0;padding-top:0}
  .cols3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .logo{font-size:46px}
}
@media (max-width:640px){
  .wrap{padding:0 16px 48px}
  .mast{padding-top:8px}
  .mast-top{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"logo right" "left left";align-items:center;gap:2px 8px;padding-bottom:8px}
  .logo,.small .logo{font-size:28px;text-align:left;padding:0}
  .mast-right{margin-right:-8px}
  .mast-right a.txt{display:none}
  .mast-left{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .mast-left b{font-weight:500}
  .mast-left span{display:none}
  .sections small{display:none}
  .sections{justify-content:flex-start;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:20px;padding:10px 0}
  .sections::-webkit-scrollbar{display:none}
  .lead{grid-template-columns:minmax(0,1fr);gap:12px}
  .lead figure{order:-1;margin:0 -16px}
  .lead figcaption{padding:0 16px}
  .lead h3,.sec-main .lead h3{font-size:25px}
  .lead.no-pic h3{font-size:30px}
  .lead.no-pic p{font-size:16px}
  .trio,.trio.pair{grid-template-columns:minmax(0,1fr);padding-top:0}
  .trio>.story{padding:16px 0 0!important;margin-top:16px;border-left:0!important;border-top:1px solid var(--line)}
  .trio>.story:first-child{border-top:0;margin-top:0}
  .front-side{display:block}
  .front-side>.story+.story{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
  .front-side>.story:first-child h3{font-size:21px}
  .story h3{font-size:19px}
  .cols3{grid-template-columns:minmax(0,1fr)}
  .intro h1{font-size:32px}
  .spark{grid-template-columns:100px minmax(0,1fr) 34px;gap:8px}
  .axis{margin:2px 42px 0 108px}
  .thumb{width:84px}
}
`;

const ICON = {
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  trends: `<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
  saved: `<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>`,
  like: `<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.6 3.8 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.2 0 5.3 3.1 4.2 6.2C19.5 15.4 12 20 12 20z"/></svg>`,
  hide: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  moon: `<svg class="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`,
  sun: `<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
};

// Light/dark switch. The page follows the device until the reader picks one; the
// choice is kept in localStorage and applied in <head> before first paint.
const THEME_HEAD = `<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>`;
const THEME_SCRIPT = `<script>
(()=>{const b=document.querySelector('.theme');if(!b)return;const r=document.documentElement;
const dark=()=>r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
const label=()=>{const l=dark()?'Switch to light mode':'Switch to dark mode';b.title=l;b.setAttribute('aria-label',l);};
label();b.addEventListener('click',()=>{const t=dark()?'light':'dark';r.dataset.theme=t;try{localStorage.setItem('theme',t)}catch(e){}label();});
})();
</script>`;

function tools(view: View, here: string): string {
  const link = (href: string, label: string, icon: string) =>
    `<a href="${href}" title="${label}" aria-label="${label}"${here === href ? ` aria-current="page"` : ""}>${icon}</a>`;
  const theme = `<button type="button" class="theme" title="Switch light or dark" aria-label="Switch light or dark">${ICON.moon}${ICON.sun}</button>`;
  return `<nav class="mast-right">${theme}${link("/search", "Search", ICON.search)}${link("/trends", "Trends", ICON.trends)}${
    view.signedIn ? link("/saved", "Saved and liked", ICON.saved) : `<a class="txt" href="/login">Sign in</a>`
  }</nav>`;
}

// Like / save / hide, plus remembering which stories were opened. Only sent to a signed-in reader.
const SCRIPT = `<script>
(()=>{
const post=(url,kind,on)=>fetch('/api/mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,kind,on}),credentials:'same-origin'}).then(r=>r.ok).catch(()=>false);
const opened=(box)=>{if(box.classList.contains('is-read'))return;box.classList.add('is-read');
 navigator.sendBeacon('/api/mark',new Blob([JSON.stringify({url:box.dataset.u,kind:'read',on:true})],{type:'application/json'}));};
const hide=(box,b)=>{const u=document.createElement('div');
 u.className='undo';u.innerHTML='<span>Hidden.</span><button type="button">Undo</button>';
 box.after(u);box.hidden=true;u.querySelector('button').onclick=async()=>{if(await post(box.dataset.u,'hide',false)){box.hidden=false;b.setAttribute('aria-pressed','false');u.remove();}};};
document.addEventListener('click',async(e)=>{
 const box=e.target.closest('[data-u]');if(!box)return;
 const b=e.target.closest('button[data-k]');
 if(b){e.preventDefault();const k=b.dataset.k,on=b.getAttribute('aria-pressed')!=='true';
  b.setAttribute('aria-pressed',String(on));
  if(!(await post(box.dataset.u,k,on))){b.setAttribute('aria-pressed',String(!on));return;}
  if(k==='hide'&&on)hide(box,b);return;}
 if(e.target.closest('a[href]'))opened(box);
});
document.addEventListener('auxclick',(e)=>{const box=e.target.closest('[data-u]');if(box&&e.button===1&&e.target.closest('a[href]'))opened(box);});
})();
</script>`;

interface PageOpts {
  head?: string;
  sections?: string; // section links under the masthead; defaults to every topic on the front page
  view?: View;
  here?: string;
  dateline?: string; // left of the nameplate: the edition date and a short note
  big?: boolean; // full-size nameplate (front page); inner pages get a smaller one
}

const defaultSections = () => TOPICS.map((t) => `<a href="/#${t.id}">${esc(t.label)}</a>`).join("");

function page(title: string, body: string, o: PageOpts = {}): string {
  const view = o.view ?? PUBLIC;
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const dateline = o.dateline ?? `<b>${esc(longDate(today))}</b><span>Ulaanbaatar edition</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A daily brief of technology, AI, software development, startups and Mongolian startup news.">
<meta name="color-scheme" content="light dark">
<link rel="alternate" type="application/rss+xml" title="news.tseku.dev" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,900;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23121212'/%3E%3Ctext x='8' y='12.5' font-family='Georgia,serif' font-weight='700' font-size='12' text-anchor='middle' fill='%23fbfaf6'%3ET%3C/text%3E%3C/svg%3E">
${THEME_HEAD}${o.head ?? ""}<style>${CSS}</style></head><body>
<header class="mast${o.big ? "" : " small"}"><div class="wrap" style="padding-bottom:0">
<div class="mast-top"><div class="mast-left">${dateline}</div><a class="logo" href="/">${esc(MASTHEAD)}</a>${tools(view, o.here ?? "")}</div>
<nav class="sections" aria-label="Sections">${o.sections ?? defaultSections()}</nav>
</div></header>
<main class="wrap">
${body}
<footer><a class="logo" href="/" style="text-decoration:none">${esc(MASTHEAD)}</a>Gathered automatically from public feeds every morning at 07:00 Ulaanbaatar time. Stories and images belong to their publishers.<br>
<a href="/archive">archive</a> · <a href="/search">search</a> · <a href="/trends">trends</a> · <a href="/feed.xml">rss</a> · <a href="/api/latest.json">json</a> · ${
    view.signedIn ? `<a href="/saved">saved</a> · <a href="/logout">sign out</a>` : `<a href="/login">sign in</a>`
  } · <a href="https://tseku.dev">tseku.dev</a></footer>
</main>${THEME_SCRIPT}${view.signedIn ? SCRIPT : ""}</body></html>`;
}

function srcName(it: Item): string {
  return srcById.get(it.source)?.name ?? it.source;
}

// A picture, or a hatched panel with the source's name when the story has none.
function pic(it: Ranked, eager = false, cls = ""): string {
  const img = it.image
    ? `<img src="${esc(it.image)}" alt="" ${eager ? `fetchpriority="high"` : `loading="lazy"`} decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<div class="pic${cls}"><span class="ph">${esc(srcName(it))}</span>${img}</div>`;
}

// "5 min read" or "412 points" leads, in the small caps line under a headline.
function meta(it: Ranked): string {
  const bits: string[] = [];
  if (it.meta) bits.push(`<span class="rt">${esc(it.meta)}</span>`);
  bits.push(esc(host(it.url)));
  if (it.also?.length) bits.push(`also in ${it.also.map((s) => esc(srcById.get(s)?.name ?? s)).join(", ")}`);
  if (it.discuss && it.discuss !== it.url) bits.push(`<a href="${esc(it.discuss)}" target="_blank" rel="noopener">discuss</a>`);
  return `<div class="meta">${bits.join(" · ")}</div>`;
}

function acts(it: Item, view: View): string {
  if (!view.signedIn) return "";
  const m = view.marks?.get(it.url);
  const btn = (k: "like" | "save" | "hide", label: string, on = false) =>
    `<button type="button" data-k="${k}" aria-pressed="${on}" title="${label}" aria-label="${label}">${ICON[k === "save" ? "saved" : k]}</button>`;
  return `<div class="acts">${btn("like", "Like", m?.liked)}${btn("save", "Save for later", m?.saved)}${btn("hide", "Hide, not interested")}</div>`;
}

function markAttrs(it: Item, view: View): { cls: string; data: string } {
  if (!view.signedIn) return { cls: "", data: "" };
  const m = view.marks?.get(it.url);
  return { cls: m?.read ? " is-read" : "", data: ` data-u="${esc(it.url)}"` };
}

const kicker = (it: Ranked, showTopic: boolean) =>
  `<div class="kick">${showTopic ? `${esc(shortLabel(it.topic))} <span>· ${esc(srcName(it))}</span>` : esc(srcName(it))}</div>`;
const headline = (it: Ranked, tag: "h3" | "h4") =>
  `<${tag}><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></${tag}>`;
const summary = (it: Ranked) => {
  const text = it.brief ?? it.summary;
  return text ? `<p>${esc(text)}</p>` : "";
};

// The lead of a page or section: headline and summary beside a large picture.
function lead(it: Ranked, showTopic: boolean, view: View): string {
  const m = markAttrs(it, view);
  const fig = it.image ? `<figure>${pic(it, true)}<figcaption>Image: ${esc(srcName(it))}</figcaption></figure>` : "";
  return `<article class="story lead t-${it.topic}${it.image ? "" : " no-pic"}${m.cls}"${m.data}><div class="lead-text">${kicker(it, showTopic)}${headline(it, "h3")}${summary(it)}
<div class="foot">${meta(it)}${acts(it, view)}</div></div>${fig}</article>`;
}

// A column story. pic: "top" shows the picture above the headline, "thumb" a small square
// floated right, "none" keeps it text only. Stories without a picture are always text only.
function story(it: Ranked, o: { pic?: "top" | "thumb" | "none"; showTopic?: boolean; tag?: "h3" | "h4"; big?: boolean; bare?: boolean }, view: View): string {
  const m = markAttrs(it, view);
  const p = it.image ? (o.pic ?? "none") : "none";
  const picHtml = p === "top" ? pic(it) : p === "thumb" ? pic(it, false, " thumb") : "";
  return `<article class="story t-${it.topic}${p === "top" ? " pic-top" : ""}${o.big ? " big" : ""}${m.cls}"${m.data}>${picHtml}${kicker(it, o.showTopic ?? false)}${headline(it, o.tag ?? "h3")}${o.bare ? "" : summary(it)}
<div class="foot">${meta(it)}${acts(it, view)}</div></article>`;
}

// A compact row: headline and source line, with a small picture on the right when there is one.
function row(it: Ranked, view: View, extra = ""): string {
  const m = markAttrs(it, view);
  return `<div class="row story t-${it.topic}${m.cls}"${m.data}><div class="row-text">${headline(it, "h4")}
<div class="meta">${esc(srcName(it))}${it.meta ? ` · <span class="rt">${esc(it.meta)}</span>` : ""} · ${esc(host(it.url))}${extra}</div></div>${
    it.image ? pic(it) : ""
  }${acts(it, view)}</div>`;
}

// Stories read back from D1 (search, saved) as rows, with a link to their edition.
function storyRows(rows: StoryRow[], view: View): string {
  return `<div class="list">${rows
    .map((r) =>
      row(
        { title: r.title, url: r.url, summary: r.summary ?? undefined, source: r.source, image: r.image ?? undefined, score: 0, topic: r.topic },
        view,
        ` · <a href="/d/${esc(r.edition)}">${esc(shortDate(r.edition))}</a>`,
      ),
    )
    .join("")}</div>`;
}

// Under a section's lead go two text stories, so the lead's column is about as tall as the
// side column next to it; the side column holds three more and the rest fold away.
const PAIR = 2;
const SIDE_ROWS = 3;

export function renderEdition(ed: Edition, dates: string[], isLatest: boolean, view: View = PUBLIC): string {
  const ranked = rank(ed.items, Date.parse(ed.generatedAt)).filter((i) => !view.marks?.get(i.url)?.hidden);
  const top = topPicks(ranked);
  const topUrls = new Set(top.map((i) => i.url));

  // Front page: lead with picture, three text stories under it, and on the right a
  // picture story followed by briefs.
  const [first, ...others] = top;
  const trio = others.slice(0, 3);
  const side = others.slice(3);
  const sideFirst = side.findIndex((it) => it.image);
  if (sideFirst > 0) side.unshift(...side.splice(sideFirst, 1));
  const front = first
    ? `<section class="front"><div class="front-main">${lead(first, true, view)}${
        trio.length ? `<div class="trio">${trio.map((it) => story(it, { showTopic: true }, view)).join("")}</div>` : ""
      }</div>${
        side.length
          ? `<div class="front-side">${// The picture story keeps its summary; the rest are briefs (headline and source line),
          // so the right column stays about as tall as the lead and the three stories under it.
          side.map((it, i) => story(it, { pic: i === 0 ? "top" : "none", showTopic: true, bare: i > 0 }, view)).join("")}</div>`
          : ""
      }</section>`
    : "";

  const topics = TOPICS.map((t) => {
    const list = ranked.filter((i) => i.topic === t.id && !topUrls.has(i.url));
    return { t, list, total: ranked.filter((i) => i.topic === t.id).length };
  });

  const sectionLinks = topics
    .filter((x) => x.list.length)
    .map(({ t, total }) => `<a href="#${t.id}">${esc(t.label)}<small>${total}</small></a>`)
    .join("");

  const sections = topics
    .filter((x) => x.list.length)
    .map(({ t, list, total }) => {
      // Lead with the best story that has a picture, if one is near the top.
      const li = list.slice(0, 3).findIndex((it) => it.image);
      const items = li > 0 ? [list[li], ...list.filter((_, i) => i !== li)] : list;
      const [head, ...rest] = items;
      // No picture to lead with: open with a row of text stories across the main
      // column (the lead in larger type) so it doesn't sit beside empty space.
      if (!head.image && rest.length) {
        const across = [head, ...rest.slice(0, PAIR)];
        const side = rest.slice(PAIR, PAIR + SIDE_ROWS);
        const folded = rest.slice(PAIR + SIDE_ROWS);
        const sideCol = side.length
          ? `<div class="col">${side.map((it, i) => story(it, { pic: i < 2 ? "thumb" : "none", tag: "h4" }, view)).join("")}</div>`
          : "";
        const foldedHtml = folded.length
          ? `<details class="more"><summary>${folded.length} more in ${esc(t.label)}</summary><div class="cols3">${folded.map((it) => row(it, view)).join("")}</div></details>`
          : "";
        return `<section id="${t.id}" class="sec t-${t.id}"><h2 class="sec-h">${esc(t.label)} <small>${total} ${total === 1 ? "story" : "stories"}</small><a class="top" href="#">Top ↑</a></h2>
<div class="sec-grid${sideCol ? "" : " solo"}"><div class="sec-main"><div class="trio across${across.length === 2 ? " pair" : ""}">${across
          .map((it, i) => story(it, { pic: "top", showTopic: false, big: i === 0 }, view))
          .join("")}</div></div>${sideCol}</div>${foldedHtml}</section>`;
      }
      // With only a couple of stories left, keep them all in the side column.
      const pair = rest.length > PAIR ? rest.slice(0, PAIR) : [];
      const shown = rest.slice(pair.length, pair.length + SIDE_ROWS);
      const hidden = rest.slice(pair.length + SIDE_ROWS);
      const col = shown.length
        ? `<div class="col">${shown.map((it, i) => story(it, { pic: i < 2 ? "thumb" : "none", tag: "h4" }, view)).join("")}</div>`
        : "";
      const more = hidden.length
        ? `<details class="more"><summary>${hidden.length} more in ${esc(t.label)}</summary><div class="cols3">${hidden.map((it) => row(it, view)).join("")}</div></details>`
        : "";
      return `<section id="${t.id}" class="sec t-${t.id}"><h2 class="sec-h">${esc(t.label)} <small>${total} ${total === 1 ? "story" : "stories"}</small><a class="top" href="#">Top ↑</a></h2>
<div class="sec-grid${col ? "" : " solo"}"><div class="sec-main">${lead(head, false, view)}${
        pair.length ? `<div class="trio pair">${pair.map((it) => story(it, {}, view)).join("")}</div>` : ""
      }</div>${col}</div>${more}</section>`;
    })
    .join("");

  const idx = dates.indexOf(ed.date);
  const older = idx >= 0 ? dates[idx + 1] : undefined;
  const newer = idx > 0 ? dates[idx - 1] : undefined;
  const pager = `<div class="pager"><span>${older ? `<a href="/d/${older}">← ${esc(shortDate(older))}</a>` : ""}</span><span>${newer ? `<a href="${idx - 1 === 0 ? "/" : `/d/${newer}`}">${esc(shortDate(newer))} →</a>` : ""}</span></div>`;

  const okSources = SOURCES.filter((s) => ed.report[s.id] && !ed.report[s.id].startsWith("error")).length;
  const srcList = SOURCES.map((s) => {
    const r = ed.report[s.id] ?? "not run";
    const cls = r.startsWith("error") ? "err" : "ok";
    return `<li><span class="${cls}">●</span> ${esc(s.name)} <span style="color:var(--dim)">${esc(r.startsWith("error") ? "unavailable" : r)}</span></li>`;
  }).join("");

  const dateline = `<b>${esc(longDate(ed.date))}</b><span>${isLatest ? "Today's paper" : `<a href="/" style="text-decoration:underline">Archive edition</a>`} · ${ed.items.length} stories · <span style="white-space:nowrap">${ubTime(ed.generatedAt)} UB</span></span>`;
  const body = `${front}${sections || (top.length ? "" : `<p class="empty" style="margin-top:24px">Nothing new today.</p>`)}${pager}
<footer style="border:0;margin-top:20px;padding-top:0"><details><summary>${okSources}/${SOURCES.length} sources worked today</summary><ul class="src">${srcList}</ul></details></footer>`;
  return page(`news.tseku.dev · ${ed.date}`, body, { sections: sectionLinks, view, here: isLatest ? "/" : "", dateline, big: true });
}

export function renderArchive(dates: string[], view: View = PUBLIC): string {
  const list = dates.length
    ? `<ol>${dates.map((d) => `<li><a href="/d/${d}">${esc(longDate(d))}</a> <span style="color:var(--dim)">${d}</span></li>`).join("")}</ol>`
    : `<p class="empty">No editions yet.</p>`;
  return page("news.tseku.dev · archive", `<div class="intro"><h1>Archive</h1><p>Every edition since the first one.</p></div><div class="simple">${list}</div>`, { view });
}

export function renderBuilding(): string {
  return page(
    "news.tseku.dev · building",
    `<div class="intro"><h1>Building the first edition</h1>
<p>This page reloads itself while it gathers today's stories. It usually takes under a minute.</p></div>`,
    { head: `<meta http-equiv="refresh" content="5">` },
  );
}

export function renderNotFound(): string {
  return page("news.tseku.dev · not found", `<div class="intro"><h1>Not found</h1><p>No edition here. <a href="/" style="text-decoration:underline">Go to today's paper.</a></p></div>`);
}
export function renderFeed(ed: Edition | null, origin: string): string {
  const items = (ed?.items ?? [])
    .map((it) => {
      const src = srcById.get(it.source);
      return `<item><title>${esc(it.title)}</title><link>${esc(it.url)}</link><guid isPermaLink="false">${esc(it.url)}</guid>${
        it.date ? `<pubDate>${new Date(it.date).toUTCString()}</pubDate>` : ""
      }<category>${esc(src?.topic ?? "tech")}</category><description>${esc([src?.name, it.brief ?? it.summary].filter(Boolean).join(" — "))}</description></item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>news.tseku.dev</title><link>${esc(origin)}/</link><description>Daily brief: technology, AI, software development, startups and Mongolia.</description>${
    ed ? `<lastBuildDate>${new Date(ed.generatedAt).toUTCString()}</lastBuildDate>` : ""
  }${items}</channel></rss>`;
}

export function renderSearch(q: string, rows: StoryRow[], view: View): string {
  const form = `<form class="sform" action="/search" method="get" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search every edition" aria-label="Search" autofocus><button>Search</button></form>`;
  const results = !q
    ? `<p class="note">Searches titles and summaries of every story since the archive began. Try a company, a product or a word in Mongolian.</p>`
    : rows.length
      ? `<p class="note">${rows.length}${rows.length >= 60 ? "+" : ""} stories</p>${storyRows(rows, view)}`
      : `<p class="empty">Nothing found for “${esc(q)}”.</p>`;
  return page(q ? `${q} · search` : "news.tseku.dev · search", `<div class="intro"><h1>Search</h1></div>${form}${results}`, { view, here: "/search" });
}

export function renderTrends(tr: Trends, reads: { topic: string; n: number }[] | null, view: View): string {
  const max = Math.max(1, ...tr.perTopic.flatMap((p) => p.counts));
  const sparks = tr.perTopic
    .map(
      (p) =>
        `<div class="spark t-${p.topic}"><b><i></i>${esc(p.label)}</b><div class="bars" role="img" aria-label="${esc(p.label)}: ${p.counts.join(", ")} stories per day">${p.counts
          .map((n, i) => `<i${n ? "" : ` class="z"`} style="height:${Math.max(6, Math.round((n / max) * 100))}%" title="${esc(shortDate(tr.days[i]))}: ${n}"></i>`)
          .join("")}</div><span>${p.total}</span></div>`,
    )
    .join("");
  const terms = tr.terms.length
    ? `<ul class="tags">${tr.terms
        .map((t) => `<li style="padding:0;border:0"><a href="/search?q=${encodeURIComponent(t.term)}">${esc(t.term)}<small>${t.week}${tr.rising ? ` vs ${(t.before / 3).toFixed(1)}` : ""}</small></a></li>`)
        .join("")}</ul>`
    : `<p class="note">Not enough stories yet.</p>`;
  const total = reads?.reduce((a, r) => a + r.n, 0) ?? 0;
  const mine =
    view.signedIn && reads
      ? `<section><h2>What you opened <small>last 30 days</small></h2><div class="panel">${
          total
            ? reads
                .map(
                  (r) =>
                    `<div class="t-${esc(r.topic)}" style="margin-bottom:10px"><b style="font:600 14px/1.3 ${SANS.replace(/"/g, "'")}">${esc(topicLabel.get(r.topic) ?? r.topic)}</b> <span class="note">${r.n} · ${Math.round((r.n / total) * 100)}%</span><div class="meter"><i style="width:${(r.n / total) * 100}%;background:var(--c)"></i></div></div>`,
                )
                .join("")
            : `<p>Nothing yet. Stories you open, like or save show up here.</p>`
        }</div></section>`
      : "";
  const body = `<div class="intro"><h1>Trends</h1><p>From every edition in the archive.</p></div>
<section><h2>${tr.rising ? "Rising this week" : "Most mentioned this week"} <small>${tr.rising ? "headlines this week vs. the weekly average before" : "headlines in the last 7 days"}</small></h2><div class="panel">${terms}</div></section>
<section><h2>Stories per topic <small>last 14 days</small></h2><div class="panel">${sparks}<div class="axis"><span>${esc(shortDate(tr.days[0]))}</span><span>${esc(shortDate(tr.days[tr.days.length - 1]))}</span></div></div></section>
${mine}`;
  return page("news.tseku.dev · trends", body, { view, here: "/trends" });
}

export function renderSaved(tab: "saved" | "liked", rows: StoryRow[], stats: SignalStats, view: View): string {
  const tabs = `<nav class="tabs"><a href="/saved"${tab === "saved" ? ` aria-current="page"` : ""}>Saved</a><a href="/saved?tab=liked"${tab === "liked" ? ` aria-current="page"` : ""}>Liked</a></nav>`;
  const list = rows.length
    ? storyRows(rows, view)
    : `<p class="empty">${tab === "saved" ? "Nothing saved yet. Use the bookmark on any story." : "Nothing liked yet. Use the heart on any story."}</p>`;
  const since = stats.first ? ` since ${esc(shortDate(new Date(stats.first + 8 * 3600_000).toISOString().slice(0, 10)))}` : "";
  const body = `<div class="intro"><h1>Saved</h1><p>${stats.reads} opened · ${stats.likes} liked · ${stats.saves} saved · ${stats.hides} hidden${since}</p></div>
${tabs}${list}`;
  return page("news.tseku.dev · saved", body, { view, here: "/saved" });
}

export function renderLogin(error: boolean, configured: boolean): string {
  const body = `<div class="intro"><h1>Sign in</h1><p>Signing in turns on like, save and hide, and remembers which stories you open.</p></div>
${configured ? `<form class="login stack" method="post" action="/login" style="margin-top:20px"><input type="password" name="token" placeholder="Passphrase" aria-label="Passphrase" autocomplete="current-password" autofocus required>${
    error ? `<p class="err-msg" style="margin:0">That passphrase didn't match.</p>` : ""
  }<button class="btn" style="align-self:flex-start">Sign in</button></form>` : `<p class="empty">Sign-in is off until the <code>ADMIN_TOKEN</code> secret is set.</p>`}`;
  return page("news.tseku.dev · sign in", body);
}
