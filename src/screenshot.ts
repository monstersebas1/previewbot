import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";
import type { ViewportScreenshot } from "./audit-types.js";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

interface CaptureOptions {
  previewUrl: string;
  productionUrl?: string;
  prNumber: number;
  outputDir?: string;
}

export async function captureScreenshots({
  previewUrl,
  productionUrl,
  prNumber,
  outputDir,
}: CaptureOptions): Promise<ViewportScreenshot[]> {
  const baseDir = outputDir ?? `/var/previewbot/reports/pr-${prNumber}/screenshots`;
  await mkdir(baseDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  try {
    const results: ViewportScreenshot[] = [];

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height });

      const previewPath = join(baseDir, `preview-${vp.name}.jpg`);
      await page.goto(previewUrl, { waitUntil: "networkidle2", timeout: 30_000 });
      await page.screenshot({ path: previewPath, type: "jpeg", quality: 80, fullPage: true });

      const screenshot: ViewportScreenshot = {
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        previewPath,
      };

      if (productionUrl) {
        const prodPath = join(baseDir, `production-${vp.name}.jpg`);
        await page.goto(productionUrl, { waitUntil: "networkidle2", timeout: 30_000 });
        await page.screenshot({ path: prodPath, type: "jpeg", quality: 80, fullPage: true });
        screenshot.productionPath = prodPath;
      }

      await page.close();
      results.push(screenshot);
    }

    return results;
  } finally {
    await browser.close();
  }
}

export { VIEWPORTS };
