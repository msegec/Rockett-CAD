import { Router, json, type Response } from "express";
import { AUTH_ROUTES, loginBody, parse } from "@rockett/shared";
import { registerBootstrapRoutes } from "./bootstrap.js";
import {
  cookieConfig,
  readSessionCookie,
  sessionCookie,
  type CookieConfig,
} from "./cookie.js";
import { DUMMY_HASH, verifyPassword } from "./password.js";
import { AuthRateLimiter, HashCapacityError } from "./rateLimit.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

function refused(res: Response, seconds: number) {
  return res
    .set("Retry-After", String(seconds))
    .status(429)
    .json({ error: "rate limited" });
}

function registerSetupGuard(router: Router, limiter: AuthRateLimiter): void {
  router.use(
    AUTH_ROUTES.setup.path,
    json({ limit: "1kb" }),
    (req, res, next) => {
      if (req.method !== "POST") return next();
      const username = req.body?.username;
      const ip = req.ip ?? "";
      const wait = limiter.check(
        typeof username === "string" ? username : "",
        ip,
      );
      if (wait !== null) return refused(res, wait);
      if (typeof username !== "string" || username.length > 32) return next();
      res.once("finish", () => {
        if (res.statusCode === 201) limiter.success(username);
        else if (res.statusCode === 403) limiter.failure(username, ip);
      });
      next();
    },
  );
}

export function createAuthRouter(
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig = cookieConfig(process.env.ROCKETT_COOKIE_SECURE),
  setupToken: string | undefined = process.env.ROCKETT_SETUP_TOKEN,
  limiter = new AuthRateLimiter(),
  verify: typeof verifyPassword = verifyPassword,
): Router {
  const router = Router();
  registerSetupGuard(router, limiter);
  registerBootstrapRoutes(router, users, setupToken, limiter);
  router.post(
    AUTH_ROUTES.login.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        const { username, password } = parse(loginBody, req.body ?? {});
        const ip = req.ip ?? "";
        const wait = limiter.check(username, ip);
        if (wait !== null) return refused(res, wait);
        const { record, matches } = await limiter.hash(async () => {
          const record = await users.findByUsername(username);
          const matches = await verify(
            password,
            record?.passwordHash ?? DUMMY_HASH,
          );
          return { record, matches };
        });
        if (!record || record.status !== "active" || !matches) {
          limiter.failure(username, ip);
          return res.status(401).json({ error: "unauthenticated" });
        }
        limiter.success(username);
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
  router.use(
    (
      err: unknown,
      _req: unknown,
      res: Response,
      next: (err: unknown) => void,
    ) => {
      if (err instanceof HashCapacityError) return refused(res, 1);
      next(err);
    },
  );
  return router;
}
