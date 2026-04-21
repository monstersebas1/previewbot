import { describe, it, expect } from "vitest";
import { sanitizeMarkdown } from "../src/sanitize-markdown.js";

describe("sanitizeMarkdown", () => {
  it("escapes pipe characters", () => {
    expect(sanitizeMarkdown("foo | bar | baz")).toBe("foo \\| bar \\| baz");
  });

  it("strips markdown link syntax, keeping the label", () => {
    expect(sanitizeMarkdown("see [WCAG 2.1](https://w3.org/TR/WCAG21)")).toBe("see WCAG 2.1");
  });

  it("strips multiple links in one string", () => {
    expect(sanitizeMarkdown("[a](http://x.com) and [b](http://y.com)")).toBe("a and b");
  });

  it("replaces newlines with a space", () => {
    expect(sanitizeMarkdown("line one\nline two")).toBe("line one line two");
  });

  it("replaces CRLF newlines with a space", () => {
    expect(sanitizeMarkdown("line one\r\nline two")).toBe("line one line two");
  });

  it("collapses multiple consecutive newlines into a single space", () => {
    expect(sanitizeMarkdown("a\n\n\nb")).toBe("a b");
  });

  it("handles a string with pipes, links, and newlines together", () => {
    const input = "Button [click here](https://example.com) is\nmissing | label";
    expect(sanitizeMarkdown(input)).toBe("Button click here is missing \\| label");
  });

  it("returns plain text unchanged", () => {
    expect(sanitizeMarkdown("Ensure all form elements have labels")).toBe(
      "Ensure all form elements have labels",
    );
  });

  it("handles an empty string", () => {
    expect(sanitizeMarkdown("")).toBe("");
  });
});
