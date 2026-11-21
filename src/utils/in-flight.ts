/**
 * Runs `task` unless a task for the same key is still running. Returns false when the call
 * was skipped. Used to stop a quick double press from starting two timers or creating two
 * invoices while the first Moneybird request is still in flight.
 */
export async function runExclusivePerKey(
  inFlight: Set<string>,
  key: string,
  task: () => Promise<void>
): Promise<boolean> {
  if (inFlight.has(key)) {
    return false;
  }

  inFlight.add(key);
  try {
    await task();
    return true;
  } finally {
    inFlight.delete(key);
  }
}
