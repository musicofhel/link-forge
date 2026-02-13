import neo4j from "neo4j-driver";
import type { Driver, Session } from "neo4j-driver";
import type { Logger } from "pino";

export interface GraphClient {
  driver: Driver;
  session(): Session;
  close(): Promise<void>;
}

export async function createGraphClient(
  uri: string,
  user: string,
  password: string,
  logger: Logger,
): Promise<GraphClient> {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

  logger.info({ uri, user }, "Verifying Neo4j connectivity...");
  await driver.verifyConnectivity();
  logger.info("Neo4j connection verified");

  return {
    driver,
    session(): Session {
      return driver.session();
    },
    async close(): Promise<void> {
      logger.info("Closing Neo4j driver");
      await driver.close();
    },
  };
}
