import type { Session } from "neo4j-driver";

export interface ResolvedUser {
  discordId: string;
  displayName: string;
}

/**
 * Try to match a Google Drive folder name to an existing Neo4j User node.
 * Falls back to a synthetic `gdrive:<folderName>` identity for non-Discord users.
 */
export async function resolveUserByDisplayName(
  session: Session,
  name: string,
): Promise<ResolvedUser> {
  const result = await session.run(
    `MATCH (u:User)
     WHERE toLower(u.displayName) = toLower($name)
        OR toLower(u.username) = toLower($name)
     RETURN u.discordId AS discordId, u.displayName AS displayName
     LIMIT 1`,
    { name },
  );

  if (result.records.length > 0) {
    const record = result.records[0]!;
    return {
      discordId: record.get("discordId") as string,
      displayName: record.get("displayName") as string,
    };
  }

  // No match — use a synthetic identity
  return {
    discordId: `gdrive:${name}`,
    displayName: name,
  };
}
