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

export function setTimeoutForKey(
  map: Map<string, NodeJS.Timeout>,
  key: string,
  timeout: NodeJS.Timeout
): void {
  clearTimeoutForKey(map, key);
  map.set(key, timeout);
}

export function setIntervalForKey(
  map: Map<string, NodeJS.Timeout>,
  key: string,
  interval: NodeJS.Timeout
): void {
  clearIntervalForKey(map, key);
  map.set(key, interval);
}
