export type ConfluenceAuth =
  | { kind: "pat"; token: string }
  | { kind: "basic"; username: string; password: string };

export interface ConfluenceConfig {
  baseUrl: string;
  auth: ConfluenceAuth;
}

export function loadConfluenceConfig(): ConfluenceConfig {
  const baseUrl = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/$/, "");
  const pat = process.env.CONFLUENCE_PAT?.trim() || "";
  const username = process.env.CONFLUENCE_USERNAME?.trim() || "";
  const password =
    process.env.CONFLUENCE_PASSWORD?.trim() ||
    process.env.CONFLUENCE_API_TOKEN?.trim() ||
    "";

  if (!baseUrl) {
    throw new Error(
      "Missing Confluence config. Set CONFLUENCE_BASE_URL (Server/Data Center base URL, without /wiki).",
    );
  }

  if (pat) {
    return { baseUrl, auth: { kind: "pat", token: pat } };
  }

  if (username && password) {
    return { baseUrl, auth: { kind: "basic", username, password } };
  }

  throw new Error(
    "Missing Confluence auth. Set CONFLUENCE_PAT (Personal Access Token) or CONFLUENCE_USERNAME + CONFLUENCE_PASSWORD.",
  );
}

function authHeader(auth: ConfluenceAuth): string {
  if (auth.kind === "pat") {
    return `Bearer ${auth.token}`;
  }
  const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function confluenceFetch(
  config: ConfluenceConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(config.auth),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  if (!response.ok) {
    throw new Error(
      `Confluence API ${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return body;
}
