const MS_PER_HOUR = 60 * 60 * 1000;

export function normalizeAutoStopHours(hours: unknown): number | null {
  if (typeof hours === 'number') {
    if (Number.isFinite(hours) && hours > 0) {
      return hours;
    }
    return null;
  }

  if (typeof hours === 'string') {
    const parsed = Number.parseFloat(hours);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  }

  return null;
}

export function calculateRemainingAutoStopHours(
  startTimeIso: string,
  autoStopHours: number,
  now: Date = new Date()
): number {
  const startTime = new Date(startTimeIso);
  const elapsedMs = now.getTime() - startTime.getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return autoStopHours;
  }

  const elapsedHours = elapsedMs / MS_PER_HOUR;
  return Math.max(0, autoStopHours - elapsedHours);
}

/**
 * The moment an auto-stopped entry should end: the configured limit after the start, or
 * now if that is earlier. Node timers do not advance while the machine sleeps, so the
 * auto-stop timeout can fire hours late; ending at the limit keeps those hours off the entry.
 */
export function resolveAutoStopEndTime(
  startTimeIso: string,
  autoStopHours: number,
  now: Date = new Date()
): Date {
  const startMs = new Date(startTimeIso).getTime();
  if (!Number.isFinite(startMs)) {
    return now;
  }

  const limitMs = startMs + autoStopHours * MS_PER_HOUR;
  return new Date(Math.min(limitMs, now.getTime()));
}
