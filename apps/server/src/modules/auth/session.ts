import type { FastifyRequest } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "../../database/index.js";
import { sessions, users } from "../../database/schema.js";

const SESSION_COOKIE = "session_id";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// yatabe is always an admin, regardless of what the database says.
const HARDCODED_ADMIN_USERNAME = "yatabe";

export function resolveRole(username: string, role: string): "ADMIN" | "MEMBER" {
  if (username === HARDCODED_ADMIN_USERNAME) return "ADMIN";
  return role === "ADMIN" ? "ADMIN" : "MEMBER";
}

export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function getUserFromSession(sessionId: string | undefined) {
  if (!sessionId) return null;

  const result = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return result[0] ?? null;
}

export async function authenticateRequest(request: FastifyRequest) {
  const sessionId = request.cookies[SESSION_COOKIE];
  const user = await getUserFromSession(sessionId);
  if (user) {
    request.user = { id: user.id, username: user.username, role: resolveRole(user.username, user.role) };
  }
}

export { SESSION_COOKIE, SESSION_DURATION_MS };
