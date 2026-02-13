import dotenv from "dotenv";
import { createGraphClient } from "./client.js";
import { setupSchema } from "./schema.js";
import { createLogger } from "../config/logger.js";

dotenv.config();

const logger = createLogger(process.env["LOG_LEVEL"] ?? "info", "graph-setup");

async function main(): Promise<void> {
  const uri = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
  const user = process.env["NEO4J_USER"] ?? "neo4j";
  const password = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";

  const client = await createGraphClient(uri, user, password, logger);
  const session = client.session();

  try {
    await setupSchema(session, logger);
    logger.info("Schema setup complete");
  } finally {
    await session.close();
    await client.close();
  }
}

main().catch((err: unknown) => {
  logger.error(err, "Schema setup failed");
  process.exit(1);
});
