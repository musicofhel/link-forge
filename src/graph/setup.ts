import dotenv from "dotenv";
import { createFailoverClient } from "./client.js";
import { setupSchema } from "./schema.js";
import { createLogger } from "../config/logger.js";

dotenv.config();

const logger = createLogger(process.env["LOG_LEVEL"] ?? "info", "graph-setup");

async function main(): Promise<void> {
  const client = createFailoverClient();
  await client.connect();
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
