import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  InteractionType,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type pino from "pino";
import type { Driver } from "neo4j-driver";
import type { EmbeddingService } from "../embeddings/index.js";
import type { QueueClient } from "../queue/index.js";
import { enqueue } from "../queue/index.js";
import { extractUrls } from "./url-extractor.js";
import { addReaction, REACTIONS } from "./reactions.js";
import {
  generateScoreDistributionChart,
  generateContentTypeChart,
} from "../dashboard/charts.js";
import { askQuestion } from "../rag/query.js";

export interface BotConfig {
  token: string;
  channelId: string;
  guildId: string;
}

export interface SlashCommandDeps {
  neo4jDriver: Driver;
  embeddings: EmbeddingService;
  dashboardPort: number;
  dashboardUrl?: string; // Public URL (ngrok) — falls back to localhost
}

export function createBot(
  config: BotConfig,
  queueClient: QueueClient,
  logger: pino.Logger,
  slashDeps?: SlashCommandDeps,
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on("ready", async () => {
    logger.info(`Bot logged in as ${client.user?.tag ?? "unknown"}`);

    // Register slash commands
    if (slashDeps) {
      try {
        const commands = [
          new SlashCommandBuilder()
            .setName("forge")
            .setDescription("Link Forge commands")
            .addSubcommand((sub) =>
              sub.setName("stats").setDescription("Show forge score distribution and content type charts"),
            )
            .addSubcommand((sub) =>
              sub.setName("top").setDescription("Show top links by forge score")
                .addIntegerOption((opt) =>
                  opt.setName("count").setDescription("Number of links to show").setMinValue(1).setMaxValue(25),
                ),
            )
            .addSubcommand((sub) =>
              sub.setName("graph").setDescription("Get link to the interactive knowledge graph dashboard"),
            )
            .addSubcommand((sub) =>
              sub.setName("ask").setDescription("Ask a question about the community's collective knowledge")
                .addStringOption((opt) =>
                  opt.setName("question").setDescription("Your question").setRequired(true),
                ),
            ),
        ];

        const rest = new REST({ version: "10" }).setToken(config.token);
        await rest.put(
          Routes.applicationGuildCommands(client.user!.id, config.guildId),
          { body: commands.map((c) => c.toJSON()) },
        );
        logger.info("Slash commands registered");
      } catch (err) {
        logger.error({ err }, "Failed to register slash commands");
      }
    }
  });

  // Slash command handler
  client.on("interactionCreate", async (interaction) => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    if (!slashDeps) return;

    const cmd = interaction as ChatInputCommandInteraction;
    if (cmd.commandName !== "forge") return;

    const sub = cmd.options.getSubcommand();
    const session = slashDeps.neo4jDriver.session();

    try {
      await cmd.deferReply();

      if (sub === "stats") {
        const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

        const countRes = await session.run("MATCH (l:Link) RETURN count(l) AS links");
        const scoreRes = await session.run(`
          MATCH (l:Link) WHERE l.forgeScore IS NOT NULL
          RETURN
            count(l) AS total,
            avg(l.forgeScore) AS avg,
            sum(CASE WHEN l.forgeScore >= 0.85 THEN 1 ELSE 0 END) AS artifact,
            sum(CASE WHEN l.forgeScore >= 0.65 AND l.forgeScore < 0.85 THEN 1 ELSE 0 END) AS guide,
            sum(CASE WHEN l.forgeScore >= 0.45 AND l.forgeScore < 0.65 THEN 1 ELSE 0 END) AS analysis,
            sum(CASE WHEN l.forgeScore >= 0.25 AND l.forgeScore < 0.45 THEN 1 ELSE 0 END) AS pointer,
            sum(CASE WHEN l.forgeScore >= 0.10 AND l.forgeScore < 0.25 THEN 1 ELSE 0 END) AS commentary,
            sum(CASE WHEN l.forgeScore < 0.10 THEN 1 ELSE 0 END) AS junk
        `);
        const typeRes = await session.run(`
          MATCH (l:Link) WHERE l.contentType IS NOT NULL
          RETURN l.contentType AS type, count(l) AS count ORDER BY count DESC
        `);

        const sr = scoreRes.records[0]!;
        const dist = {
          artifact: toNum(sr.get("artifact")),
          guide: toNum(sr.get("guide")),
          analysis: toNum(sr.get("analysis")),
          pointer: toNum(sr.get("pointer")),
          commentary: toNum(sr.get("commentary")),
          junk: toNum(sr.get("junk")),
        };
        const types = typeRes.records.map((r) => ({
          type: r.get("type") as string,
          count: toNum(r.get("count")),
        }));

        const [scorePng, typePng] = await Promise.all([
          generateScoreDistributionChart(dist),
          generateContentTypeChart(types),
        ]);

        const linkCount = toNum(countRes.records[0]?.get("links"));
        const avg = (Math.round(toNum(sr.get("avg")) * 100) / 100).toFixed(2);

        const embed = new EmbedBuilder()
          .setTitle("Link Forge Stats")
          .setDescription(`**${linkCount}** links indexed | avg forge score: **${avg}**`)
          .setColor(0x5865f2)
          .setImage("attachment://scores.png");

        await cmd.editReply({
          embeds: [embed],
          files: [
            new AttachmentBuilder(scorePng, { name: "scores.png" }),
            new AttachmentBuilder(typePng, { name: "types.png" }),
          ],
        });
      } else if (sub === "top") {
        const count = cmd.options.getInteger("count") ?? 10;
        const topRes = await session.run(`
          MATCH (l:Link)
          WHERE l.forgeScore IS NOT NULL
          RETURN l.title AS title, l.url AS url, l.forgeScore AS score,
                 COALESCE(l.contentType, 'reference') AS type
          ORDER BY l.forgeScore DESC
          LIMIT $count
        `, { count });

        const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
        const typeEmoji: Record<string, string> = {
          tool: "\u{1f527}", tutorial: "\u{1f4d6}", pattern: "\u{1f9e9}",
          analysis: "\u{1f50d}", reference: "\u{1f4cb}", commentary: "\u{1f4ac}",
        };

        const lines = topRes.records.map((r) => {
          const score = toNum(r.get("score")).toFixed(2);
          const type = r.get("type") as string;
          const title = (r.get("title") as string || r.get("url") as string).slice(0, 60);
          const emoji = typeEmoji[type] ?? "\u{1f517}";
          return `\`${score}\` ${emoji} [${title}](${r.get("url")})`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`Top ${count} Links by Forge Score`)
          .setDescription(lines.join("\n"))
          .setColor(0x5865f2);

        await cmd.editReply({ embeds: [embed] });
      } else if (sub === "graph") {
        const linkCountRes = await session.run("MATCH (l:Link) RETURN count(l) AS count");
        const edgeRes = await session.run("MATCH ()-[r:LINKS_TO]->() RETURN count(r) AS linksTo");
        const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
        const linkCount = toNum(linkCountRes.records[0]?.get("count"));
        const linksTo = toNum(edgeRes.records[0]?.get("linksTo"));

        const embed = new EmbedBuilder()
          .setTitle("Interactive Knowledge Graph")
          .setDescription(
            `View the full interactive dashboard:\n` +
            `**${slashDeps.dashboardUrl ?? `http://localhost:${slashDeps.dashboardPort}`}/dashboard**\n\n` +
            `${linkCount} nodes \u00b7 ${linksTo} LINKS_TO edges`,
          )
          .setColor(0x5865f2);

        await cmd.editReply({ embeds: [embed] });
      } else if (sub === "ask") {
        const question = cmd.options.getString("question", true);

        try {
          const result = await askQuestion(question, slashDeps.neo4jDriver, slashDeps.embeddings, logger);

          // Truncate answer for Discord (2048 char embed limit)
          const truncatedAnswer = result.answer.length > 1800
            ? result.answer.slice(0, 1800) + "\n\n*...truncated. View full answer on the dashboard.*"
            : result.answer;

          const sourcesText = result.sources.slice(0, 5).map(s =>
            `[\`${s.forgeScore.toFixed(2)}\`] [${(s.title || s.url).slice(0, 50)}](${s.url})`,
          ).join("\n");

          const embed = new EmbedBuilder()
            .setTitle(`\u{1f50d} ${question.slice(0, 200)}`)
            .setDescription(truncatedAnswer)
            .setColor(0x5865f2)
            .setFooter({ text: `Searched ${result.context.linksSearched} links across ${result.context.usersReferenced} users` });

          if (sourcesText) {
            embed.addFields({ name: "Top Sources", value: sourcesText });
          }

          await cmd.editReply({ embeds: [embed] });
        } catch (err) {
          logger.error({ err, question }, "RAG query failed in Discord");
          await cmd.editReply({ content: "Sorry, the query failed. Claude might be busy. Try again in a moment." });
        }
      }
    } catch (err) {
      logger.error({ err, sub }, "Slash command error");
      try {
        await cmd.editReply({ content: "Something went wrong. Check the logs." });
      } catch {
        // interaction may have expired
      }
    } finally {
      await session.close();
    }
  });

  client.on("messageCreate", async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // Ignore messages not in the configured channel
    if (message.channelId !== config.channelId) return;

    const extracted = extractUrls(message.content);
    if (extracted.length === 0) return;

    for (const { url, comment } of extracted) {
      try {
        enqueue(queueClient.db, {
          url,
          comment: comment || undefined,
          discordMessageId: message.id,
          discordChannelId: message.channelId,
          discordAuthorId: message.author.id,
          discordAuthorName: message.author.displayName ?? message.author.username,
        });
        await addReaction(message, REACTIONS.QUEUED);
      } catch (err: unknown) {
        // Handle UNIQUE constraint violation (duplicate discord_message_id)
        if (
          err instanceof Error &&
          err.message.includes("UNIQUE constraint failed")
        ) {
          await addReaction(message, REACTIONS.DUPLICATE);
        } else {
          logger.error({ err, url }, "Failed to enqueue URL");
          await addReaction(message, REACTIONS.FAILED);
        }
      }
    }
  });

  return {
    client,
    async login(): Promise<void> {
      await client.login(config.token);
    },
    async destroy(): Promise<void> {
      await client.destroy();
    },
  };
}
