import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { users } from "../../database/schema.js";
import { config } from "../../config/index.js";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_DURATION_MS,
} from "./session.js";

interface RegisterBody {
  username: string;
  password: string;
  inviteCode: string;
}

interface LoginBody {
  username: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>("/auth/register", async (request, reply) => {
    const { username, password, inviteCode } = request.body ?? {};

    if (!username || !password || !inviteCode) {
      return reply.status(400).send({ error: "username, password, and inviteCode are required" });
    }

    if (inviteCode !== config.registerInviteCode) {
      return reply.status(403).send({ error: "Invalid invite code" });
    }

    if (username.length < 2 || username.length > 32) {
      return reply.status(400).send({ error: "Username must be 2-32 characters" });
    }

    if (password.length < 6) {
      return reply.status(400).send({ error: "Password must be at least 6 characters" });
    }

    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: "Username already taken" });
    }

    const passwordHash = await argon2.hash(password);
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash })
      .returning({ id: users.id, username: users.username });

    const sessionId = await createSession(user.id);

    reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return { user: { id: user.id, username: user.username } };
  });

  app.post<{ Body: LoginBody }>("/auth/login", async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || !password) {
      return reply.status(400).send({ error: "username and password are required" });
    }

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const sessionId = await createSession(user.id);

    reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return { user: { id: user.id, username: user.username } };
  });

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) {
      await deleteSession(sessionId);
    }

    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    return { user: request.user };
  });
}
