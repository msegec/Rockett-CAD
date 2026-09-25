import { DAY, HOUR, MINUTE } from "@rockett/shared";

export const TIMING_MS = {
  temporaryProjectLifetime: DAY,
  temporaryProjectTouch: MINUTE,
  temporaryProjectSweep: HOUR,
  sessionIdle: 7 * DAY,
  sessionAbsolute: 30 * DAY,
} as const;
