import type { Action, KeyAction } from '@elgato/streamdeck';

type KeyActionOf<TAction> = TAction extends Action<infer TSettings> ? KeyAction<TSettings> : never;

/**
 * Narrows an event to one whose action is a key action.
 *
 * Since @elgato/streamdeck v3 the `Action` union also contains dial and Neo infobar
 * actions, which have no `setTitle`/`setImage`. All actions of this plugin are
 * Keypad-only (see manifest.json), so the other variants never reach the handlers.
 */
export function isKeyActionEvent<TEvent extends { action: { isKey(): boolean } }>(
  ev: TEvent
): ev is TEvent & { action: KeyActionOf<TEvent['action']> } {
  return ev.action.isKey();
}
