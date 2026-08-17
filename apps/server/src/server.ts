import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config/index.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./modules/auth/routes.js";
import { channelRoutes } from "./modules/channels/routes.js";
import { messageRoutes } from "./modules/messages/routes.js";
import { voiceRoutes } from "./modules/voice/routes.js";
import { usersRoutes } from "./modules/users/routes.js";
import { websocketPlugin } from "./websocket/index.js";
import { SESSION_COOKIE } from "./modules/auth/session.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.frontendUrl,
  credentials: true,
});

await app.register(cookie, {
  secret: config.sessionSecret,
  parseOptions: {},
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await app.register(authPlugin);

app.get("/health", async () => ({ status: "ok" }));

await app.register(authRoutes);
await app.register(channelRoutes);
await app.register(messageRoutes);
await app.register(voiceRoutes);
await app.register(usersRoutes);
await app.register(websocketPlugin);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`WebSocket available at ws://localhost:${config.port}/ws`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { SESSION_COOKIE };
