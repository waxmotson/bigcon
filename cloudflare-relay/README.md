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
