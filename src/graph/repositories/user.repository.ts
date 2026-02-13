import type { Session } from "neo4j-driver";
import type { UserNode } from "../types.js";

export async function createUser(
  session: Session,
  user: UserNode,
): Promise<void> {
  await session.run(
    `MERGE (u:User {discordId: $discordId})
     SET u.username = $username,
         u.displayName = $displayName,
         u.avatarUrl = $avatarUrl`,
    {
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
  );
}

export async function findAllUsers(
  session: Session,
): Promise<Array<UserNode & { linkCount: number }>> {
  const result = await session.run(`
    MATCH (u:User)
    OPTIONAL MATCH (u)<-[:SHARED_BY]-(l:Link)
    RETURN u.discordId AS discordId, u.username AS username,
           u.displayName AS displayName, u.avatarUrl AS avatarUrl,
           count(l) AS linkCount
    ORDER BY linkCount DESC
  `);

  const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

  return result.records.map((r) => ({
    discordId: r.get("discordId") as string,
    username: r.get("username") as string,
    displayName: r.get("displayName") as string,
    avatarUrl: r.get("avatarUrl") as string,
    linkCount: toNum(r.get("linkCount")),
  }));
}
