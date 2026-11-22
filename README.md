# Moneybird Time Tracker Stream Deck Plugin

A Stream Deck plugin for time tracking and invoicing with Moneybird.  
Track time, create invoices, and monitor billable hours directly from your Stream Deck.

## Overview

The plugin includes three actions:

1. `Time Tracker`
- Start and stop a Moneybird time entry
- Real-time elapsed time on the key
- Optional auto-stop timer
- Clear visual key states for idle, active, and error

2. `Invoice Creator`
- Create an invoice for a selected customer and period
- Supports month, quarter, and year periods
- Long-press to toggle current vs. previous period
- Optional workflow and hourly rate

3. `Invoice Summary`
- Live overview of hours and optional amount for a selected customer
- Auto-refresh every 30 seconds
- Manual refresh on key press

## Requirements

- Elgato Stream Deck
- Moneybird account with API access
- Moneybird personal API token
- Node.js `24.x` for local development

## Installation

### Recommended (Release Artifact)

1. Download the latest `.streamDeckPlugin` from [Releases](https://github.com/yo-han/moneybird-time-tracker/releases).
2. Double-click the downloaded file.
3. Stream Deck installs the plugin automatically.

### Manual

1. Download the `.streamDeckPlugin` file.
2. Open Stream Deck.
3. Go to Plugins.
4. Click `Install Plugin`.
5. Select the downloaded file.

## Configuration

### Create a Moneybird API Token

1. Sign in to Moneybird.
2. Open `Settings` -> `Developers`.
3. Go to `Personal API tokens`.
4. Create a token with at least:
- Sales invoices
- Time entries
- Contacts
5. Copy the token.

### API Token for All Keys

The API token is entered once and shared by every key of this plugin. Paste it into the
`API Key` field of any key; the plugin checks it with Moneybird before saving it, and shows an
error under the field when Moneybird rejects it. Rotating the token there updates all keys.

The administration you pick last is preselected for the next key you add. Each key can still
choose another administration.

For a key that should use another Moneybird account, tick `Use a different API key for this
key` and enter that token. Untick it to go back to the shared token.

Keys configured before this version keep working: the first token found becomes the shared
token, and keys with the same token switch to it. Keys with a different token keep it as their
own. A key that still carries that first token follows the shared token later, also after you
replaced it.

Stop running timers before you switch the shared token to another Moneybird account. A timer
key whose property inspector is open refuses a token that cannot reach its running entry, but
timers on other keys are stopped with the new token, which cannot reach an entry in the old
account.

### Configure Actions in Stream Deck

`Time Tracker`
1. Add `Time Tracker` to a key.
2. Set API token (once for all keys) and administration.
3. Select project and user.
4. Optional: default description, billable flag, auto-stop settings.

`Invoice Creator`
1. Add `Invoice Creator` to a key.
2. Set API token (once for all keys) and administration.
3. Select customer/contact.
4. Configure hourly rate and period.
5. Optional: custom title and workflow.

`Invoice Summary`
1. Add `Invoice Summary` to a key.
2. Set API token (once for all keys) and administration.
3. Select customer/contact.
4. Configure period and optional hourly rate.
5. Optional: custom title.

## Usage

`Time Tracker`
- Single press: start/stop timer
- Key shows elapsed time while running (`42s`, `17m`, `1h05`)
- If stopping fails, the timer keeps running so the next press can retry
- Auto-stop ends the entry at the configured limit, also when the computer was asleep

`Invoice Creator`
- Single press: create invoice for current selection
- Only billable hours that are not on an invoice yet are invoiced, so pressing twice never bills the same hours twice
- Long press (`0.5s`): toggle current/previous period
- Status messages: `Creating...`, `Created`, `No hours`, `Error`
- `Created` + `Check hours`: the invoice exists, but some hours could not be linked to it; check them in Moneybird before invoicing again

`Invoice Summary`
- Displays e.g. `Title\nX.Xh = €YYY`
- Auto-refresh every 30 seconds
- Single press: force refresh

## Development

### Setup

1. Clone this repository.
2. Install dependencies:
```bash
npm install
```
3. Run checks:
```bash
npm run lint
npm run typecheck
npm run test
```

### Scripts

- `npm run watch` -> watch build and restart plugin (local development)
- `npm run build` -> production build
- `npm run package` -> package `.streamDeckPlugin`
- `npm run release` -> lint + typecheck + test + build + package

`com.johan-kuijt.moneybird-timer.sdPlugin/bin/` is build output and is not committed; run `npm run build` (or `npm run watch`) before linking the plugin locally.

## Troubleshooting

`API token does not work`
- Verify token permissions.
- Verify token is still active.
- Validate against the Moneybird API directly.

`No projects or contacts are shown`
- Check internet connection.
- Confirm selected administration.
- Verify records exist and are active in Moneybird.

`Invoice creation fails`
- Verify there are billable entries in the selected period.
- Verify workflow exists (if configured).
- Confirm contact can be invoiced.

## Security Notes

- Keep your API token private.
- Do not commit local settings or secrets.
- Review logs before sharing them externally.

## Disclaimer

This plugin is an independent community project and is not officially supported by Moneybird B.V.

- Not an official Moneybird product
- Moneybird is a registered trademark of Moneybird B.V.
- Use at your own risk

## License

MIT. See `LICENSE`.

## Support

- Open an issue: [GitHub Issues](https://github.com/yo-han/moneybird-time-tracker/issues)
- Stream Deck docs: [Elgato Developer Docs](https://docs.elgato.com/streamdeck)
- Moneybird API docs: [Moneybird Developer Docs](https://developer.moneybird.com/)
