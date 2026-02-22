export interface TextChunk {
  text: string;
  index: number;
  startChar: number;
}

export function chunkText(
  text: string,
  opts?: { chunkSize?: number; overlap?: number },
): TextChunk[] {
  const chunkSize = opts?.chunkSize ?? 500;
  const overlap = opts?.overlap ?? 50;
  const minChunkSize = 100;

  if (!text || text.length <= chunkSize) {
    return [{ text, index: 0, startChar: 0 }];
  }

  // Split on sentence boundaries
  const sentences = splitSentences(text);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let currentStart = 0;
  let charOffset = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      // Flush current chunk
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startChar: currentStart,
      });

      // Start new chunk with overlap from end of previous
      const overlapText = currentChunk.slice(-overlap);
      const overlapStart = charOffset - overlapText.length;
      currentChunk = overlapText + sentence;
      currentStart = overlapStart;
    } else {
      if (currentChunk.length === 0) {
        currentStart = charOffset;
      }
      currentChunk += sentence;
    }
    charOffset += sentence.length;
  }

  // Flush remaining
  if (currentChunk.trim().length >= minChunkSize) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunks.length,
      startChar: currentStart,
    });
  } else if (chunks.length > 0 && currentChunk.trim().length > 0) {
    // Append small trailing text to last chunk
    const last = chunks[chunks.length - 1]!;
    last.text = last.text + " " + currentChunk.trim();
  }

  return chunks;
}

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  // Split on paragraph breaks first, then sentence boundaries
  const paragraphs = text.split(/(\n\n+)/);

  for (const para of paragraphs) {
    if (/^\n+$/.test(para)) {
      parts.push(para);
      continue;
    }
    // Split on sentence-ending punctuation followed by space or newline
    const sentences = para.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      if (s.length > 0) {
        parts.push(s + " ");
      }
    }
  }

  return parts;
}
