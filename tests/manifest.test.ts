import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const MANIFEST_PATH = 'com.johan-kuijt.moneybird-timer.sdPlugin/manifest.json';
const SDK_DIST = 'node_modules/@elgato/streamdeck/dist/plugin';

/** Matches `requiresVersion(7.1, connection.version, "feature")` in the SDK's build. */
const REQUIRES_VERSION =
  /requiresVersion\(\s*(\d+(?:\.\d+)?)\s*,\s*connection\.version\s*,\s*"([^"]+)"/g;

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return javascriptFiles(entryPath);
    }
    return entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function parseVersion(version: string): [number, number] {
  const [major, minor = '0'] = version.split('.');
  return [Number(major), Number(minor)];
}

function isAtLeast(actual: [number, number], required: [number, number]): boolean {
  return actual[0] > required[0] || (actual[0] === required[0] && actual[1] >= required[1]);
}

test('the manifest minimum Stream Deck version covers every version the SDK requires', () => {
  // The SDK throws at connect when Software.MinimumVersion is lower than a feature it uses
  // by default (since @elgato/streamdeck 3: the settings behavior needs 7.1), and the
  // plugin then crashes on every start without showing anything on its keys.
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    Software: { MinimumVersion: string };
  };
  const minimumVersion = parseVersion(manifest.Software.MinimumVersion);

  const requirements = javascriptFiles(SDK_DIST).flatMap(file =>
    Array.from(readFileSync(file, 'utf8').matchAll(REQUIRES_VERSION), match => ({
      version: match[1],
      feature: match[2],
    }))
  );
  assert.ok(requirements.length > 0, `no requiresVersion calls found in ${SDK_DIST}`);
  assert.ok(
    requirements.some(requirement => requirement.feature.includes('onDidReceiveSettings')),
    'the settings behavior requirement was not found; the pattern no longer matches the SDK'
  );

  const unmet = requirements.filter(
    requirement => !isAtLeast(minimumVersion, parseVersion(requirement.version))
  );
  assert.deepEqual(
    unmet,
    [],
    `Software.MinimumVersion ${manifest.Software.MinimumVersion} is below what the SDK requires`
  );
});
