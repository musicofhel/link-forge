import type { Session } from "neo4j-driver";
import type { ToolNode } from "../types.js";

export async function createTool(
  session: Session,
  name: string,
  description: string,
  url: string,
): Promise<ToolNode> {
  const result = await session.run(
    `MERGE (tool:Tool {name: $name})
     SET tool.description = $description,
         tool.url = $url
     RETURN tool`,
    { name, description, url },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create tool node");
  }
  return record.get("tool").properties as ToolNode;
}

export async function findTool(
  session: Session,
  name: string,
): Promise<ToolNode | null> {
  const result = await session.run(
    `MATCH (tool:Tool {name: $name}) RETURN tool`,
    { name },
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }
  return record.get("tool").properties as ToolNode;
}

export async function findToolsByTechnology(
  session: Session,
  techName: string,
): Promise<ToolNode[]> {
  const result = await session.run(
    `MATCH (tool:Tool)-[:USED_WITH]->(tech:Technology {name: $techName})
     RETURN tool
     ORDER BY tool.name`,
    { techName },
  );

  return result.records.map(
    (record) => record.get("tool").properties as ToolNode,
  );
}

export async function listTools(session: Session): Promise<ToolNode[]> {
  const result = await session.run(
    `MATCH (tool:Tool) RETURN tool ORDER BY tool.name`,
  );

  return result.records.map(
    (record) => record.get("tool").properties as ToolNode,
  );
}
