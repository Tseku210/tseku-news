// Where the daily edition comes from. Every source is fetched without a browser.
// kind:
//   rss       RSS 2.0 or Atom feed
//   tldr      TLDR newsletter feed; the newest issue page is opened and split into stories
//   hn        Hacker News front page via the Algolia API (JSON)
//   launchpad launchpad.mn home page (weekly Mongolian product launches; it has no feed)
//   ikon      ikon.mn technology section page (Mongolian tech news)

export type Topic = "ai" | "dev" | "startups" | "tech" | "mongolia" | "blogs";

export interface Source {
  id: string;
  name: string;
  kind: "rss" | "tldr" | "hn" | "launchpad" | "ikon";
  url: string;
  topic: Topic;
  max: number; // most items taken from this source per day
  weight: number; // how much a story from here counts when picking top stories (1 = normal)
}

export const TOPICS: { id: Topic; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "dev", label: "Software development" },
  { id: "startups", label: "Startups" },
  { id: "tech", label: "Technology" },
  { id: "mongolia", label: "Mongolia" },
  { id: "blogs", label: "Blogs" },
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

  // Blogs: personal writers Tseku reads. articles.xml is articles only; feed.xml also has tweets and book notes.
  { id: "sivers", name: "Derek Sivers", kind: "rss", url: "https://sive.rs/articles.xml", topic: "blogs", max: 3, weight: 1.3 },
  { id: "dankoe", name: "Dan Koe", kind: "rss", url: "https://letters.thedankoe.com/feed", topic: "blogs", max: 3, weight: 1.3 },
  { id: "ink-impact", name: "Ink & Impact", kind: "rss", url: "https://tushigterdene.substack.com/feed", topic: "blogs", max: 3, weight: 1.3 },
];

