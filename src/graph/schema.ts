import type { Session } from "neo4j-driver";
import type { Logger } from "pino";

const CONSTRAINTS = [
  "CREATE CONSTRAINT link_url_unique IF NOT EXISTS FOR (l:Link) REQUIRE l.url IS UNIQUE",
  "CREATE CONSTRAINT category_name_unique IF NOT EXISTS FOR (c:Category) REQUIRE c.name IS UNIQUE",
  "CREATE CONSTRAINT tag_name_unique IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE",
  "CREATE CONSTRAINT technology_name_unique IF NOT EXISTS FOR (tech:Technology) REQUIRE tech.name IS UNIQUE",
  "CREATE CONSTRAINT tool_name_unique IF NOT EXISTS FOR (tool:Tool) REQUIRE tool.name IS UNIQUE",
  "CREATE CONSTRAINT user_discord_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.discordId IS UNIQUE",
];

const TEXT_INDEXES = [
  "CREATE INDEX link_title_idx IF NOT EXISTS FOR (l:Link) ON (l.title)",
  "CREATE INDEX link_description_idx IF NOT EXISTS FOR (l:Link) ON (l.description)",
];

const VECTOR_INDEX = `CREATE VECTOR INDEX link_embedding_idx IF NOT EXISTS
FOR (l:Link) ON (l.embedding)
OPTIONS {indexConfig: {\`vector.dimensions\`: 384, \`vector.similarity_function\`: 'cosine'}}`;

export async function setupSchema(
  session: Session,
  logger: Logger,
): Promise<void> {
  logger.info("Setting up Neo4j schema constraints...");
  for (const cypher of CONSTRAINTS) {
    await session.run(cypher);
    logger.debug({ cypher }, "Constraint created");
  }

  logger.info("Setting up text indexes...");
  for (const cypher of TEXT_INDEXES) {
    await session.run(cypher);
    logger.debug({ cypher }, "Text index created");
  }

  logger.info("Setting up vector index...");
  await session.run(VECTOR_INDEX);
  logger.debug("Vector index created");

  logger.info("Neo4j schema setup complete");
}
