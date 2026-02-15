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
  content_type: z.enum([
    "tool", "tutorial", "pattern", "analysis", "reference", "commentary",
    "research-paper", "book", "whitepaper", "report",
  ]).default("reference"),
  purpose: z.string().default(""),
  integration_type: z.enum(["cli", "library", "api", "skill", "saas", "pattern", "guide", "reference"]).default("reference"),
  // Document-specific fields (optional — only returned for file-based content)
  key_concepts: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
  key_takeaways: z.array(z.string()).default([]),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "academic"]).default("intermediate"),
});

export type CategorizationResult = z.infer<typeof categorizationSchema>;

const URL_PROMPT = `You are a knowledge categorizer for a personal knowledge graph. The user collects resources across many domains: AI, stock market, advanced forecasting, crypto, CBDC, psychology, ecommerce, developer tools, business strategy, mathematics, and more.

Given a scraped web page, extract structured metadata.

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "category": "One broad category (e.g., 'AI Research', 'Quantitative Finance', 'Developer Tools', 'Crypto & DeFi', 'CBDC & Digital Currency', 'Psychology', 'Ecommerce', 'Business Strategy', 'Mathematics', 'Prompt Engineering', 'Infrastructure')",
  "tags": ["lowercase-hyphenated-tags", "up-to-10-tags"],
  "tools": [{"name": "ToolName", "url": "https://..."}],
  "technologies": ["React", "Python", "Neo4j"],
  "summary": "One sentence summary of what this resource is about.",
  "quality": "high|medium|low",
  "forge_score": 0.0-1.0,
  "content_type": "tool|tutorial|pattern|analysis|reference|commentary",
  "purpose": "What problem does this solve or what insight does it provide?",
  "integration_type": "cli|library|api|skill|saas|pattern|guide|reference"
}

Rules:
- category should be a broad, reusable grouping (not too specific)
- tags: up to 10, lowercase, hyphenated, descriptive keywords covering key topics
- tools are specific software tools/libraries mentioned (with homepage URL if obvious)
- technologies are programming languages, frameworks, or platforms mentioned
- quality: high = original research/tool/tutorial, medium = blog post/discussion, low = aggregator/list

forge_score — how valuable this resource is for building knowledge or taking action:
  0.85-1.0 = The artifact itself — a repo, package, docs, or tool you can install/clone/use directly
  0.65-0.84 = Rich guide or tutorial with transferable code, patterns, or strategies
  0.45-0.64 = Substantive analysis, comparison, or framework with enough detail to act on
  0.25-0.44 = Thin pointer — a tweet, comment, or aggregator linking to something useful elsewhere
  0.05-0.24 = Pure commentary, opinion, or engagement with no direct actionable value
  0.0 = Completely off-topic

content_type:
  tool = installable software, CLI, library, or package (the repo/homepage itself)
  tutorial = step-by-step guide with code examples
  pattern = reusable architectural or workflow pattern
  analysis = comparison, benchmark, or deep-dive evaluation
  reference = documentation, spec, API reference, or curated list
  commentary = opinion, tweet thread, social media post, or discussion

integration_type — how you would use this resource:
  cli = command-line tool | library = importable package | api = hosted API
  skill = prompt pattern | saas = hosted service | pattern = architectural pattern to adapt
  guide = instructions to follow | reference = information to consult`;

const DOCUMENT_PROMPT = `You are a knowledge analyst for a personal knowledge graph. The user collects research papers, books, whitepapers, and documents across many domains: AI, stock market, advanced forecasting, crypto, CBDC, psychology, ecommerce, developer tools, business strategy, mathematics, and more.

Given a document's extracted text, analyze it deeply and extract structured metadata.

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "category": "One broad knowledge domain (e.g., 'Quantitative Finance', 'AI Research', 'Crypto & DeFi', 'CBDC & Digital Currency', 'Psychology', 'Business Strategy', 'Mathematics', 'Machine Learning', 'Ecommerce', 'Market Microstructure', 'Behavioral Economics', 'Topology & Geometry')",
  "tags": ["lowercase-hyphenated-tags", "up-to-10-tags-covering-all-key-topics"],
  "tools": [{"name": "ToolName", "url": "https://..."}],
  "technologies": ["Python", "TensorFlow", "R"],
  "summary": "2-3 sentence summary: what this document argues or presents, its methodology, and its key finding.",
  "quality": "high|medium|low",
  "forge_score": 0.0-1.0,
  "content_type": "research-paper|book|whitepaper|report|tutorial|analysis|reference",
  "purpose": "What question does this document answer or what problem does it address?",
  "integration_type": "reference|guide|pattern",
  "key_concepts": ["specific theories", "frameworks", "methodologies", "named algorithms"],
  "authors": ["Author Name", "Second Author"],
  "key_takeaways": ["First major insight or finding", "Second major insight", "Third if applicable"],
  "difficulty": "beginner|intermediate|advanced|academic"
}

Rules:
- category: broad knowledge domain, reusable across many documents
- tags: up to 10, lowercase-hyphenated. Cover the document's major topics, methods, and application areas
- key_concepts: specific named theories, algorithms, frameworks, or methodologies (e.g., "khovanov-cohomology", "black-scholes", "transformer-architecture", "prospect-theory"). These are MORE specific than tags.
- authors: extract author names from the text if visible (title page, header, references section)
- key_takeaways: 2-4 bullet-point insights a reader should remember. Be specific, not generic.
- difficulty: beginner (general audience), intermediate (practitioner), advanced (deep domain expertise), academic (requires specialized education)
- summary: 2-3 sentences. State what the document IS (paper/book/report), what it's about, its approach, and its key finding or thesis.
- quality: high for peer-reviewed research, original frameworks, or comprehensive analysis. medium for summaries or derivative work. low for surface-level content.

forge_score for documents — how rich and actionable the knowledge is:
  0.85-1.0 = Foundational work — introduces a novel framework, algorithm, or theory with detailed methodology
  0.65-0.84 = Strong applied work — empirical results, practical frameworks, or comprehensive guides
  0.45-0.64 = Solid analysis — literature review, comparison study, or detailed exploration of existing ideas
  0.25-0.44 = Lightweight — executive summary, overview, or introduction to a topic
  0.05-0.24 = Minimal substance — opinion piece or thin content
  The user specifically saved this document, so err toward higher scores.

content_type for documents:
  research-paper = academic/peer-reviewed paper with methodology and results
  book = full book or significant book excerpt
  whitepaper = industry whitepaper or technical report
  report = data report, market analysis, or institutional publication
  tutorial = educational guide with examples
  analysis = deep-dive evaluation or comparison
  reference = documentation or reference material`;

export async function categorizeWithClaude(
  title: string,
  description: string,
  content: string,
  url: string,
  timeoutMs: number,
  logger: pino.Logger,
  isDocument = false,
  userInterests: string[] = [],
): Promise<CategorizationResult> {
  const isFile = isDocument || url.startsWith("file:///");
  let prompt = isFile ? DOCUMENT_PROMPT : URL_PROMPT;

  // Inject user interests into the prompt if available
  if (userInterests.length > 0) {
    const interestsStr = userInterests.join(", ");
    prompt += `\n\nIMPORTANT CONTEXT — The person who shared this is specifically interested in: ${interestsStr}. Pay special attention to aspects of the content that relate to these interests. Tag and categorize accordingly. Extract key concepts relevant to their focus areas.`;
  }

  // Documents get 12k chars to Claude (vs 4k for URLs) — denser content needs more context
  const maxContent = isFile ? 12000 : 4000;
  const truncatedContent = content.slice(0, maxContent);

  const label = isFile ? "Document" : "URL";
  const input = `${label}: ${url}\nTitle: ${title}\nDescription: ${description}\n\nContent:\n${truncatedContent}`;

  logger.debug({ url, contentLength: truncatedContent.length, isFile, hasInterests: userInterests.length > 0 }, "Sending to Claude CLI");

  const output = await spawnClaude(input, prompt, timeoutMs, logger);
  return parseClaudeOutput(output, logger);
}

function spawnClaude(
  input: string,
  prompt: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to allow running inside a Claude Code session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", ["-p", prompt], {
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
