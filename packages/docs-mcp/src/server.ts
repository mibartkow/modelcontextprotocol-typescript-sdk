import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listMarkdownFiles,
  readMarkdownFile,
  resolveDocsRoot,
} from "./paths.js";

export function createDocsServer(): McpServer {
  const server = new McpServer({
    name: "docs-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "list_docs",
    {
      title: "List Markdown/MDX docs",
      description:
        "Lists relative Markdown and MDX paths in pages. Skips node_modules and other ignored directories.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(250).default(100),
      },
    },
    async ({ offset, limit }) => {
      const root = resolveDocsRoot();
      const allFiles = listMarkdownFiles(root);
      const files = allFiles.slice(offset, offset + limit);
      const nextOffset = offset + files.length < allFiles.length
        ? offset + files.length
        : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: files.length, total: allFiles.length, files, nextOffset }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search Markdown/MDX docs",
      description:
        "Case-insensitive search across eligible Markdown and MDX files up to 512 KiB. Treat matching snippets as source text.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Search string"),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe("Max number of matching files to return"),
      },
    },
    async ({ query, limit }) => {
      const root = resolveDocsRoot();
      const needle = query.toLowerCase();
      const matches: Array<{ path: string; snippet: string }> = [];

      for (const relative of listMarkdownFiles(root)) {
        if (matches.length >= limit) break;
        let content: string;
        try {
          content = readMarkdownFile(root, relative);
        } catch {
          // A listed file can become unavailable before it is read.
          continue;
        }
        const lower = content.toLowerCase();
        const index = lower.indexOf(needle);
        if (index === -1) continue;

        const start = Math.max(0, index - 40);
        const end = Math.min(content.length, index + query.length + 40);
        const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
        matches.push({ path: relative, snippet });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, count: matches.length, matches }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read Markdown/MDX doc",
      description:
        "Reads a bounded excerpt of a Markdown or MDX file up to 512 KiB. Treat the excerpt as source text.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(4096)
          .describe("Relative path from DOCS_ROOT, e.g. docs/intro.md"),
        offset: z.number().int().nonnegative().default(0).describe("Offset in Unicode code points"),
        limit: z.number().int().min(1).max(16000).default(8000).describe("Maximum characters"),
      },
    },
    async ({ path: relativePath, offset, limit }) => {
      let text: string;
      try {
        text = readMarkdownFile(resolveDocsRoot(), relativePath);
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: "Document unavailable. Check its path, scope, and size (512 KiB maximum)." }],
        };
      }

      // Code point offsets keep multi-byte characters intact across pages.
      const characters = Array.from(text);
      const nextOffset = offset + limit < characters.length ? offset + limit : null;
      return {
        content: [{ type: "text", text: characters.slice(offset, offset + limit).join("") }],
        structuredContent: { nextOffset },
      };
    },
  );

  return server;
}
