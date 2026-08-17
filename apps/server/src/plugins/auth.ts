import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { authenticateRequest } from "../modules/auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; username: string; role: "ADMIN" | "MEMBER" };
  }
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    await authenticateRequest(request);
  });
});
