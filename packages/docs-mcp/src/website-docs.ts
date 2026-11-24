import { load } from "cheerio";
import { SaxesParser } from "saxes";

const CACHE_MS = 5 * 60_000;
const RETRY_MS = 30_000;
const MAX_SITEMAPS = 16;
const MAX_PAGES = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 65_536;
const PAGE_CONCURRENCY = 12;
const SEARCH_BUDGET_MS = 120_000;
const PAGE_FETCH_MS = 8_000;

export interface SearchMatch {
  path: string;
  sourceUrl: string;
  snippet: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  scanned: number;
  total: number;
  partial: boolean;
  stale: boolean;
}

interface Catalog {
  pages: Map<string, URL>;
  texts: Map<string, string>;
  updatedAt: string;
  truncated: boolean;
  stale: boolean;
  expiresAt: number;
}

function parseUrl(value: string, base?: URL): URL | undefined {
  try {
    const url = new URL(value, base);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && !url.search && !url.hash &&
      !/%(?:25|2f|5c)/i.test(url.pathname)
    ) {
      return url;
    }
  } catch {
    // Invalid locations have no place in the catalog.
  }
  return undefined;
}

function parseSitemap(xml: string): { isIndex: boolean; locations: string[] } {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  let root = "";
  let location = "";
  const locations: string[] = [];
  let inLocation = false;

  parser.on("doctype", () => { throw new Error("Sitemap declarations are unsupported."); });
  parser.on("opentag", ({ local }) => {
    stack.push(local);
    if (stack.length === 1) {
      root = local;
      if (root !== "urlset" && root !== "sitemapindex") {
        throw new Error("Expected a sitemap XML document.");
      }
    }
    const entry = root === "urlset" ? "url" : "sitemap";
    inLocation = stack.length === 3 && stack[1] === entry && local === "loc";
    if (inLocation) location = "";
  });
  const append = (text: string) => {
    if (inLocation) location += text;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (inLocation) locations.push(location.trim());
    inLocation = false;
    stack.pop();
  });

  try {
    parser.write(xml).close();
  } catch {
    throw new Error("Invalid sitemap XML. Check DOCS_SITEMAP_URL.");
  }

  return { isIndex: root === "sitemapindex", locations };
}

async function fetchText(
  initial: URL,
  allowed: (url: URL) => boolean,
  signal: AbortSignal,
  accept: string,
): Promise<string> {
  let url = initial;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowed(url)) throw new Error("URL is outside the configured documentation site.");
    const response = await fetch(url, { redirect: "manual", signal: deadline, headers: { Accept: accept } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Invalid documentation redirect.");
      // parseUrl alone is not enough: sites may redirect https → http on the same host.
      let next: URL | undefined;
      try {
        next = new URL(location, url);
        if (
          next.protocol === "http:" &&
          url.protocol === "https:" &&
          next.hostname === url.hostname
        ) {
          next = new URL(next.href.replace(/^http:/i, "https:"));
        }
        if (
          (next.protocol !== "https:" && next.protocol !== "http:") ||
          next.username || next.password || next.search || next.hash
        ) {
          next = undefined;
        }
      } catch {
        next = undefined;
      }
      if (!next) throw new Error("Invalid documentation redirect.");
      url = next;
      continue;
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Documentation site returned HTTP ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          throw new Error("Documentation response exceeds 2 MiB.");
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new Error("Too many documentation redirects.");
}

function articleText(html: string): string {
  const $ = load(html);
  const markdown = $("main .theme-doc-markdown").first();
  const article = markdown.length ? markdown : $("main article, article").first();
  article.find("script, style, noscript, nav, footer, aside, button, svg, [hidden], a.hash-link").remove();
  article.find("br").replaceWith("\n");
  article.find("h1, h2, h3, h4, h5, h6, p, li, pre, tr, blockquote").before("\n").after("\n");
  article.find("th, td").after(" ");

  const text = article.text().replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No documentation article found.");
  if (text.length > MAX_TEXT_LENGTH) throw new Error("Documentation article is too large.");
  return text;
}

function queryTokens(query: string): string[] {
  const lowered = query.toLowerCase();
  const basic = lowered.split(/[^a-z0-9äöüß]+/i).filter((token) => token.length > 2);
  const camel = query
    .replace(/([a-zäöüß])([A-ZÄÖÜ])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .filter((token) => token.length > 2);
  return [...new Set([...basic, ...camel, lowered].filter((token) => token.length > 1))];
}

function pathScore(path: string, tokens: string[]): number {
  const haystack = path.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 4 ? 5 : 2;
  }
  return score;
}

function snippetAround(content: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + queryLength + 40);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

export class WebsiteDocs {
  private readonly sitemapUrl: URL;
  private readonly pathPrefix: string;
  private catalog: Catalog | undefined;
  private refreshing: Promise<Catalog> | undefined;

  constructor(sitemapUrl: string, pathPrefix?: string) {
    const url = parseUrl(sitemapUrl);
    if (!url) throw new Error("Set DOCS_SITEMAP_URL to an absolute HTTP(S) sitemap URL.");
    this.sitemapUrl = url;

    const prefix = pathPrefix || url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    const resolved = parseUrl(prefix, url);
    if (!prefix.startsWith("/") || !resolved || resolved.origin !== url.origin || resolved.pathname !== prefix) {
      throw new Error("Set DOCS_SITE_PATH to a site path such as /handbuch/docs.");
    }
    this.pathPrefix = prefix.replace(/\/+$/, "");
  }

  /** Same host; allow http↔https redirects that internal Materna sites often emit. */
  private sameSite = (url: URL): boolean =>
    url.hostname === this.sitemapUrl.hostname &&
    (url.protocol === "https:" || url.protocol === "http:");

  private allowedPage = (url: URL): boolean => {
    if (!this.sameSite(url)) return false;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return pathname === this.pathPrefix || pathname.startsWith(`${this.pathPrefix}/`);
  };

  private async loadCatalog(): Promise<Catalog> {
    const pending = [this.sitemapUrl];
    const seen = new Set([this.sitemapUrl.href]);
    const pages = new Map<string, URL>();
    const signal = AbortSignal.timeout(15_000);
    let truncated = false;

    for (const url of pending) {
      const { isIndex, locations } = parseSitemap(await fetchText(url, this.sameSite, signal, "application/xml, text/xml"));
      for (const location of locations) {
        const target = location && parseUrl(location, url);
        if (!target || !this.sameSite(target)) continue;
        if (isIndex) {
          if (seen.has(target.href)) continue;
          if (seen.size === MAX_SITEMAPS) {
            truncated = true;
            continue;
          }
          seen.add(target.href);
          pending.push(target);
        } else if (this.allowedPage(target)) {
          const path = target.pathname.slice(1).replace(/\/$/, "") || "/";
          if (path.length > 4096 || pages.has(path)) continue;
          if (pages.size === MAX_PAGES) {
            truncated = true;
            continue;
          }
          pages.set(path, target);
        }
      }
    }

    if (!pages.size) throw new Error("No sitemap entries match the configured site and DOCS_SITE_PATH.");
    return {
      pages: new Map([...pages].sort(([left], [right]) => left.localeCompare(right))),
      texts: new Map(),
      truncated,
      updatedAt: new Date().toISOString(),
      expiresAt: Date.now() + CACHE_MS,
      stale: false,
    };
  }

  async getCatalog(): Promise<Catalog> {
    if (this.catalog && this.catalog.expiresAt > Date.now()) return this.catalog;
    this.refreshing ??= this.loadCatalog().then((catalog) => {
      this.catalog = catalog;
      return catalog;
    }).catch((error: unknown) => {
      if (!this.catalog) throw error;
      this.catalog.stale = true;
      this.catalog.expiresAt = Date.now() + RETRY_MS;
      return this.catalog;
    }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async getPage(catalog: Catalog, path: string, url: URL, signal: AbortSignal): Promise<string> {
    const cached = catalog.texts.get(path);
    if (cached !== undefined) return cached;
    const pageSignal = AbortSignal.any([signal, AbortSignal.timeout(PAGE_FETCH_MS)]);
    const text = articleText(await fetchText(url, this.allowedPage, pageSignal, "text/html"));
    catalog.texts.set(path, text);
    return text;
  }

  async read(path: string): Promise<{ text: string; sourceUrl: string; stale: boolean }> {
    const catalog = await this.getCatalog();
    const url = catalog.pages.get(path);
    if (!url) throw new Error("Unknown document ID. Use list_docs or search_docs.");
    const text = await this.getPage(catalog, path, url, AbortSignal.timeout(PAGE_FETCH_MS));
    return { text, sourceUrl: url.href, stale: catalog.stale };
  }

  /**
   * Streams page fetches, prioritizes URL paths matching query tokens, and
   * returns as soon as enough content matches are found (no full-site index).
   */
  async search(query: string, limit: number): Promise<SearchResult> {
    const catalog = await this.getCatalog();
    const needle = query.toLowerCase();
    const tokens = queryTokens(query);
    const pages = [...catalog.pages].sort(
      ([left], [right]) => pathScore(right, tokens) - pathScore(left, tokens),
    );

    const matches: SearchMatch[] = [];
    let scanned = 0;
    const budget = AbortSignal.timeout(SEARCH_BUDGET_MS);

    for (let start = 0; start < pages.length && !budget.aborted && matches.length < limit; start += PAGE_CONCURRENCY) {
      const batch = pages.slice(start, start + PAGE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async ([path, url]) => {
          const text = await this.getPage(catalog, path, url, budget);
          return { path, url, text };
        }),
      );

      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        scanned += 1;
        const { path, url, text } = result.value;
        const index = text.toLowerCase().indexOf(needle);
        if (index === -1) continue;
        matches.push({
          path,
          sourceUrl: url.href,
          snippet: snippetAround(text, index, query.length),
        });
        if (matches.length >= limit) break;
      }
    }

    return {
      matches,
      scanned,
      total: catalog.pages.size,
      partial: catalog.truncated || scanned < catalog.pages.size || budget.aborted,
      stale: catalog.stale,
    };
  }
}
