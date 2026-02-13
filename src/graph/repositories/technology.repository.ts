import type { Session } from "neo4j-driver";
import type { TechnologyNode } from "../types.js";

export async function createTechnology(
  session: Session,
  name: string,
  description: string,
): Promise<TechnologyNode> {
  const result = await session.run(
    `MERGE (tech:Technology {name: $name})
     SET tech.description = $description
     RETURN tech`,
    { name, description },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create technology node");
  }
  return record.get("tech").properties as TechnologyNode;
}

export async function findTechnology(
  session: Session,
  name: string,
): Promise<TechnologyNode | null> {
  const result = await session.run(
    `MATCH (tech:Technology {name: $name}) RETURN tech`,
    { name },
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }
  return record.get("tech").properties as TechnologyNode;
}

export async function listTechnologies(
  session: Session,
): Promise<TechnologyNode[]> {
  const result = await session.run(
    `MATCH (tech:Technology) RETURN tech ORDER BY tech.name`,
  );

  return result.records.map(
    (record) => record.get("tech").properties as TechnologyNode,
  );
}
