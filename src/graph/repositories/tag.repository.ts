import type { Session } from "neo4j-driver";
import type { TagNode } from "../types.js";

export async function createTag(
  session: Session,
  name: string,
): Promise<TagNode> {
  const normalizedName = name.toLowerCase();
  const result = await session.run(
    `MERGE (t:Tag {name: $name}) RETURN t`,
    { name: normalizedName },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create tag node");
  }
  return record.get("t").properties as TagNode;
}

export async function findTag(
  session: Session,
  name: string,
): Promise<TagNode | null> {
  const normalizedName = name.toLowerCase();
  const result = await session.run(
    `MATCH (t:Tag {name: $name}) RETURN t`,
    { name: normalizedName },
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }
  return record.get("t").properties as TagNode;
}

export async function listTags(session: Session): Promise<TagNode[]> {
  const result = await session.run(
    `MATCH (t:Tag) RETURN t ORDER BY t.name`,
  );

  return result.records.map((record) => record.get("t").properties as TagNode);
}
