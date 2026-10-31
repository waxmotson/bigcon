# THE BIG CON — Cloudflare relay

This optional Worker provides a WebSocket relay backed by one Durable Object per room. It is an alternative to the existing PeerJS/WebRTC connection path, not a replacement for the game's host-authoritative game logic.

## Deploy

1. Install a current Node.js LTS release and Wrangler.
2. From this directory run:
   \`\`\`sh
   npm install --save-dev wrangler
   npx wrangler login
   npx wrangler deploy
   \`\`\`
3. Copy the deployed HTTPS \`workers.dev\` URL (for example, \`https://bigcon-relay.<your-subdomain>.workers.dev\`).
4. The Big Con game has this Worker URL built in: `https://bigconhosting.wax-no-bones.workers.dev`. Open the game and host/join as usual; no URL needs to be pasted. Cloudflare relay is the default. If the relay is unavailable, select **PeerJS / WebRTC fallback** in Connection system settings. Everyone in the same room must use the same transport.

No API token should be placed in the game page.

## What it does

- One Durable Object coordinates each room and relays JSON data messages between the host and guests.
- The room is limited to eight concurrent sockets, matching the game's current maximum player count.
- WebSocket Hibernation keeps idle server-side sockets connected without keeping the object resident in memory.
- Host-authoritative rules, reconnect identity, seat handling, and game state remain in the existing game code.
- \`/health\` returns a simple service health response.

## Important limitations

This is a transport relay, not a game-state database or host-migration system. The host remains authoritative. If the host browser closes or loses its connection permanently, the game still needs the host's existing reconnect/recovery behaviour; the relay does not elect a new host. WebSocket connections can still be interrupted by network changes, and the client retry logic remains responsible for reconnecting.

Test with two browsers first, then test lobby chat, character selection, starting a game, private prompts, event announcements, reconnects, and 8-player rooms. The Worker must be deployed before selecting Cloudflare mode. Cloudflare account limits and usage charges may apply.


## Discord Activity Rich Presence OAuth

The Worker also exchanges Embedded App SDK authorisation codes for Discord access tokens at `POST /api/token`. The Activity calls this through its configured `/relay` URL mapping.

Before deploying, add the Discord application's OAuth2 redirect URI `https://127.0.0.1` in the Developer Portal (the Embedded App SDK handles returning to the Activity). Then configure the application client secret as a Cloudflare Worker secret:

```sh
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler deploy
```

Paste the application's **OAuth2 Client Secret** into Wrangler's secure prompt; do not commit it or put it in the game page. The Worker uses the fixed Big Con application client ID and exchanges codes against Discord's OAuth2 token endpoint. The browser receives only the short-lived access token needed to authenticate the Embedded App SDK.

Discord may restrict `rpc.activities.write` to approved applications. A successful code exchange does not itself grant that scope; if Discord rejects the scope, Big Con must request the relevant access from Discord.


## Discord channel notifications

Turn and game-end announcements are sent to the text channel in which the Activity is running. The Activity host sends one turn notice when the active player changes and one final standings message when the game ends. The Worker validates the caller's Discord OAuth access token and uses the bot token only on the server; neither token is embedded in the page.

After creating a bot on the **existing Big Con Discord application**, invite it to the server with the `bot` scope and `Send Messages` permission. Then, from `cloudflare-relay/`, configure the bot token as a Worker secret:

```sh
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler deploy
```

The bot must have permission to send messages in the channel where the Activity is launched. If the secret is not configured, channel notifications stay disabled and the game itself continues to work. The existing `DISCORD_CLIENT_SECRET` OAuth secret remains required for Activity authentication.
