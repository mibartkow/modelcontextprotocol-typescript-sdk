import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./load-env.js";
import { createConfluenceServer } from "./server.js";

async function main(): Promise<void> {
  loadEnvFile();
  const server = createConfluenceServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("confluence-mcp listening on stdio");
}

main().catch((error: unknown) => {
  console.error("confluence-mcp failed to start:", error);
  process.exit(1);
});
