import { EPub } from "epub2";
import { JSDOM } from "jsdom";
import type pino from "pino";

/**
 * Extract text content from an EPUB file.
 * Parses all chapters and strips HTML tags, returning concatenated plain text.
 */
export async function extractEpubText(
  filePath: string,
  logger: pino.Logger,
): Promise<{ title: string; text: string }> {
  const epub = await EPub.createAsync(filePath);

  const title = epub.metadata?.title || "Untitled EPUB";
  const chapters: string[] = [];

  for (const chapter of epub.flow) {
    if (!chapter.id) continue;
    try {
      const html = await epub.getChapterAsync(chapter.id);
      if (!html) continue;
      const dom = new JSDOM(html);
      const text = dom.window.document.body?.textContent?.trim();
      if (text && text.length > 0) {
        chapters.push(text);
      }
    } catch (err) {
      logger.debug(
        { chapterId: chapter.id, err: err instanceof Error ? err.message : err },
        "Skipping unreadable EPUB chapter",
      );
    }
  }

  return { title, text: chapters.join("\n\n") };
}
