import { resolve } from "node:path";

/**
 * Validate that a file path is within the expected base directory.
 * Prevents path traversal attacks.
 */
export function validateFilePath(filePath: string, baseDir: string): void {
  const resolved = resolve(filePath);
  const base = resolve(baseDir);
  if (!resolved.startsWith(base + "/") && resolved !== base) {
    throw new Error(`Path traversal blocked: ${filePath} is outside ${baseDir}`);
  }
}

/**
 * Sanitize a filename to remove path traversal sequences.
 * Strips directory separators, .., and null bytes.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\0/g, "") // null bytes
    .replace(/\.\./g, "") // parent traversal
    .replace(/[/\\]/g, "") // path separators
    .trim();
}
