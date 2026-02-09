import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapAdministrations,
  mapContacts,
  mapProjects,
  mapUsers,
} from '../src/services/moneybird/response-mappers.js';

test('mapAdministrations maps API records', () => {
  const result = mapAdministrations([{ id: 'a1', name: 'Main' }]);
  assert.deepEqual(result, [{ id: 'a1', name: 'Main' }]);
});

test('mapUsers applies fallback email', () => {
  const result = mapUsers([{ id: 'u1', name: 'Jane' }]);
  assert.deepEqual(result, [{ id: 'u1', name: 'Jane', email: 'No email' }]);
});

test('mapProjects maps project records', () => {
  const result = mapProjects([{ id: 'p1', name: 'Project A' }]);
  assert.deepEqual(result, [{ id: 'p1', name: 'Project A' }]);
});

test('mapContacts applies default fields', () => {
  const result = mapContacts([{ id: 'c1' }]);
  assert.deepEqual(result, [
    { id: 'c1', company_name: '', firstname: '', lastname: '' },
  ]);
});
