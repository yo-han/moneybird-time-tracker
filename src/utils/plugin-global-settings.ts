import streamDeck from '@elgato/streamdeck';
import type { PluginGlobalSettings } from '../types/moneybird.js';
import { GlobalSettingsStore } from './global-settings.js';

/** The plugin's global settings as stored by Stream Deck, shared by all actions. */
export const pluginGlobalSettings = new GlobalSettingsStore({
  load: () => streamDeck.settings.getGlobalSettings<PluginGlobalSettings>(),
  save: settings => streamDeck.settings.setGlobalSettings(settings),
});

/** Sends a message to the property inspector that is open, if any. */
export function notifyPropertyInspector(
  message: Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0]
): Promise<void> {
  return streamDeck.ui.sendToPropertyInspector(message);
}
