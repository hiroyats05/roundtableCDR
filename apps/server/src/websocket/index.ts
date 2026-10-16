import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { wsManager } from "./manager.js";
import { getSessionIdFromRequest } from "../modules/auth/session.js";

export async function websocketPlugin(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket, request) => {
    // Browsers can't set headers on a WebSocket handshake, so desktop clients
    // pass their token as a query param.
    const { token } = request.query as { token?: string };
    const sessionId = token || getSessionIdFromRequest(request);
    void wsManager.handleConnection(socket, sessionId);
  });
}
