export type TimeEntryDurationInput = {
  started_at: string;
  ended_at: string | null;
  paused_duration: number;
};

export function calculateEntryDurationHours(entry: TimeEntryDurationInput): number {
  if (!entry.ended_at) {
    return 0;
  }

  const startMs = new Date(entry.started_at).getTime();
  const endMs = new Date(entry.ended_at).getTime();
  const pausedMs = entry.paused_duration * 1000;
  const durationMs = endMs - startMs - pausedMs;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return durationMs / (1000 * 60 * 60);
}
