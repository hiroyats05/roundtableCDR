import type { FastifyInstance } from "fastify";
import { AccessToken, RoomServiceClient, TrackType } from "livekit-server-sdk";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { channels } from "../../database/schema.js";
import { config } from "../../config/index.js";

interface ParticipantActionBody {
  userId: string;
}

const roomService = new RoomServiceClient(
  config.livekitHttpUrl,
  config.livekitApiKey,
  config.livekitApiSecret
);

export async function voiceRoutes(app: FastifyInstance) {
  // Audio transmission test: a private room per user where the client publishes
  // its mic with one identity and listens back with another, so it hears exactly
  // what other participants would receive through LiveKit.
  app.post("/voice/test/token", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const roomName = `voice-test:${request.user.id}`;

    const createToken = (identity: string, canPublish: boolean) => {
      const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity,
        name: request.user!.username,
        ttl: "10m",
      });
      token.addGrant({ roomJoin: true, room: roomName, canPublish, canSubscribe: !canPublish });
      return token.toJwt();
    };

    return reply.send({
      url: config.livekitUrl,
      roomName,
      publisherToken: await createToken(`${request.user.id}:test-publisher`, true),
      listenerToken: await createToken(`${request.user.id}:test-listener`, false),
    });
  });

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

  app.post<{ Params: { channelId: string }; Body: ParticipantActionBody }>(
    "/voice/:channelId/kick",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      if (request.user.role !== "ADMIN") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const { channelId } = request.params;
      const { userId } = request.body ?? ({} as ParticipantActionBody);
      if (!userId) {
        return reply.status(400).send({ error: "userId is required" });
      }

      try {
        await roomService.removeParticipant(`voice:${channelId}`, userId);
      } catch {
        return reply.status(404).send({ error: "Participant not found in call" });
      }

      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { channelId: string }; Body: ParticipantActionBody }>(
    "/voice/:channelId/mute",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      if (request.user.role !== "ADMIN") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const { channelId } = request.params;
      const { userId } = request.body ?? ({} as ParticipantActionBody);
      if (!userId) {
        return reply.status(400).send({ error: "userId is required" });
      }

      const roomName = `voice:${channelId}`;

      try {
        const participant = await roomService.getParticipant(roomName, userId);
        const audioTrack = participant.tracks.find((t) => t.type === TrackType.AUDIO);
        if (!audioTrack) {
          return reply.status(404).send({ error: "No audio track found for participant" });
        }

        // Soft mute: LiveKit lets the participant unmute themselves again afterwards.
        await roomService.mutePublishedTrack(roomName, userId, audioTrack.sid, true);
      } catch {
        return reply.status(404).send({ error: "Participant not found in call" });
      }

      return reply.send({ ok: true });
    }
  );
}
