import { spawn } from "node:child_process";
import { z } from "zod";
import type pino from "pino";

const categorizationSchema = z.object({
  category: z.string().min(1),
  tags: z.array(z.string()),
  tools: z.array(
    z.object({
      name: z.string(),
      url: z.string().optional(),
    }),
  ).default([]),
  technologies: z.array(z.string()).default([]),
  summary: z.string(),
  quality: z.enum(["high", "medium", "low"]).default("medium"),
  forge_score: z.number().min(0).max(1).default(0.5),
  content_type: z.enum(["tool", "tutorial", "pattern", "analysis", "reference", "commentary"]).default("reference"),
  purpose: z.string().default(""),
  integration_type: z.enum(["cli", "library", "api", "skill", "saas", "pattern", "guide", "reference"]).default("reference"),
});

export type CategorizationResult = z.infer<typeof categorizationSchema>;

const CATEGORIZATION_PROMPT = `You are a knowledge categorizer for a personal AI/dev tooling link library. Given a scraped web page, extract structured metadata.

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "category": "One broad category name (e.g., 'LLM Frameworks', 'Developer Tools', 'AI Research', 'Infrastructure', 'Tutorials', 'Datasets', 'Prompt Engineering')",
  "tags": ["lowercase-hyphenated-tags", "max-5-tags"],
  "tools": [{"name": "ToolName", "url": "https://..."}],
  "technologies": ["React", "Python", "Neo4j"],
  "summary": "One sentence summary of what this resource is about.",
  "quality": "high|medium|low",
  "forge_score": 0.0-1.0,
  "content_type": "tool|tutorial|pattern|analysis|reference|commentary",
  "purpose": "What problem does this solve?",
  "integration_type": "cli|library|api|skill|saas|pattern|guide|reference"
}

Rules:
- category should be a broad, reusable grouping (not too specific)
- tags are lowercase, hyphenated, descriptive keywords
- tools are specific software tools/libraries mentioned (with homepage URL if obvious)
- technologies are programming languages, frameworks, or platforms mentioned
- quality: high = original research/tool/tutorial, medium = blog post/discussion, low = aggregator/list

forge_score — probability that reading this leads to a concrete building action (install, adopt, configure):
  0.85-1.0 = The artifact itself — a repo, package, or tool you can install/clone/use directly
  0.65-0.84 = Rich guide or tutorial with transferable code or patterns
  0.45-0.64 = Substantive analysis, comparison, or workflow pattern description
  0.25-0.44 = Thin pointer — a tweet or comment linking to something useful elsewhere
  0.05-0.24 = Pure commentary, opinion, or engagement with no direct build value

content_type — what kind of resource this is:
  tool = installable software, CLI, library, or package
  tutorial = step-by-step guide with code examples
  pattern = reusable architectural or workflow pattern
  analysis = comparison, benchmark, or deep-dive evaluation
  reference = documentation, spec, or API reference
  commentary = opinion, tweet thread, or discussion

purpose — one sentence describing what problem this resource solves (e.g., "reduce LLM API costs via model routing")

integration_type — how you would use this resource:
  cli = command-line tool to install and run
  library = importable package/module
  api = hosted API endpoint
  skill = Claude Code skill or prompt pattern
  saas = hosted service with web UI
  pattern = architectural pattern to adapt
  guide = instructions to follow
  reference = information to consult`;

export async function categorizeWithClaude(
  title: string,
  description: string,
  content: string,
  url: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<CategorizationResult> {
  const truncatedContent = content.slice(0, 4000);
  const input = `URL: ${url}\nTitle: ${title}\nDescription: ${description}\n\nContent:\n${truncatedContent}`;

  logger.debug({ url, contentLength: truncatedContent.length }, "Sending to Claude CLI");

  const output = await spawnClaude(input, timeoutMs, logger);
  return parseClaudeOutput(output, logger);
}

function spawnClaude(
  input: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to allow running inside a Claude Code session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", ["-p", CATEGORIZATION_PROMPT], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr: stderr.slice(0, 500) }, "Claude CLI exited with error");
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
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
}

export function parseClaudeOutput(
  output: string,
  logger: pino.Logger,
): CategorizationResult {
  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(output.trim());
    return categorizationSchema.parse(parsed);
  } catch {
    logger.debug("Strategy 1 (direct parse) failed");
  }

  // Strategy 2: Extract JSON from markdown code fence
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      return categorizationSchema.parse(parsed);
    } catch {
      logger.debug("Strategy 2 (code fence) failed");
    }
  }

  // Strategy 3: Find first { ... } block
  const braceMatch = output.match(/\{[\s\S]*\}/);
  if (braceMatch?.[0]) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      return categorizationSchema.parse(parsed);
    } catch {
      logger.debug("Strategy 3 (brace extraction) failed");
    }
  }

  throw new Error(`Failed to parse Claude output (${output.length} chars): ${output.slice(0, 200)}`);
}
