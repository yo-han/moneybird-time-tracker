import assert from 'node:assert/strict';
import test from 'node:test';
import { isKeyActionEvent } from '../src/utils/key-action.js';

test('isKeyActionEvent returns true when the action is a key action', () => {
  assert.equal(isKeyActionEvent({ action: { isKey: () => true } }), true);
});

test('isKeyActionEvent returns false for dial and Neo infobar actions', () => {
  assert.equal(isKeyActionEvent({ action: { isKey: () => false } }), false);
});
