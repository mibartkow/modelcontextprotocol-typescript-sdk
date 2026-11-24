import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./load-env.js";
import { createDocsServer } from "./server.js";

async function main(): Promise<void> {
  loadEnvFile();
  const server = createDocsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const source = process.env.DOCS_SITEMAP_URL?.trim() ? "website" : "local Markdown";
  console.error(`docs-mcp listening on stdio (source: ${source})`);
}

main().catch((error: unknown) => {
  console.error("docs-mcp failed to start:", error);
  process.exit(1);
});
