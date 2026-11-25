import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import type { ErrorRequestHandler, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const host = "127.0.0.1";
const shutdownTimeoutMs = 5_000;
const requestIdHeader = "X-Request-ID";

interface HttpOptions {
  name: string;
  portVariable: string;
  defaultPort: number;
  createMcpServer: () => McpServer;
  source?: string;
}

function readPort(variable: string, fallback: number): number {
  const value = process.env[variable];
  if (value === undefined) return fallback;

  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`${variable} must be a decimal port between 1 and 65535`);
  }
  return port;
}

function sendError(res: Response, status: number, code: number, message: string): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

export function startMcpHttpServer(options: HttpOptions): void {
  const { name, createMcpServer } = options;
  const port = readPort(options.portVariable, options.defaultPort);
  const localOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  const app = createMcpExpressApp({ host });

  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin !== undefined && !localOrigins.has(origin)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Origin not allowed" },
      });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    let closeMcpServer: (() => Promise<void>) | undefined;
    let phase: "factory" | "connect" | "handle" = "factory";
    try {
      const server = createMcpServer();
      phase = "connect";
      // The SDK defaults to stateless mode when no sessionIdGenerator is provided.
      const transport = new StreamableHTTPServerTransport();
      let closed: Promise<void> | undefined;
      closeMcpServer = () => closed ??= server.close().catch(() => {
        console.error(JSON.stringify({
          event: "http.cleanup_error",
          server: name,
          requestId: res.getHeader(requestIdHeader),
        }));
      });
      res.once("close", closeMcpServer);
      await server.connect(transport);
      phase = "handle";
      if (!res.destroyed) {
        await transport.handleRequest(req, res, req.body);
      }
    } catch {
      console.error(JSON.stringify({
        event: "http.handler_error",
        server: name,
        requestId: res.getHeader(requestIdHeader),
        phase,
      }));
      sendError(res, 500, -32603, "Internal server error");
    } finally {
      if (closeMcpServer) {
        res.off("close", closeMcpServer);
        await closeMcpServer();
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    sendError(res, 405, -32000, "Method not allowed. Use POST for stateless mode.");
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error?.type === "request.aborted") return;
    switch (error?.status) {
      case 400:
        return sendError(res, 400, -32700, "Invalid JSON request body");
      case 413:
        return sendError(res, 413, -32600, "Request body too large");
      case 415:
        return sendError(res, 415, -32600, "Unsupported request encoding");
      default:
        return sendError(res, 500, -32603, "Internal server error");
    }
  };
  app.use(handleError);

  const httpServer = createServer((req, res) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.setHeader(requestIdHeader, requestId);
    res.once("close", () => {
      console.error(JSON.stringify({
        event: "http.request",
        server: name,
        requestId,
        method: req.method,
        status: res.headersSent ? res.statusCode : null,
        durationMs: Math.round(performance.now() - startedAt),
        aborted: !res.writableFinished,
      }));
    });
    app(req, res);
  });

  let shutdownTimer: NodeJS.Timeout | undefined;
  const shutdown = () => {
    if (shutdownTimer) return;
    shutdownTimer = setTimeout(() => httpServer.closeAllConnections(), shutdownTimeoutMs);
    shutdownTimer.unref();
    httpServer.close();
  };
  const removeSignalHandlers = () => {
    clearTimeout(shutdownTimer);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  httpServer.once("close", removeSignalHandlers);
  httpServer.once("error", (error: NodeJS.ErrnoException) => {
    removeSignalHandlers();
    console.error(`${name} HTTP listener failed (${error.code ?? "unknown error"})`);
    process.exitCode = 1;
  });
  httpServer.listen(port, host, () => {
    const source = options.source ? ` (source: ${options.source})` : "";
    console.error(`${name} Streamable HTTP on http://${host}:${port}/mcp${source}`);
  });
}
