import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../../database/index.js";
import { messages, channels } from "../../database/schema.js";
import { wsManager } from "../../websocket/manager.js";

const MESSAGE_LIMIT = 50;

export async function messageRoutes(app: FastifyInstance) {
  app.get<{ Params: { channelId: string } }>(
    "/channels/:channelId/messages",
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

      const result = await db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          authorId: messages.authorId,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.channelId, channelId))
        .orderBy(desc(messages.createdAt))
        .limit(MESSAGE_LIMIT);

      const chronological = result.reverse().map((m) => ({
        id: m.id,
        channelId: m.channelId,
        authorId: m.authorId,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      }));

      return reply.send(chronological);
    }
  );

  app.delete<{ Params: { messageId: string } }>(
    "/messages/:messageId",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const { messageId } = request.params;

      const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
      if (!message) {
        return reply.status(404).send({ error: "Message not found" });
      }

      const isOwn = message.authorId === request.user.id;
      const isAdmin = request.user.role === "ADMIN";
      if (!isOwn && !isAdmin) {
        return reply.status(403).send({ error: "Not allowed to delete this message" });
      }

      await db.delete(messages).where(eq(messages.id, messageId));

      wsManager.broadcastToChannel(message.channelId, {
        type: "message:deleted",
        channelId: message.channelId,
        messageId,
      });

      return reply.send({ ok: true });
    }
  );
}
