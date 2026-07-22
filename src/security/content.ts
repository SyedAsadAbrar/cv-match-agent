import path from "node:path";

export const MAX_CV_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CV_EXTENSIONS = new Set([".pdf", ".txt", ".md"]);

export function validateCvUpload(filename: string, bytes: number): void {
  const extension = path.extname(filename).toLowerCase();
  if (!ALLOWED_CV_EXTENSIONS.has(extension)) {
    throw new Error("CV files must be PDF, plain text, or Markdown.");
  }
  if (bytes <= 0) throw new Error("The uploaded CV is empty.");
  if (bytes > MAX_CV_FILE_BYTES)
    throw new Error("The uploaded CV exceeds the 5 MB limit.");
}

export function htmlToSafeText(html: string): string {
  const withoutExecutableContent = html
    .replace(
      /<(script|style|noscript|template|iframe|object)[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<!--([\s\S]*?)-->/g, " ");
  return decodeHtmlEntities(withoutExecutableContent.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(
        entity.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      return Number.isFinite(point) ? String.fromCodePoint(point) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
