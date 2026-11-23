/**
 * The manifest as it goes into the packaged plugin.
 *
 * The manifest in the repo keeps `Nodejs.Debug` enabled, so a linked development copy can be
 * inspected. A packaged plugin must not open a debugger port on the user's machine, so the
 * package gets `Debug: "disabled"`. Nothing else changes.
 *
 * @param {string} manifestText The manifest.json from the repo.
 * @returns {string} The manifest.json for the package.
 */
export function releaseManifestText(manifestText) {
  const manifest = JSON.parse(manifestText);
  if (!manifest.Nodejs || typeof manifest.Nodejs !== 'object') {
    throw new Error('manifest.json has no Nodejs section to release');
  }
  return JSON.stringify(
    { ...manifest, Nodejs: { ...manifest.Nodejs, Debug: 'disabled' } },
    null,
    '\t'
  );
}
