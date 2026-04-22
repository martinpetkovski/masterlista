# Discord Bot

This package provides a Discord slash-command workflow for MMM artist and event drafts, backed by a local per-user draft store and the existing Cloudflare PR worker.

## What it does

- Stores pending drafts locally by Discord user id in `discord-bot/data/drafts.json`.
- Mirrors the MMM draft shape used by the site: `data`, `original`, `savedAt`, and optional `additionalFiles` per logical file.
- Opens Discord modals for artist and event edits, then saves those changes into `bands.json` and `events.json` draft payloads.
- Submits pending drafts to the existing PR worker with the same `files[]` request contract used by `scripts/site/mmm-drafts.js`.

## Setup

1. Install dependencies:

```bash
npm install --prefix discord-bot
```

2. Copy `discord-bot/.env.example` to `discord-bot/.env` and fill in the Discord values.

3. Register commands:

```bash
npm run register --prefix discord-bot
```

4. Start the bot:

```bash
npm start --prefix discord-bot
```

## Environment

- `DISCORD_BOT_TOKEN`: bot token.
- `DISCORD_APPLICATION_ID`: Discord application id.
- `DISCORD_GUILD_ID`: optional guild id for guild-scoped command registration.
- `DISCORD_ALLOWED_ROLE_IDS`: optional comma-separated role ids allowed to use the commands.
- `DISCORD_TOS_URL`: public Terms of Service URL for the Discord application.
- `DISCORD_PRIVACY_POLICY_URL`: public Privacy Policy URL for the Discord application.
- `DISCORD_SUPPORT_SERVER_URL`: support/community server URL.
- `DISCORD_OAUTH2_SCOPES`: install scopes used for the invite link.
- `DISCORD_OAUTH2_PERMISSIONS`: install permissions integer used for the invite link.
- `DISCORD_BOT_INVITE_URL`: generated install URL for the current application id.
- `DISCORD_CLIENT_SECRET`: optional, only needed if we later add OAuth flows.
- `DISCORD_PUBLIC_KEY`: optional, only needed if we later verify interaction webhooks outside the bot gateway flow.
- `MMM_PR_ENDPOINT`: PR worker endpoint.
- `DISCORD_DRAFT_STORE_PATH`: optional local draft store path. Defaults to `discord-bot/data/drafts.json`.
- `MASTERLISTA_REPO_ROOT`: optional repo root override. Defaults to the parent of `discord-bot`.

## Finding Discord IDs

- `DISCORD_BOT_TOKEN`
  Open Discord Developer Portal, go to Applications, open this app, then open the Bot tab. Use Reset Token or Copy Token.
  Treat it like a password.

- `DISCORD_APPLICATION_ID`
  Open Discord Developer Portal, go to Applications, open this app, then General Information. Copy Application ID.

- `DISCORD_GUILD_ID`
  In Discord, enable Developer Mode in User Settings -> Advanced.
  Then right-click the target server and click Copy Server ID.

- `DISCORD_ALLOWED_ROLE_IDS`
  In Discord, enable Developer Mode in User Settings -> Advanced.
  Then right-click each role you want to allow and click Copy Role ID.
  Put them in `.env` as a comma-separated list.
  If you want the bot open to everyone in the guild, leave this blank.

## Commands

- `/artist add`
  Opens a modal for artist name, city, genres, contact, and links.
  Artist name, city, and genres are required.
  Optional slash options: `verified`, `accent_one`, `accent_two`.

- `/artist edit artist:<name-or-slug>`
  Opens the same modal prefilled from the current working draft state.
  Optional slash options behave the same as `/artist add`.

- `/artist delete artist:<name-or-slug>`
  Removes an artist from your pending drafts.
  The artist option autocompletes from the current artist JSON data.

- `/event add artists:<comma-separated-artists> [tickets]`
  Collects optional artists and optional tickets in the slash command, then opens a modal for event name, date, time, place, and links.
  Event name, date, and time are required. Artists, place, tickets, and links are optional.
  The artists option autocompletes from the current artist JSON data.
  `tickets` format: `label|price`, one per line or `;` separated.

- `/event edit event:<id-or-title> [artists] [tickets]`
  Opens the same modal prefilled from the current working draft state.
  `artists` is optional; omit it to keep the current artists, or pass `clear` to remove them.
  `tickets` is optional; omit it to keep the current tickets, or pass `clear` to remove them.
  The event and artists options autocomplete from the current JSON data.

- `/event delete event:<id-or-title>`
  Removes an event from your pending drafts.
  The event option autocompletes from the current event JSON data.

- `/drafts`
  Shows the pending draft summary for the current Discord user.

- `/submit [description]`
  Submits the current user’s pending drafts to the PR worker.
  If `description` is omitted, the bot auto-generates one from the draft diffs.

## Link Formats

- Artist links modal: one URL per line.
  The bot detects the platform from the URL automatically.
  Example: `https://open.spotify.com/artist/...`

- Event links modal: one URL per line.
  The bot detects the platform from the URL automatically.
  Example: `https://www.instagram.com/p/...`

## Notes

- Event validation uses the effective artist list, so an artist added in your pending drafts can immediately be referenced by a new event draft.
- Successful `/submit` clears the current user’s local drafts, matching the site flow.