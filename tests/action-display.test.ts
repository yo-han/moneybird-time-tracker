import assert from 'node:assert/strict';
import test from 'node:test';
import {
  setActionDisplay,
  setConfigNeededDisplay,
  setErrorDisplay,
} from '../src/utils/action-display.js';

function createAction() {
  const state = {
    title: '',
    image: '',
  };

  return {
    state,
    action: {
      async setTitle(title: string) {
        state.title = title;
      },
      async setImage(image: string) {
        state.image = image;
      },
    },
  };
}

test('setActionDisplay sets title and image', async () => {
  const { state, action } = createAction();
  await setActionDisplay(action, 'Running', 'img/active.png');

  assert.equal(state.title, 'Running');
  assert.equal(state.image, 'img/active.png');
});

test('setConfigNeededDisplay sets config title and default image', async () => {
  const { state, action } = createAction();
  await setConfigNeededDisplay(action, 'img/default.png');

  assert.equal(state.title, 'Config needed');
  assert.equal(state.image, 'img/default.png');
});

test('setErrorDisplay sets error title and error image', async () => {
  const { state, action } = createAction();
  await setErrorDisplay(action, 'img/error.png');

  assert.equal(state.title, 'Error');
  assert.equal(state.image, 'img/error.png');
});
