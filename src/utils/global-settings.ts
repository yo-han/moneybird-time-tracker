import type { PluginGlobalSettings } from '../types/moneybird.js';

export type GlobalSettingsBackend = {
  load(): Promise<PluginGlobalSettings>;
  save(settings: PluginGlobalSettings): Promise<void>;
};

/**
 * Holds the plugin's global settings. They are read once and cached; the plugin is their
 * only writer, because the property inspectors send key changes to the plugin instead of
 * writing global settings themselves.
 *
 * Every read and update runs in order. Keys that appear at the same moment at startup each
 * run a read-modify-write (the API key migration); without the queue two of them could
 * both see "no global key yet" and the second would overwrite the first.
 */
export class GlobalSettingsStore {
  private cached: PluginGlobalSettings | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly backend: GlobalSettingsBackend) {}

  get(): Promise<PluginGlobalSettings> {
    return this.enqueue(() => this.current());
  }

  /**
   * Applies `change` to the current settings and saves the result. Returning the current
   * object unchanged skips the write. A failed save rejects and leaves the cache as it was.
   */
  update(
    change: (current: PluginGlobalSettings) => PluginGlobalSettings
  ): Promise<PluginGlobalSettings> {
    return this.enqueue(async () => {
      const current = await this.current();
      const next = change(current);
      if (next === current) {
        return current;
      }

      await this.backend.save(next);
      this.cached = next;
      return next;
    });
  }

  private async current(): Promise<PluginGlobalSettings> {
    if (!this.cached) {
      this.cached = { ...(await this.backend.load()) };
    }
    return this.cached;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    // A failed task rejects for its own caller only; the next task still runs.
    this.queue = run.catch(() => undefined);
    return run;
  }
}
