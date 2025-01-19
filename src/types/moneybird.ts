import { JsonObject, JsonValue } from '@elgato/streamdeck';

export interface TimerSettings extends JsonObject {
  apiKey: string;
  administrationId: string;
  projectId: string;
  userId: string;
  description?: string;
  billable?: boolean;
  isRunning?: boolean;
  startTime?: string;
  timeEntryId?: string;
  administrations?: JsonValue;
  projects?: JsonValue;
  users?: JsonValue;
  [key: string]: JsonValue;
}

export interface TimeEntry {
  id?: string;
  time_entry: {
    started_at: string;
    ended_at?: string;
    user_id: string;
    project_id: string;
    description?: string;
  };
}

export interface MoneybirdProject {
  id: string;
  name: string;
}

export interface MoneybirdAdministration {
  id: string;
  name: string;
}

export interface MoneybirdUser {
  id: string;
  name: string;
  email: string;
}
