/**
 * Set a user's knowledge interests by display name.
 * If the user doesn't exist yet, creates them with a synthetic ID.
 *
 * Usage: npx tsx scripts/set-interests.ts "bortles" "options trading, prediction markets, DeFi, volatility modeling"
 *        npx tsx scripts/set-interests.ts "aaron" "AI, crypto, CBDC, psychology, ecommerce, advanced forecasting, stock market"
 */
import { loadConfig } from "../src/config/index.js";
import { createFailoverClient } from "../src/graph/client.js";

async function main() {
  const name = process.argv[2];
  const interestsRaw = process.argv[3];

  if (!name || !interestsRaw) {
    console.log('Usage: npx tsx scripts/set-interests.ts "<name>" "<comma-separated interests>"');
    console.log('Example: npx tsx scripts/set-interests.ts "bortles" "options trading, prediction markets, DeFi"');
    process.exit(1);
  }

  const interests = interestsRaw.split(",").map(t => t.trim()).filter(t => t.length > 0);

  loadConfig(); // loads .env
  const graphClient = createFailoverClient();
  await graphClient.connect();

  const session = graphClient.session();
  try {
    // Find user by display name or username (case-insensitive)
    const existing = await session.run(
      `MATCH (u:User)
       WHERE toLower(u.displayName) = toLower($name)
          OR toLower(u.username) = toLower($name)
       RETURN u.discordId AS id, u.displayName AS displayName`,
      { name },
    );

    if (existing.records.length > 0) {
      const record = existing.records[0]!;
      const discordId = record.get("id") as string;
      const displayName = record.get("displayName") as string;
      await session.run(
        `MATCH (u:User {discordId: $discordId}) SET u.interests = $interests`,
        { discordId, interests },
      );
      console.log(`Updated "${displayName}" interests:`);
    } else {
      // Create a new user with synthetic ID
      const syntheticId = `profile:${name.toLowerCase().replace(/\s+/g, "-")}`;
      await session.run(
        `MERGE (u:User {discordId: $discordId})
         SET u.username = $name,
             u.displayName = $name,
             u.avatarUrl = '',
             u.interests = $interests`,
        { discordId: syntheticId, name, interests },
      );
      console.log(`Created profile for "${name}" with interests:`);
    }

    for (const interest of interests) {
      console.log(`  - ${interest}`);
    }
  } finally {
    await session.close();
    await graphClient.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
