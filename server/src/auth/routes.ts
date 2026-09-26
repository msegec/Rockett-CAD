import { Router, json } from "express";
import { AUTH_ROUTES, loginBody, parse } from "@rockett/shared";
import {
  cookieConfig,
  readSessionCookie,
  sessionCookie,
  type CookieConfig,
} from "./cookie.js";
import { DUMMY_HASH, verifyPassword } from "./password.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export function createAuthRouter(
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig = cookieConfig(process.env.ROCKETT_COOKIE_SECURE),
): Router {
  const router = Router();
  router.post(
    AUTH_ROUTES.login.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        const { username, password } = parse(loginBody, req.body ?? {});
        const record = await users.findByUsername(username);
        const matches = await verifyPassword(
          password,
          record?.passwordHash ?? DUMMY_HASH,
        );
        if (!record || record.status !== "active" || !matches)
          return res.status(401).json({ error: "unauthenticated" });
        const oldToken = readSessionCookie(req.headers.cookie, cookie.name);
        if (oldToken) sessions.revoke(oldToken);
        const token = sessions.create(record.id);
        res.set("Set-Cookie", sessionCookie(cookie, token));
        res.json(toPublicUser(record));
      } catch (err) {
        next(err);
      }
    },
  );
  router.post(AUTH_ROUTES.logout.path, (req, res) => {
    const token = readSessionCookie(req.headers.cookie, cookie.name);
    if (token) sessions.revoke(token);
    res.set("Set-Cookie", sessionCookie(cookie, "", 0));
    res.json({ ok: true });
  });
  router.get(AUTH_ROUTES.me.path, (_req, res) => res.json(res.locals.user));
  return router;
}
