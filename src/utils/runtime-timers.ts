export function clearTimeoutForKey(map: Map<string, NodeJS.Timeout>, key: string): void {
  const timeout = map.get(key);
  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  map.delete(key);
}

export function clearIntervalForKey(map: Map<string, NodeJS.Timeout>, key: string): void {
  const interval = map.get(key);
  if (!interval) {
    return;
  }

  clearInterval(interval);
  map.delete(key);
}
