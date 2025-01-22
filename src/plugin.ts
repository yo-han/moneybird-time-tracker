import streamDeck, { LogLevel } from '@elgato/streamdeck';
import { TimeTracker } from './actions/time-tracker';

streamDeck.logger.setLevel(LogLevel.DEBUG);
// streamDeck.logger.setLevel(LogLevel.INFO);

const timeTrackerAction = new TimeTracker();

streamDeck.actions.registerAction(timeTrackerAction);

streamDeck.connect();
