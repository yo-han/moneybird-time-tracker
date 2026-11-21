/**
 * Formats elapsed seconds for a key title: `42s`, `17m`, `1h05`.
 * Hours keep their minutes, so a timer at 1h59m no longer reads as `1h`; the compact
 * form keeps `⏱️ 10h59` within the width of a key title.
 */
export function formatElapsedTime(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, '0')}`;
}
