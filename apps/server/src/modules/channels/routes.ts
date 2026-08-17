import type { FastifyInstance } from "fastify";
import type { Channel } from "@saladereunioes/shared";
import { asc, desc, eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";
import { db } from "../../database/index.js";
import { channels } from "../../database/schema.js";
import { config } from "../../config/index.js";
import { wsManager } from "../../websocket/manager.js";

interface CreateChannelBody {
  name: string;
  type: "TEXT" | "VOICE";
}

const roomService = new RoomServiceClient(
  config.livekitHttpUrl,
  config.livekitApiKey,
  config.livekitApiSecret
);

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

  app.post<{ Body: CreateChannelBody }>("/channels", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    if (request.user.role !== "ADMIN") {
      return reply.status(403).send({ error: "Admin access required" });
    }

    const { name, type } = request.body ?? ({} as CreateChannelBody);

    if (!name || name.trim().length === 0 || name.length > 64) {
      return reply.status(400).send({ error: "Name must be 1-64 characters" });
    }
    if (type !== "TEXT" && type !== "VOICE") {
      return reply.status(400).send({ error: "Type must be TEXT or VOICE" });
    }

    const [last] = await db
      .select({ position: channels.position })
      .from(channels)
      .orderBy(desc(channels.position))
      .limit(1);

    const [channel] = await db
      .insert(channels)
      .values({ name: name.trim(), type, position: (last?.position ?? -1) + 1 })
      .returning({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        position: channels.position,
      });

    wsManager.broadcast({ type: "channel:created", channel: channel as Channel });

    return reply.status(201).send(channel);
  });

  app.delete<{ Params: { channelId: string } }>(
    "/channels/:channelId",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      if (request.user.role !== "ADMIN") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const { channelId } = request.params;

      const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      if (channel.type === "VOICE") {
        try {
          await roomService.deleteRoom(`voice:${channelId}`);
        } catch {
          // room may not exist if nobody ever joined; safe to ignore
        }
      }

      await db.delete(channels).where(eq(channels.id, channelId));

      wsManager.broadcast({ type: "channel:deleted", channelId });

      return reply.send({ ok: true });
    }
  );
}
