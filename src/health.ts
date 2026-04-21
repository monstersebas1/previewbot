import { config, previewPort } from "./config.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHealthy(prNumber: number): Promise<"healthy" | "unhealthy"> {
  const port = previewPort(prNumber);
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + config.healthCheckTimeout * 1000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const body = await response.text();
        if (body.length > 0) {
          return "healthy";
        }
      }
    } catch {
      // Container not ready yet
    }

    await sleep(3000);
  }

  return "unhealthy";
}
