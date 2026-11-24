import { load } from "cheerio";
import { SaxesParser } from "saxes";

const CACHE_MS = 5 * 60_000;
const RETRY_MS = 30_000;
const MAX_SITEMAPS = 16;
const MAX_PAGES = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LENGTH = 65_536;
const PAGE_CONCURRENCY = 6;

interface SearchIndex {
  documents: Array<{ path: string; text: string; sourceUrl: string }>;
  scanned: number;
  partial: boolean;
}

interface Catalog {
  pages: Map<string, URL>;
  texts: Map<string, string>;
  updatedAt: string;
  truncated: boolean;
  stale: boolean;
  expiresAt: number;
  searchIndex?: Promise<SearchIndex>;
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
      const next = location && parseUrl(location, url);
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

  private sameOrigin = (url: URL): boolean => url.origin === this.sitemapUrl.origin;

  private allowedPage = (url: URL): boolean =>
    this.sameOrigin(url) &&
    (url.pathname === this.pathPrefix || url.pathname.startsWith(`${this.pathPrefix}/`));

  private async loadCatalog(): Promise<Catalog> {
    const pending = [this.sitemapUrl];
    const seen = new Set([this.sitemapUrl.href]);
    const pages = new Map<string, URL>();
    const signal = AbortSignal.timeout(15_000);
    let truncated = false;

    for (const url of pending) {
      const { isIndex, locations } = parseSitemap(await fetchText(url, this.sameOrigin, signal, "application/xml, text/xml"));
      for (const location of locations) {
        const target = location && parseUrl(location, url);
        if (!target || !this.sameOrigin(target)) continue;
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
    const text = articleText(await fetchText(url, this.allowedPage, signal, "text/html"));
    catalog.texts.set(path, text);
    return text;
  }

  async read(path: string): Promise<{ text: string; sourceUrl: string; stale: boolean }> {
    const catalog = await this.getCatalog();
    const url = catalog.pages.get(path);
    if (!url) throw new Error("Unknown document ID. Use list_docs or search_docs.");
    const text = await this.getPage(catalog, path, url, AbortSignal.timeout(5_000));
    return { text, sourceUrl: url.href, stale: catalog.stale };
  }

  async searchIndex(catalog: Catalog): Promise<SearchIndex> {
    catalog.searchIndex ??= this.buildIndex(catalog);
    return catalog.searchIndex;
  }

  private async buildIndex(catalog: Catalog): Promise<SearchIndex> {
    const pages = [...catalog.pages];
    const signal = AbortSignal.timeout(20_000);
    for (let start = 0; start < pages.length && !signal.aborted; start += PAGE_CONCURRENCY) {
      await Promise.allSettled(pages.slice(start, start + PAGE_CONCURRENCY).map(
        ([path, url]) => this.getPage(catalog, path, url, signal),
      ));
    }

    const documents: SearchIndex["documents"] = [];
    for (const [path, url] of pages) {
      const text = catalog.texts.get(path);
      if (text !== undefined) documents.push({ path, text, sourceUrl: url.href });
    }
    return {
      documents,
      scanned: documents.length,
      partial: catalog.truncated || documents.length < pages.length,
    };
  }
}
