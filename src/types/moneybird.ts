// JsonObject and JsonValue types (removed from @elgato/streamdeck v2.0.1)
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue | undefined };

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

export interface InvoiceSettings extends JsonObject {
  apiKey: string;
  administrationId: string;
  contactId: string;
  periodType?: 'month' | 'quarter' | 'year';
  periodRange?: 'current' | 'last';
  period?:
    | 'current_month'
    | 'last_month'
    | 'current_quarter'
    | 'last_quarter'
    | 'current_year'
    | 'custom';
  customStartDate?: string;
  customEndDate?: string;
  description?: string;
  workflow_id?: string;
  displayTitle?: string;
  hourlyRate?: number | string;
  administrations?: Record<string, JsonValue>;
  contacts?: Record<string, JsonValue>;
  isPreview?: boolean;
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

export interface MoneybirdTimeEntry {
  id: string;
  started_at: string;
  ended_at: string | null;
  description: string;
  billable: boolean;
  user_id: string;
  contact_id: string;
  project_id: string;
  paused_duration: number;
  created_at: string;
  updated_at: string;
}

export interface MoneybirdSalesInvoice {
  id: string;
  invoice_id: string;
  contact_id: string;
  state: string;
  invoice_date: string;
  reference: string;
  total_price_incl_tax: string;
  url: string;
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
