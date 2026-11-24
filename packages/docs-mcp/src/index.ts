import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./load-env.js";
import { createDocsServer } from "./server.js";

async function main(): Promise<void> {
  loadEnvFile();
  const server = createDocsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("docs-mcp listening on stdio");
}

main().catch((error: unknown) => {
  console.error("docs-mcp failed to start:", error);
  process.exit(1);
});
