import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DOC_BYTES = 512 * 1024;

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".docusaurus",
  ".idea",
  "temp",
  ".fallow",
  "dist",
  "build",
]);

function resolveIgnoreDirs(): Set<string> {
  const extra = (process.env.DOCS_IGNORE_DIRS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_IGNORE_DIRS, ...extra]);
}

export function isDocFile(fileName: string): boolean {
  return /\.mdx?$/i.test(fileName);
}

export function resolveDocsRoot(): string {
  const configured = process.env.DOCS_ROOT?.trim();
  const root = configured
    ? path.resolve(configured)
    : fileURLToPath(new URL("../../../fixtures/docs", import.meta.url));

  if (!fs.existsSync(root)) {
    throw new Error("Configured documentation directory does not exist.");
  }

  const stats = fs.statSync(root);
  if (!stats.isDirectory()) {
    throw new Error("Configured documentation location is not a directory.");
  }

  return fs.realpathSync(root);
}

function assertAllowedPath(root: string, target: string): void {
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep);
  const ignored = resolveIgnoreDirs();
  if (
    !relative ||
    segments[0] === ".." ||
    path.isAbsolute(relative) ||
    !isDocFile(target) ||
    segments.slice(0, -1).some((segment) => ignored.has(segment))
  ) {
    throw new Error("Path is outside the documentation scope.");
  }
}

export function readMarkdownFile(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("\0") || path.isAbsolute(normalized)) {
    throw new Error("Expected a relative documentation path.");
  }

  const absolute = path.resolve(root, normalized);
  assertAllowedPath(root, absolute);
  const realPath = fs.realpathSync(absolute);
  assertAllowedPath(root, realPath);

  // Nonblocking open avoids waiting on special files before the descriptor check.
  const fd = fs.openSync(realPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.size > MAX_DOC_BYTES) {
      throw new Error("Expected a regular Markdown file up to 512 KiB.");
    }

    const buffer = Buffer.alloc(stats.size);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return buffer.toString("utf8", 0, length);
  } finally {
    fs.closeSync(fd);
  }
}

export function listMarkdownFiles(root: string): string[] {
  const results: string[] = [];
  const ignoreDirs = resolveIgnoreDirs();

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && isDocFile(entry.name)) {
        results.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/"));
      }
    }
  }

  walk(root);
  return results.sort((a, b) => a.localeCompare(b));
}
