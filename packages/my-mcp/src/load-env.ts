import { loadEnvFile } from "node:process";

const envFile = new URL("../../../.env", import.meta.url);

export function loadCheckoutEnv(): void {
  try {
    loadEnvFile(envFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
