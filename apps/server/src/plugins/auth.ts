import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticateRequest } from "../modules/auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; username: string };
  }
}

export async function authPlugin(app: FastifyInstance) {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    await authenticateRequest(request);
  });
}
