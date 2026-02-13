import { spawn } from "node:child_process";
import { z } from "zod";
import type pino from "pino";

const splitProposalSchema = z.object({
  subcategories: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      linkUrls: z.array(z.string()),
    }),
  ).min(2).max(5),
  reasoning: z.string(),
});

export type SplitProposal = z.infer<typeof splitProposalSchema>;

const SPLIT_PROMPT = `You are organizing a knowledge library. A category has grown too large and needs to be split into 2-5 subcategories.

Given the category name and the titles+URLs of its links, propose a split.

Respond with ONLY valid JSON (no markdown fences):
{
  "subcategories": [
    {
      "name": "Subcategory Name",
      "description": "Brief description",
      "linkUrls": ["https://...", "https://..."]
    }
  ],
  "reasoning": "Brief explanation of the split logic"
}

Rules:
- Every link must appear in exactly one subcategory
- 2-5 subcategories
- Names should be specific but not too narrow
- Each subcategory should have at least 2 links`;

export async function proposeSplit(
  categoryName: string,
  links: Array<{ title: string; url: string }>,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<SplitProposal> {
  const input = `Category: ${categoryName}\n\nLinks:\n${links.map((l) => `- ${l.title}: ${l.url}`).join("\n")}`;

  logger.info({ categoryName, linkCount: links.length }, "Proposing category split");

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", SPLIT_PROMPT], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.on("error", (err) => {
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });

  // Parse with same 3-strategy approach
  const parsed = tryParse(output);
  return splitProposalSchema.parse(parsed);
}

function tryParse(output: string): unknown {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(output.trim());
  } catch { /* continue */ }

  // Strategy 2: Code fence
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* continue */ }
  }

  // Strategy 3: First brace block
  const braceMatch = output.match(/\{[\s\S]*\}/);
  if (braceMatch?.[0]) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch { /* continue */ }
  }

  throw new Error(`Failed to parse split proposal: ${output.slice(0, 200)}`);
}
