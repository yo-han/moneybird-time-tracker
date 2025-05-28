import { JsonObject, JsonValue } from '@elgato/streamdeck';

export interface TimerSettings extends JsonObject {
  apiKey: string;
  administrationId: string;
  projectId: string;
  contactId?: string;
  userId: string;
  description?: string;
  billable?: boolean;
  isRunning?: boolean;
  startTime?: string;
  timeEntryId?: string;
  displayTitle?: string;
  autoStopEnabled?: boolean;
  autoStopHours?: number;
  administrations?: Record<string, JsonValue>;
  projects?: Record<string, JsonValue>;
  contacts?: Record<string, JsonValue>;
  users?: Record<string, JsonValue>;
}

export interface TimeEntry {
  id?: string;
  time_entry: {
    started_at: string;
    ended_at?: string;
    user_id: string;
    project_id: string;
    contact_id?: string;
    description?: string;
    billable: boolean;
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

export interface MoneybirdContact {
  id: string;
  company_name: string;
  firstname?: string;
  lastname?: string;
}

// Helper functies om data te converteren naar JsonValue compatibele formaten
export function projectToJson(project: MoneybirdProject): Record<string, JsonValue> {
  return {
    id: project.id,
    name: project.name,
  };
}

export function administrationToJson(admin: MoneybirdAdministration): Record<string, JsonValue> {
  return {
    id: admin.id,
    name: admin.name,
  };
}

export function userToJson(user: MoneybirdUser): Record<string, JsonValue> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

export function contactToJson(contact: MoneybirdContact): Record<string, JsonValue> {
  return {
    id: contact.id,
    company_name:
      contact.company_name ||
      `${contact.firstname || ''} ${contact.lastname || ''}`.trim() ||
      'Unnamed Contact',
  };
}
