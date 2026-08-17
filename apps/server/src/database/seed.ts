import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { channels } from "./schema.js";

const seedChannels = [
  { name: "geral", type: "TEXT", position: 0 },
  { name: "jogos", type: "TEXT", position: 1 },
  { name: "Lobby", type: "VOICE", position: 2 },
  { name: "Jogando", type: "VOICE", position: 3 },
];

async function seed() {
  const existing = await db.select().from(channels).limit(1);
  if (existing.length > 0) {
    console.log("Channels already seeded, skipping.");
    return;
  }

  await db.insert(channels).values(seedChannels);
  console.log("Seeded channels:", seedChannels.map((c) => c.name).join(", "));
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
