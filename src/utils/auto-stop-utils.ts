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

  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  return Math.max(0, autoStopHours - elapsedHours);
}
