export function sanitizeMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}
