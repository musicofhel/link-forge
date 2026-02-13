import type { Session } from "neo4j-driver";
import type { CategoryNode } from "../types.js";

export async function createCategory(
  session: Session,
  name: string,
  description: string,
): Promise<CategoryNode> {
  const result = await session.run(
    `MERGE (c:Category {name: $name})
     SET c.description = $description,
         c.linkCount = 0
     RETURN c`,
    { name, description },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create category node");
  }
  return record.get("c").properties as CategoryNode;
}

export async function findCategory(
  session: Session,
  name: string,
): Promise<CategoryNode | null> {
  const result = await session.run(
    `MATCH (c:Category {name: $name}) RETURN c`,
    { name },
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }
  return record.get("c").properties as CategoryNode;
}

export async function listCategories(
  session: Session,
): Promise<CategoryNode[]> {
  const result = await session.run(
    `MATCH (c:Category)
     OPTIONAL MATCH (l:Link)-[:CATEGORIZED_IN]->(c)
     RETURN c, count(l) AS linkCount
     ORDER BY c.name`,
  );

  return result.records.map((record) => {
    const props = record.get("c").properties as CategoryNode;
    const linkCount = record.get("linkCount");
    return {
      ...props,
      linkCount: typeof linkCount === "number" ? linkCount : Number(linkCount),
    };
  });
}

export interface CategoryTreeNode extends CategoryNode {
  subcategories: CategoryNode[];
}

export async function listCategoryTree(
  session: Session,
): Promise<CategoryTreeNode[]> {
  const result = await session.run(
    `MATCH (c:Category)
     WHERE NOT (c)-[:SUBCATEGORY_OF]->()
     OPTIONAL MATCH (sub:Category)-[:SUBCATEGORY_OF]->(c)
     OPTIONAL MATCH (l:Link)-[:CATEGORIZED_IN]->(c)
     RETURN c, collect(DISTINCT sub) AS subcategories, count(DISTINCT l) AS linkCount
     ORDER BY c.name`,
  );

  return result.records.map((record) => {
    const props = record.get("c").properties as CategoryNode;
    const linkCount = record.get("linkCount");
    const subs = record.get("subcategories") as Array<{ properties: CategoryNode }>;
    return {
      ...props,
      linkCount: typeof linkCount === "number" ? linkCount : Number(linkCount),
      subcategories: subs
        .filter((s) => s !== null)
        .map((s) => s.properties as CategoryNode),
    };
  });
}

export async function updateLinkCount(
  session: Session,
  name: string,
): Promise<void> {
  await session.run(
    `MATCH (c:Category {name: $name})
     OPTIONAL MATCH (l:Link)-[:CATEGORIZED_IN]->(c)
     WITH c, count(l) AS cnt
     SET c.linkCount = cnt`,
    { name },
  );
}
