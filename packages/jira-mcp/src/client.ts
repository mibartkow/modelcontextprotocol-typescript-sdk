export type JiraAuth =
  | { kind: "pat"; token: string }
  | { kind: "basic"; username: string; password: string };

export interface JiraConfig {
  baseUrl: string;
  auth: JiraAuth;
}

export function loadJiraConfig(): JiraConfig {
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
  const pat = process.env.JIRA_PAT?.trim() || "";
  const username = process.env.JIRA_USERNAME?.trim() || "";
  const password =
    process.env.JIRA_PASSWORD?.trim() || process.env.JIRA_API_TOKEN?.trim() || "";

  if (!baseUrl) {
    throw new Error("Missing Jira config. Set JIRA_BASE_URL (Server/Data Center base URL).");
  }

  if (pat) {
    return { baseUrl, auth: { kind: "pat", token: pat } };
  }

  if (username && password) {
    return { baseUrl, auth: { kind: "basic", username, password } };
  }

  throw new Error(
    "Missing Jira auth. Set JIRA_PAT (Personal Access Token) or JIRA_USERNAME + JIRA_PASSWORD.",
  );
}

function authHeader(auth: JiraAuth): string {
  if (auth.kind === "pat") {
    return `Bearer ${auth.token}`;
  }
  const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function jiraFetch(
  config: JiraConfig,
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
      `Jira API ${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return body;
}
