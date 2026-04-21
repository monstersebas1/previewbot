const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function assertSafeUrl(url: string): void {
  const parsed = new URL(url);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsafe protocol: ${parsed.protocol}`);
  }
}
