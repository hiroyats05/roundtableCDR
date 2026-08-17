import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../../database/index.js";
import { channels } from "../../database/schema.js";

export async function channelRoutes(app: FastifyInstance) {
  app.get("/channels", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const result = await db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        position: channels.position,
      })
      .from(channels)
      .orderBy(asc(channels.position));

    return reply.send(result);
  });
}
