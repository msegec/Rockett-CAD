import type { RequestHandler } from "express";
import { SESSION_COOKIE_NAME } from "./cookie.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set(["GET /api/health"]);

function sessionCookie(header: string | undefined): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const cookie = part.trim();
    if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
      return cookie.slice(SESSION_COOKIE_NAME.length + 1) || undefined;
  }
  return undefined;
}

export function requireSession(
  sessions: SessionStore,
  users: UserStore,
): RequestHandler {
  return async (req, res, next) => {
    if (PUBLIC_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`))
      return next();
    const token = sessionCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ error: "unauthenticated" });
    const userId = sessions.resolve(token);
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    try {
      const record = await users.get(userId);
      if (record?.status !== "active") {
        sessions.revoke(token);
        return res.status(401).json({ error: "unauthenticated" });
      }
      res.locals.user = toPublicUser(record);
      next();
    } catch (err) {
      next(err);
    }
  };
}
