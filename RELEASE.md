# Release Instructions

## Manual Release

To create a release package manually:

```bash
# Install dependencies (only needed once)
npm install

# Create a release build
npm run release
```

This will:
1. Run the linter to check code quality
2. Build the TypeScript files
3. Validate the plugin structure
4. Create a `.streamDeckPlugin` file in the `dist` folder

The packaged plugin will be located at:
```
dist/com.johan-kuijt.moneybird-timer.streamDeckPlugin
```

## Automated Release (GitHub)

To create an automated release using GitHub Actions:

1. Update the version in `manifest.json` and `package.json`
2. Commit your changes
3. Create and push a version tag:

```bash
git tag v0.1.2
git push origin v0.1.2
```

This will trigger the GitHub Action that:
- Builds the plugin
- Creates a GitHub release
- Uploads the `.streamDeckPlugin` file as a release asset

## Version Numbering

The plugin uses semantic versioning: `MAJOR.MINOR.PATCH.BUILD`

- Update in `manifest.json` (Version field)
- Update in `package.json` (version field, without the build number)

## Distribution

After packaging, you can distribute the `.streamDeckPlugin` file:

1. **Direct installation**: Users can double-click the file
2. **Stream Deck Store**: Submit via Elgato's developer portal
3. **GitHub Releases**: Automatically created with the GitHub Action
4. **Manual distribution**: Share the file directly

## Testing the Package

Before releasing:

```bash
# Validate the plugin
streamdeck validate com.johan-kuijt.moneybird-timer.sdPlugin

# Install the plugin by double-clicking the file:
open dist/com.johan-kuijt.moneybird-timer.streamDeckPlugin

# Or drag and drop the .streamDeckPlugin file onto the Stream Deck application
```
