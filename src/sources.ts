// Where the daily edition comes from. Every source is fetched without a browser.
// kind:
//   rss       RSS 2.0 or Atom feed
//   tldr      TLDR newsletter feed; the newest issue page is opened and split into stories
//   hn        Hacker News front page via the Algolia API (JSON)
//   launchpad launchpad.mn home page (weekly Mongolian product launches; it has no feed)
//   ikon      ikon.mn technology section page (Mongolian tech news)
//   unread    unread.today home page (Mongolian long-form media; it has no feed)
//   social    one person's posts: X (embed timeline) plus Bluesky when they have it. See social.ts

export type Topic = "ai" | "dev" | "startups" | "tech" | "mongolia" | "blogs" | "posts";

export interface Source {
  id: string;
  name: string;
  kind: "rss" | "tldr" | "hn" | "launchpad" | "ikon" | "unread" | "social";
  url: string;
  topic: Topic;
  max: number; // most items taken from this source per day
  weight: number; // how much a story from here counts when picking top stories (1 = normal)
  x?: string; // social: X handle
  bsky?: string; // social: Bluesky handle, only when it is the person's own domain
}

export const TOPICS: { id: Topic; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "dev", label: "Software development" },
  { id: "startups", label: "Startups" },
  { id: "tech", label: "Technology" },
  { id: "mongolia", label: "Mongolia" },
  { id: "blogs", label: "Blogs" },
  { id: "posts", label: "Posts" },
];

export const SOURCES: Source[] = [
  // AI
  { id: "tldr-ai", name: "TLDR AI", kind: "tldr", url: "https://tldr.tech/api/rss/ai", topic: "ai", max: 12, weight: 1.4 },
  { id: "openai", name: "OpenAI News", kind: "rss", url: "https://openai.com/news/rss.xml", topic: "ai", max: 4, weight: 1.6 },
  { id: "huggingface", name: "Hugging Face Blog", kind: "rss", url: "https://huggingface.co/blog/feed.xml", topic: "ai", max: 4, weight: 1.1 },
  { id: "simonw", name: "Simon Willison", kind: "rss", url: "https://simonwillison.net/atom/entries/", topic: "ai", max: 4, weight: 1.3 },
  { id: "tc-ai", name: "TechCrunch AI", kind: "rss", url: "https://techcrunch.com/category/artificial-intelligence/feed/", topic: "ai", max: 6, weight: 1.0 },

  // Software development
  { id: "tldr-dev", name: "TLDR Dev", kind: "tldr", url: "https://tldr.tech/api/rss/webdev", topic: "dev", max: 12, weight: 1.3 },
  { id: "github-blog", name: "GitHub Blog", kind: "rss", url: "https://github.blog/feed/", topic: "dev", max: 4, weight: 1.0 },
  { id: "pragmatic", name: "The Pragmatic Engineer", kind: "rss", url: "https://blog.pragmaticengineer.com/rss/", topic: "dev", max: 3, weight: 1.3 },

  // Startups
  { id: "tldr-founders", name: "TLDR Founders", kind: "tldr", url: "https://tldr.tech/api/rss/founders", topic: "startups", max: 10, weight: 1.1 },
  { id: "tc-startups", name: "TechCrunch Startups", kind: "rss", url: "https://techcrunch.com/category/startups/feed/", topic: "startups", max: 8, weight: 0.9 },

  // Technology
  { id: "tldr-tech", name: "TLDR Tech", kind: "tldr", url: "https://tldr.tech/api/rss/tech", topic: "tech", max: 12, weight: 1.2 },
  { id: "hn", name: "Hacker News", kind: "hn", url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50", topic: "tech", max: 15, weight: 1.0 },

  // Mongolia
  { id: "launchpad", name: "Launchpad.mn", kind: "launchpad", url: "https://launchpad.mn/", topic: "mongolia", max: 10, weight: 1.2 },
  { id: "ikon-tech", name: "iKon.mn Технологи", kind: "ikon", url: "https://ikon.mn/l/7", topic: "mongolia", max: 8, weight: 1.0 },
  { id: "unread", name: "Unread", kind: "unread", url: "https://unread.today/", topic: "mongolia", max: 6, weight: 1.2 },

  // Blogs: personal writers Tseku reads. articles.xml is articles only; feed.xml also has tweets and book notes.
  { id: "sivers", name: "Derek Sivers", kind: "rss", url: "https://sive.rs/articles.xml", topic: "blogs", max: 3, weight: 1.3 },
  { id: "dankoe", name: "Dan Koe", kind: "rss", url: "https://letters.thedankoe.com/feed", topic: "blogs", max: 3, weight: 1.3 },
  { id: "ink-impact", name: "Ink & Impact", kind: "rss", url: "https://tushigterdene.substack.com/feed", topic: "blogs", max: 3, weight: 1.3 },

  // Posts: people Tseku follows on X. Up to three posts each a day, newest first; they get
  // their own section and stay off the front page. Guessed handles: Tibo = thsottiaux
  // (OpenAI Codex), poteto = potetotes (Lauren Tan), Shu Ding = shuding_, Emil = emilkowalski_.
  { id: "x-alexhormozi", name: "Alex Hormozi", kind: "social", url: "https://x.com/AlexHormozi", topic: "posts", max: 3, weight: 1, x: "AlexHormozi" },
  { id: "x-naval", name: "Naval", kind: "social", url: "https://x.com/naval", topic: "posts", max: 3, weight: 1, x: "naval" },
  { id: "x-paulg", name: "Paul Graham", kind: "social", url: "https://x.com/paulg", topic: "posts", max: 3, weight: 1, x: "paulg" },
  { id: "x-andrewyng", name: "Andrew Ng", kind: "social", url: "https://x.com/AndrewYNg", topic: "posts", max: 3, weight: 1, x: "AndrewYNg" },
  { id: "x-darioamodei", name: "Dario Amodei", kind: "social", url: "https://x.com/DarioAmodei", topic: "posts", max: 3, weight: 1, x: "DarioAmodei" },
  { id: "x-karpathy", name: "Andrej Karpathy", kind: "social", url: "https://x.com/karpathy", topic: "posts", max: 3, weight: 1, x: "karpathy" },
  { id: "x-anthropicai", name: "Anthropic", kind: "social", url: "https://x.com/AnthropicAI", topic: "posts", max: 3, weight: 1, x: "AnthropicAI", bsky: "anthropic.com" },
  { id: "x-claudedevs", name: "Claude Devs", kind: "social", url: "https://x.com/ClaudeDevs", topic: "posts", max: 3, weight: 1, x: "ClaudeDevs" },
  { id: "x-bcherny", name: "Boris Cherny", kind: "social", url: "https://x.com/bcherny", topic: "posts", max: 3, weight: 1, x: "bcherny" },
  { id: "x-trq212", name: "Thariq", kind: "social", url: "https://x.com/trq212", topic: "posts", max: 3, weight: 1, x: "trq212" },
  { id: "x-thsottiaux", name: "Tibo", kind: "social", url: "https://x.com/thsottiaux", topic: "posts", max: 3, weight: 1, x: "thsottiaux" },
  { id: "x-lydiahallie", name: "Lydia Hallie", kind: "social", url: "https://x.com/lydiahallie", topic: "posts", max: 3, weight: 1, x: "lydiahallie" },
  { id: "x-potetotes", name: "Lauren Tan", kind: "social", url: "https://x.com/potetotes", topic: "posts", max: 3, weight: 1, x: "potetotes" },
  { id: "x-shuding_", name: "Shu Ding", kind: "social", url: "https://x.com/shuding_", topic: "posts", max: 3, weight: 1, x: "shuding_" },
  { id: "x-shadcn", name: "shadcn", kind: "social", url: "https://x.com/shadcn", topic: "posts", max: 3, weight: 1, x: "shadcn", bsky: "shadcn.com" },
  { id: "x-danhollick", name: "Dan Hollick", kind: "social", url: "https://x.com/DanHollick", topic: "posts", max: 3, weight: 1, x: "DanHollick" },
  { id: "x-ctatedev", name: "Chris Tate", kind: "social", url: "https://x.com/ctatedev", topic: "posts", max: 3, weight: 1, x: "ctatedev" },
  { id: "x-addyosmani", name: "Addy Osmani", kind: "social", url: "https://x.com/addyosmani", topic: "posts", max: 3, weight: 1, x: "addyosmani", bsky: "addyosmani.com" },
  { id: "x-gergelyorosz", name: "Gergely Orosz", kind: "social", url: "https://x.com/GergelyOrosz", topic: "posts", max: 3, weight: 1, x: "GergelyOrosz" },
  { id: "x-tannerlinsley", name: "Tanner Linsley", kind: "social", url: "https://x.com/tannerlinsley", topic: "posts", max: 3, weight: 1, x: "tannerlinsley", bsky: "tannerlinsley.com" },
  { id: "x-steipete", name: "Peter Steinberger", kind: "social", url: "https://x.com/steipete", topic: "posts", max: 3, weight: 1, x: "steipete", bsky: "steipete.me" },
  { id: "x-thedankoe", name: "Dan Koe", kind: "social", url: "https://x.com/thedankoe", topic: "posts", max: 3, weight: 1, x: "thedankoe" },
  { id: "x-emilkowalski_", name: "Emil Kowalski", kind: "social", url: "https://x.com/emilkowalski_", topic: "posts", max: 3, weight: 1, x: "emilkowalski_", bsky: "emilkowal.ski" },
  { id: "x-leerob", name: "Lee Robinson", kind: "social", url: "https://x.com/leerob", topic: "posts", max: 3, weight: 1, x: "leerob", bsky: "leerob.com" },
  { id: "x-theo", name: "Theo", kind: "social", url: "https://x.com/theo", topic: "posts", max: 3, weight: 1, x: "theo", bsky: "t3.gg" },
  { id: "x-rauchg", name: "Guillermo Rauch", kind: "social", url: "https://x.com/rauchg", topic: "posts", max: 3, weight: 1, x: "rauchg", bsky: "rauchg.com" },
  { id: "x-vercel", name: "Vercel", kind: "social", url: "https://x.com/vercel", topic: "posts", max: 3, weight: 1, x: "vercel", bsky: "vercel.com" },
  { id: "x-cloudflare", name: "Cloudflare", kind: "social", url: "https://x.com/Cloudflare", topic: "posts", max: 3, weight: 1, x: "Cloudflare" },
];
