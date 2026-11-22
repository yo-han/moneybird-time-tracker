// JsonObject and JsonValue types (removed from @elgato/streamdeck v2.0.1)
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue | undefined };

/**
 * Plugin wide settings, shared by every key.
 * - `apiKey`: the Moneybird API key that keys use unless they have their own.
 * - `defaultAdministrationId`: preselected in the property inspector of a new key.
 * - `adoptedApiKeyHash`: SHA-256 of the per-key API key that became the global key when
 *   upgrading. A key that still carries that old value is migrated even after the global
 *   key was rotated, instead of being mistaken for an intentional override.
 */
export interface PluginGlobalSettings extends JsonObject {
  apiKey?: string;
  defaultAdministrationId?: string;
  adoptedApiKeyHash?: string;
}

/**
 * Credentials stored per key. `apiKey` is only set when the key uses another API key than
 * the global one (`apiKeyIsOverride`), or when it was configured before the global key
 * existed and has not been migrated yet.
 */
export interface KeyCredentials extends JsonObject {
  apiKey?: string;
  apiKeyIsOverride?: boolean;
  administrationId: string;
}

export interface TimerSettings extends KeyCredentials {
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

export interface InvoiceSettings extends KeyCredentials {
  administrationId: string;
  contactId: string;
  periodType?: 'month' | 'quarter' | 'year';
  periodRange?: 'current' | 'last';
  period?:
    'current_month' | 'last_month' | 'current_quarter' | 'last_quarter' | 'current_year' | 'custom';
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
  /** Set once the entry is on a sales invoice; Moneybird then refuses updates to it. */
  sales_invoice_id?: string | null;
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
