import type { WebSocket } from "@fastify/websocket";
import type { ServerEvent, ClientEvent, Message } from "@saladereunioes/shared";
import { eq } from "drizzle-orm";
import { db } from "../database/index.js";
import { messages, channels } from "../database/schema.js";
import { getUserFromSession } from "../modules/auth/session.js";

const MAX_MESSAGE_LENGTH = 4000;

interface AuthenticatedSocket {
  socket: WebSocket;
  userId: string;
  username: string;
  joinedChannels: Set<string>;
}

export class WebSocketManager {
  private connections = new Map<WebSocket, AuthenticatedSocket>();
  private userConnectionCount = new Map<string, number>();
  private channelSubscribers = new Map<string, Set<WebSocket>>();

  async handleConnection(socket: WebSocket, sessionId: string | undefined) {
    const user = await getUserFromSession(sessionId);
    if (!user) {
      socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      socket.close();
      return;
    }

    const conn: AuthenticatedSocket = {
      socket,
      userId: user.id,
      username: user.username,
      joinedChannels: new Set(),
    };

    this.connections.set(socket, conn);
    this.incrementPresence(user.id);

    // Send current online users to the new connection
    for (const onlineUserId of this.userConnectionCount.keys()) {
      if (onlineUserId !== user.id) {
        socket.send(JSON.stringify({ type: "presence:online", userId: onlineUserId }));
      }
    }

    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as ClientEvent;
        this.handleEvent(socket, event);
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    socket.on("close", () => {
      this.handleDisconnect(socket);
    });
  }

  private handleEvent(socket: WebSocket, event: ClientEvent) {
    const conn = this.connections.get(socket);
    if (!conn) return;

    switch (event.type) {
      case "channel:join":
        this.joinChannel(socket, event.channelId);
        break;
      case "channel:leave":
        this.leaveChannel(socket, event.channelId);
        break;
      case "message:send":
        void this.sendMessage(conn, event.channelId, event.content);
        break;
    }
  }

  private joinChannel(socket: WebSocket, channelId: string) {
    const conn = this.connections.get(socket);
    if (!conn) return;

    if (!this.channelSubscribers.has(channelId)) {
      this.channelSubscribers.set(channelId, new Set());
    }
    this.channelSubscribers.get(channelId)!.add(socket);
    conn.joinedChannels.add(channelId);
  }

  private leaveChannel(socket: WebSocket, channelId: string) {
    const conn = this.connections.get(socket);
    if (!conn) return;

    this.channelSubscribers.get(channelId)?.delete(socket);
    conn.joinedChannels.delete(channelId);
  }

  private async sendMessage(conn: AuthenticatedSocket, channelId: string, content: string) {
    if (!content || content.trim().length === 0) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      conn.socket.send(
        JSON.stringify({ type: "error", message: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` })
      );
      return;
    }

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel || channel.type !== "TEXT") {
      conn.socket.send(JSON.stringify({ type: "error", message: "Invalid text channel" }));
      return;
    }

    const [inserted] = await db
      .insert(messages)
      .values({
        channelId,
        authorId: conn.userId,
        content: content.trim(),
      })
      .returning();

    const message: Message = {
      id: inserted.id,
      channelId: inserted.channelId,
      authorId: inserted.authorId,
      content: inserted.content,
      createdAt: inserted.createdAt.toISOString(),
    };

    this.broadcastToChannel(channelId, { type: "message:created", message });
  }

  private broadcastToChannel(channelId: string, event: ServerEvent) {
    const subscribers = this.channelSubscribers.get(channelId);
    if (!subscribers) return;

    const payload = JSON.stringify(event);
    for (const socket of subscribers) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  private incrementPresence(userId: string) {
    const count = (this.userConnectionCount.get(userId) ?? 0) + 1;
    this.userConnectionCount.set(userId, count);

    if (count === 1) {
      this.broadcast({ type: "presence:online", userId });
    }
  }

  private decrementPresence(userId: string) {
    const count = (this.userConnectionCount.get(userId) ?? 1) - 1;
    if (count <= 0) {
      this.userConnectionCount.delete(userId);
      this.broadcast({ type: "presence:offline", userId });
    } else {
      this.userConnectionCount.set(userId, count);
    }
  }

  private broadcast(event: ServerEvent) {
    const payload = JSON.stringify(event);
    for (const { socket } of this.connections.values()) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  private handleDisconnect(socket: WebSocket) {
    const conn = this.connections.get(socket);
    if (!conn) return;

    for (const channelId of conn.joinedChannels) {
      this.channelSubscribers.get(channelId)?.delete(socket);
    }

    this.connections.delete(socket);
    this.decrementPresence(conn.userId);
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userConnectionCount.keys());
  }
}

export const wsManager = new WebSocketManager();
