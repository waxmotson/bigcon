# THE BIG CON — Cloudflare relay

This Worker provides the WebSocket relay backed by one Durable Object per room. It also handles Discord Activity OAuth and channel notifications.

## Deploy

From this directory:

```sh
npm install --save-dev wrangler
npx wrangler login
npx wrangler deploy
```

**Important:** `wrangler.jsonc` names this Worker `bigconhosting`. This must match the Discord Developer Portal's `/relay` URL mapping to `https://bigconhosting.wax-no-bones.workers.dev`. Do not rename the Worker unless you also update that mapping.

The game uses this Worker URL automatically. No API token should be placed in the game page.

## Cloudflare secrets

Configure both secrets on the `bigconhosting` Worker from this directory:

```sh
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler deploy
```

The OAuth2 client secret is used to exchange Embedded App SDK authorisation codes. The bot token is used server-side to post messages. Neither secret belongs in the game page or repository.

## Discord bot setup

Create the bot under the **existing Big Con Discord application**, invite it to the server with the `bot` scope, and grant it `Send Messages` in the channel where the Activity runs.

The Activity host sends one turn announcement when the active player changes and one final standings announcement when the game ends. The Worker validates the Activity user's OAuth token before using the bot token.

## Relay behaviour

- One Durable Object coordinates each room and relays JSON data messages between the host and guests.
- Rooms support up to eight concurrent sockets.
- Host-authoritative game rules and game state remain in the game client.
- `/health` returns a simple service health response.
- If the relay is unavailable, select **PeerJS / WebRTC fallback** in Connection system settings. Everyone in the same room must use the same transport.

## Important limitations

This is a transport relay, not a game-state database or host-migration system. The host remains authoritative. If the host browser closes or loses its connection permanently, the relay does not elect a new host. Cloudflare account limits and usage charges may apply.
