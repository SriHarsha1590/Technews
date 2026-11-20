import type { Source } from '@technews/shared';

// Curated allowlist: only these feeds are ever ingested. Check each URL still works when adding it.
// ownDomains: sites the company owns (registrable domains). Try-it links must point to one of these.
const GOOGLE = ['blog.google', 'google.com', 'google.dev', 'deepmind.google', 'googleblog.com', 'withgoogle.com', 'android.com'];
const MICROSOFT = ['microsoft.com', 'azure.com', 'visualstudio.com', 'windows.com'];

export const SOURCES: Source[] = [
  // Official: companies announcing their own things
  { id: 'github-blog', name: 'GitHub Blog', url: 'https://github.blog/feed/', category: 'dev', trustTier: 'official', ownDomains: ['github.blog', 'github.com'] },
  { id: 'hf-blog', name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', category: 'ai', trustTier: 'official', ownDomains: ['huggingface.co'] },
  { id: 'openai-news', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', category: 'ai', trustTier: 'official', ownDomains: ['openai.com', 'chatgpt.com'] },
  { id: 'google-ai', name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', category: 'ai', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', category: 'ai', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'google-dev', name: 'Google Developers Blog', url: 'https://developers.googleblog.com/feeds/posts/default', category: 'dev', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'android-dev', name: 'Android Developers Blog', url: 'https://android-developers.googleblog.com/feeds/posts/default', category: 'dev', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'google-security', name: 'Google Security Blog', url: 'https://security.googleblog.com/feeds/posts/default', category: 'security', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'google-cloud', name: 'Google Cloud Blog', url: 'https://cloudblog.withgoogle.com/rss/', category: 'cloud', trustTier: 'official', ownDomains: GOOGLE },
  { id: 'microsoft', name: 'Microsoft', url: 'https://blogs.microsoft.com/feed/', category: 'general', trustTier: 'official', ownDomains: MICROSOFT },
  { id: 'azure', name: 'Microsoft Azure Blog', url: 'https://azure.microsoft.com/en-us/blog/feed/', category: 'cloud', trustTier: 'official', ownDomains: MICROSOFT },
  { id: 'aws-news', name: 'AWS News Blog', url: 'https://aws.amazon.com/blogs/aws/feed/', category: 'cloud', trustTier: 'official', ownDomains: ['amazon.com'] },
  { id: 'cloudflare-blog', name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/', category: 'cloud', trustTier: 'official', ownDomains: ['cloudflare.com'] },
  { id: 'apple', name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss', category: 'general', trustTier: 'official', ownDomains: ['apple.com'] },
  { id: 'nvidia', name: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/', category: 'ai', trustTier: 'official', ownDomains: ['nvidia.com'] },
  { id: 'meta-eng', name: 'Engineering at Meta', url: 'https://engineering.fb.com/feed/', category: 'dev', trustTier: 'official', ownDomains: ['fb.com', 'meta.com', 'facebook.com', 'llama.com'] },
  { id: 'netflix-tech', name: 'Netflix TechBlog', url: 'https://netflixtechblog.com/feed', category: 'dev', trustTier: 'official', ownDomains: ['netflixtechblog.com', 'netflix.com'] },
  { id: 'mozilla-hacks', name: 'Mozilla Hacks', url: 'https://hacks.mozilla.org/feed/', category: 'dev', trustTier: 'official', ownDomains: ['mozilla.org', 'firefox.com'] },
  { id: 'kubernetes', name: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml', category: 'cloud', trustTier: 'official', ownDomains: ['kubernetes.io', 'k8s.io'] },
  { id: 'docker', name: 'Docker Blog', url: 'https://www.docker.com/blog/feed/', category: 'dev', trustTier: 'official', ownDomains: ['docker.com'] },
  { id: 'rust-blog', name: 'Rust Blog', url: 'https://blog.rust-lang.org/feed.xml', category: 'dev', trustTier: 'official', ownDomains: ['rust-lang.org', 'crates.io'] },
  { id: 'python-insider', name: 'Python Insider', url: 'https://blog.python.org/feeds/posts/default', category: 'dev', trustTier: 'official', ownDomains: ['python.org'] },

  // Press: established English-language tech and news publications
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'general', trustTier: 'press' },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'general', trustTier: 'press' },
  { id: 'ars', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'general', trustTier: 'press' },
  { id: 'wired', name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'general', trustTier: 'press' },
  { id: 'engadget', name: 'Engadget', url: 'https://www.engadget.com/rss.xml', category: 'general', trustTier: 'press' },
  { id: 'zdnet', name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml', category: 'general', trustTier: 'press' },
  { id: 'register', name: 'The Register', url: 'https://www.theregister.com/headlines.atom', category: 'general', trustTier: 'press' },
  { id: 'mit-tr', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'general', trustTier: 'press' },
  { id: 'ieee-spectrum', name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', category: 'research', trustTier: 'press' },
  { id: 'bbc-tech', name: 'BBC News Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', category: 'general', trustTier: 'press' },
  { id: 'guardian-tech', name: 'The Guardian Technology', url: 'https://www.theguardian.com/uk/technology/rss', category: 'general', trustTier: 'press' },
  { id: 'nyt-tech', name: 'The New York Times Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', category: 'general', trustTier: 'press' },
  { id: 'cnbc-tech', name: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', category: 'general', trustTier: 'press' },
  { id: 'new-stack', name: 'The New Stack', url: 'https://thenewstack.io/feed/', category: 'cloud', trustTier: 'press' },
  { id: 'toms-hardware', name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all', category: 'general', trustTier: 'press' },
  { id: '9to5mac', name: '9to5Mac', url: 'https://9to5mac.com/feed/', category: 'general', trustTier: 'press' },
  { id: 'bleeping', name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'security', trustTier: 'press' },
  { id: 'krebs', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', category: 'security', trustTier: 'press' },
  { id: 'thehackernews', name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'security', trustTier: 'press' },
  { id: 'darkreading', name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', category: 'security', trustTier: 'press' },

  // Community: what developers are sharing
  { id: 'hn', name: 'Hacker News', url: 'https://hnrss.org/frontpage', category: 'general', trustTier: 'community', aggregator: true },
  { id: 'show-hn', name: 'Show HN', url: 'https://hnrss.org/show', category: 'tools', trustTier: 'community', aggregator: true },
  { id: 'devto', name: 'DEV Community', url: 'https://dev.to/feed', category: 'dev', trustTier: 'community' },
  { id: 'arxiv-ai', name: 'arXiv cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI', category: 'research', trustTier: 'community' },
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/feed', category: 'tools', trustTier: 'community' },
];
