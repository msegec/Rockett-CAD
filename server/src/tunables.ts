import { DAY, HOUR, MINUTE } from "@rockett/shared";

export const TIMING_MS = {
  temporaryProjectLifetime: DAY,
  temporaryProjectTouch: MINUTE,
  temporaryProjectSweep: HOUR,
  sessionIdle: 7 * DAY,
  sessionAbsolute: 30 * DAY,
  authFailureWindow: 15 * MINUTE,
  sizeLimitSearch: 1000,
} as const;

export const TRIAL_BUDGET = {
  sizeLimitBuilds: 8,
} as const;
