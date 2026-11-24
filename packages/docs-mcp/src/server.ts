import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertInsideRoot,
  isDocFile,
  listMarkdownFiles,
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
        "Lists all Markdown and MDX files under DOCS_ROOT (relative paths). Skips node_modules and other ignored dirs.",
      inputSchema: {},
    },
    async () => {
      const root = resolveDocsRoot();
      const files = listMarkdownFiles(root);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ root, count: files.length, files }, null, 2),
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
        "Case-insensitive search across Markdown/MDX contents under DOCS_ROOT (e.g. DigiDEV Docusaurus).",
      inputSchema: {
        query: z.string().min(1).describe("Search string"),
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
        const absolute = assertInsideRoot(root, relative);
        const content = fs.readFileSync(absolute, "utf8");
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
            text: JSON.stringify({ query, count: matches.length, matches }, null, 2),
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
        "Reads one Markdown or MDX file by relative path under DOCS_ROOT.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative path from DOCS_ROOT, e.g. docs/intro.md"),
      },
    },
    async ({ path: relativePath }) => {
      const root = resolveDocsRoot();
      const absolute = assertInsideRoot(root, relativePath);

      if (!fs.existsSync(absolute)) {
        return {
          isError: true,
          content: [{ type: "text", text: `File not found: ${relativePath}` }],
        };
      }

      if (!isDocFile(absolute)) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Not a Markdown/MDX file: ${relativePath}` },
          ],
        };
      }

      const content = fs.readFileSync(absolute, "utf8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    },
  );

  return server;
}
