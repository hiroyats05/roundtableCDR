import type { FastifyInstance } from "fastify";
import type { User } from "@saladereunioes/shared";
import { eq } from "drizzle-orm";
import { db } from "../../database/index.js";
import { users } from "../../database/schema.js";
import { wsManager } from "../../websocket/manager.js";
import { resolveRole } from "../auth/session.js";

interface UpdateRoleBody {
  role: "ADMIN" | "MEMBER";
}

export async function usersRoutes(app: FastifyInstance) {
  app.get("/users", async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const result = await db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users);

    const withResolvedRoles = result.map((u) => ({ ...u, role: resolveRole(u.username, u.role) }));

    return reply.send(withResolvedRoles);
  });

  app.patch<{ Params: { userId: string }; Body: UpdateRoleBody }>(
    "/users/:userId/role",
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      if (request.user.role !== "ADMIN") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const { userId } = request.params;
      const { role } = request.body ?? ({} as UpdateRoleBody);

      if (role !== "ADMIN" && role !== "MEMBER") {
        return reply.status(400).send({ error: "role must be ADMIN or MEMBER" });
      }

      const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!target) {
        return reply.status(404).send({ error: "User not found" });
      }
      if (target.username === "yatabe") {
        return reply.status(400).send({ error: "yatabe is always an admin" });
      }

      const [updated] = await db
        .update(users)
        .set({ role })
        .where(eq(users.id, userId))
        .returning({ id: users.id, username: users.username, role: users.role });

      const resolved = { ...updated, role: resolveRole(updated.username, updated.role) };

      wsManager.broadcast({ type: "user:updated", user: resolved as User });

      return reply.send(resolved);
    }
  );
}
