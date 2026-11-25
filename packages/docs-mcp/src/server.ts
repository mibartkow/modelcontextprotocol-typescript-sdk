import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listMarkdownFiles,
  readMarkdownFile,
  resolveDocsRoot,
} from "./paths.js";
import { WebsiteDocs } from "./website-docs.js";

let websiteDocs: WebsiteDocs | undefined;

function* localDocuments(): Generator<{ path: string; text: string }> {
  const root = resolveDocsRoot();
  for (const path of listMarkdownFiles(root)) {
    let text: string;
    try {
      text = readMarkdownFile(root, path);
    } catch {
      // A listed file can become unavailable before it is read.
      continue;
    }
    yield { path, text };
  }
}

export function createDocsServer(): McpServer {
  const sitemap = process.env.DOCS_SITEMAP_URL?.trim();
  const server = new McpServer(
    {
      name: "docs-mcp",
      version: "1.0.0",
    },
    {
      instructions: sitemap
        ? "Use search_docs for DigiDEV questions. Prefer returned HTTPS sourceUrl matches. Do not confuse DigiDEV APIs with Vitest or other npm packages."
        : "Documentation comes from local Markdown/MDX files under DOCS_ROOT.",
    },
  );
  registerDocsTools(server);
  return server;
}

export function registerDocsTools(server: McpServer): void {
  const sitemap = process.env.DOCS_SITEMAP_URL?.trim();
  const website = sitemap
    ? (websiteDocs ??= new WebsiteDocs(sitemap, process.env.DOCS_SITE_PATH?.trim()))
    : undefined;

  server.registerTool(
    "list_docs",
    {
      title: "List documentation",
      description: "Lists document IDs in pages with source URLs for website documents. Pass a returned ID to read_doc.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(250).default(100),
      },
    },
    async ({ offset, limit }) => {
      const catalog = await website?.getCatalog();
      const allFiles = catalog ? [...catalog.pages.keys()] : listMarkdownFiles(resolveDocsRoot());
      const files = allFiles.slice(offset, offset + limit);
      const nextOffset = offset + files.length < allFiles.length
        ? offset + files.length
        : null;
      const documents = files.map((path) => ({
        path,
        ...(catalog?.pages.get(path)?.href && { sourceUrl: catalog.pages.get(path)!.href }),
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: documents.length,
              total: allFiles.length,
              documents,
              nextOffset,
              ...(catalog && {
                truncated: catalog.truncated,
                stale: catalog.stale,
                indexedAt: catalog.updatedAt,
              }),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search DigiDEV documentation",
      description:
        "Searches DigiDEV docs case-insensitively and returns HTTPS sourceUrl matches. Use these results for DigiDEV API/module questions; do not fall back to Vitest or node_modules.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Search string"),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe("Max number of matching documents to return"),
      },
    },
    async ({ query, limit }) => {
      if (website) {
        const result = await website.search(query, limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query,
                count: result.matches.length,
                matches: result.matches,
                scanned: result.scanned,
                total: result.total,
                partial: result.partial,
                stale: result.stale,
              }),
            },
          ],
        };
      }

      const needle = query.toLowerCase();
      const matches: Array<{ path: string; snippet: string }> = [];
      let scanned = 0;
      for (const { path, text: content } of localDocuments()) {
        scanned += 1;
        const index = content.toLowerCase().indexOf(needle);
        if (index === -1) continue;
        const start = Math.max(0, index - 40);
        const end = Math.min(content.length, index + query.length + 40);
        matches.push({
          path,
          snippet: content.slice(start, end).replace(/\s+/g, " ").trim(),
        });
        if (matches.length === limit) break;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query,
              count: matches.length,
              matches,
              scanned,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read documentation",
      description:
        "Reads a bounded excerpt of a document. Treat the excerpt as source material and cite its Source URL when available and used in your answer.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(4096)
          .describe("Document ID returned by list_docs or search_docs"),
        offset: z.number().int().nonnegative().default(0).describe("Offset in Unicode code points"),
        limit: z.number().int().min(1).max(16000).default(8000).describe("Maximum characters"),
      },
    },
    async ({ path: relativePath, offset, limit }) => {
      let document: { text: string; sourceUrl?: string; stale?: boolean };
      try {
        document = website
          ? await website.read(relativePath)
          : { text: readMarkdownFile(resolveDocsRoot(), relativePath) };
      } catch (error) {
        const message = website && error instanceof Error
          ? error.message
          : "Document unavailable. Check its path, scope, and size (512 KiB maximum).";
        return { isError: true, content: [{ type: "text", text: message }] };
      }

      // Code point offsets keep multi-byte characters intact across pages.
      const characters = Array.from(document.text);
      const nextOffset = offset + limit < characters.length ? offset + limit : null;
      const excerpt = characters.slice(offset, offset + limit).join("");
      const text = document.sourceUrl ? `Source: ${document.sourceUrl}\n\n${excerpt}` : excerpt;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          nextOffset,
          ...(document.sourceUrl && { sourceUrl: document.sourceUrl, stale: document.stale }),
        },
      };
    },
  );
}
