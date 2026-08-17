import type { FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { channels } from "../../database/schema.js";
import { config } from "../../config/index.js";

export async function voiceRoutes(app: FastifyInstance) {
  app.post<{ Params: { channelId: string } }>(
    "/voice/:channelId/token",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const { channelId } = request.params;

      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      if (channel.type !== "VOICE") {
        return reply.status(400).send({ error: "Channel is not a voice channel" });
      }

      const roomName = `voice:${channelId}`;
      const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity: request.user.id,
        name: request.user.username,
        ttl: "1h",
      });

      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
      });

      const jwt = await token.toJwt();

      return reply.send({
        token: jwt,
        url: config.livekitUrl,
        roomName,
      });
    }
  );
}
