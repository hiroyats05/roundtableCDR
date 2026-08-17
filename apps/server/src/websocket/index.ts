import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { wsManager } from "./manager.js";
import { SESSION_COOKIE } from "../modules/auth/session.js";

export async function websocketPlugin(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket, request) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    void wsManager.handleConnection(socket, sessionId);
  });
}
