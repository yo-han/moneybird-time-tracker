import type {
  MoneybirdAdministration,
  MoneybirdContact,
  MoneybirdProject,
  MoneybirdUser,
} from '../../types/moneybird.js';

export function mapAdministrations(
  administrations: Array<{ id: string; name: string }>
): MoneybirdAdministration[] {
  return administrations.map(administration => ({
    id: administration.id,
    name: administration.name,
  }));
}

export function mapUsers(
  users: Array<{ id: string; name: string; email?: string }>
): MoneybirdUser[] {
  return users.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email || 'No email',
  }));
}

export function mapProjects(projects: Array<{ id: string; name: string }>): MoneybirdProject[] {
  return projects.map(project => ({
    id: project.id,
    name: project.name,
  }));
}

export function mapContacts(
  contacts: Array<{
    id: string;
    company_name?: string;
    firstname?: string;
    lastname?: string;
  }>
): MoneybirdContact[] {
  return contacts.map(contact => ({
    id: contact.id,
    company_name: contact.company_name || '',
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
  }));
}
