import fs from "node:fs";
import path from "node:path";

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
    : path.resolve(process.cwd(), "fixtures", "docs");

  if (!fs.existsSync(root)) {
    throw new Error(`DOCS_ROOT does not exist: ${root}`);
  }

  const stats = fs.statSync(root);
  if (!stats.isDirectory()) {
    throw new Error(`DOCS_ROOT is not a directory: ${root}`);
  }

  return root;
}

export function assertInsideRoot(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("\0") || path.isAbsolute(normalized)) {
    throw new Error(`Invalid path: ${relativePath}`);
  }

  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes DOCS_ROOT: ${relativePath}`);
  }

  return absolute;
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
