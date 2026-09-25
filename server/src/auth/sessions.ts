import crypto from "node:crypto";
import { TIMING_MS } from "../tunables.js";

const MAX_PER_USER = 20;

interface Session {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  create(userId: string): string {
    const now = this.now();
    const own: string[] = [];
    for (const [token, session] of this.sessions) {
      if (this.expired(session, now)) this.sessions.delete(token);
      else if (session.userId === userId) own.push(token);
    }
    const excess = Math.max(0, own.length - MAX_PER_USER + 1);
    for (const token of own.slice(0, excess)) this.sessions.delete(token);
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { userId, createdAt: now, lastSeenAt: now });
    return token;
  }

  resolve(token: string): string | undefined {
    const session = this.sessions.get(token);
    if (!session) return undefined;
    const now = this.now();
    if (this.expired(session, now)) {
      this.sessions.delete(token);
      return undefined;
    }
    session.lastSeenAt = now;
    return session.userId;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  revokeUser(userId: string, keepToken?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId && token !== keepToken) {
        this.sessions.delete(token);
      }
    }
  }

  private expired(session: Session, now: number): boolean {
    return (
      now - session.lastSeenAt >= TIMING_MS.sessionIdle ||
      now - session.createdAt >= TIMING_MS.sessionAbsolute
    );
  }
}
