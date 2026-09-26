import type { RequestHandler } from "express";
import { AUTH_ROUTES } from "@rockett/shared";
import { readSessionCookie, SESSION_COOKIE_NAME } from "./cookie.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/health",
  `${AUTH_ROUTES.login.method} /api${AUTH_ROUTES.login.path}`,
  `${AUTH_ROUTES.status.method} /api${AUTH_ROUTES.status.path}`,
  `${AUTH_ROUTES.setup.method} /api${AUTH_ROUTES.setup.path}`,
]);

export function requireSession(
  sessions: SessionStore,
  users: UserStore,
  cookieName = SESSION_COOKIE_NAME,
): RequestHandler {
  return async (req, res, next) => {
    if (PUBLIC_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`))
      return next();
    const token = readSessionCookie(req.headers.cookie, cookieName);
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
