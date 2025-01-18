import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { TimeTracker } from "./actions/time-tracker";

// Enable debug logging
streamDeck.logger.setLevel(LogLevel.DEBUG);

// Create an instance of the TimeTracker action
const timeTrackerAction = new TimeTracker();

// Register the time tracker action
streamDeck.actions.registerAction(timeTrackerAction);

// Connect to the Stream Deck
streamDeck.connect();