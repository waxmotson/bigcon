import { DurableObject } from "cloudflare:workers";

const MAX_CONNECTIONS = 8;
const ROOM_RE = /^[A-Z0-9-]{1,40}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Discord Embedded App SDK OAuth code exchange. Keep the client secret
    // in a Worker secret; never send it to the Activity/browser.
    if (url.pathname === "/api/token") {
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
      };
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
      }
      if (!env.DISCORD_CLIENT_SECRET) {
        return Response.json({ error: "Discord OAuth is not configured on the relay." }, { status: 503, headers: cors });
      }
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 8192) throw new Error("Request too large");
        body = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Invalid request body." }, { status: 400, headers: cors });
      }
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (!code || code.length > 2048) {
        return Response.json({ error: "A valid Discord authorisation code is required." }, { status: 400, headers: cors });
      }

      const form = new URLSearchParams({
        client_id: "1565709969913815060",
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://127.0.0.1",
      });
      let discordResponse;
      try {
        discordResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
      } catch {
        return Response.json({ error: "Could not contact Discord OAuth." }, { status: 502, headers: cors });
      }
      const tokenData = await discordResponse.json().catch(() => ({}));
      if (!discordResponse.ok || !tokenData.access_token) {
        return Response.json({
          error: "Discord rejected the authorisation code.",
          detail: tokenData.error_description || tokenData.error || "OAuth token exchange failed.",
        }, { status: 401, headers: cors });
      }
      return Response.json({ access_token: tokenData.access_token }, { headers: cors });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "bigcon-relay" });
    }
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!match) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    let room;
    try { room = decodeURIComponent(match[1]).toUpperCase(); } catch { room = ""; }
    if (!ROOM_RE.test(room)) return new Response("Invalid room code", { status: 400 });
    const role = url.searchParams.get("role");
    if (role !== "host" && role !== "guest") {
      return new Response("role must be host or guest", { status: 400 });
    }
    const id = env.BIGCON_ROOMS.idFromName(room);
    return env.BIGCON_ROOMS.get(id).fetch(request);
  },
};

export class BigConRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.setWebSocketAutoResponse?.(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  sockets(role) {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment();
      return a?.role === role && ws.readyState === WebSocket.OPEN;
    });
  }

  send(ws, payload) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const hosts = this.sockets("host");
    if (role === "host" && hosts.length) {
      return new Response("Room already has a host", { status: 409 });
    }
    if (role === "guest" && !hosts.length) {
      return new Response("Room host is not connected", { status: 404 });
    }
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return new Response("Room is full", { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, role, joined: false });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let msg;
    try {
      if (typeof raw !== "string" || raw.length > 256_000) {
        ws.close(1009, "Message too large");
        return;
      }
      msg = JSON.parse(raw);
    } catch {
      this.send(ws, { type: "error", code: "bad-message", message: "Invalid JSON" });
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!attachment) return;

    if (msg.type === "join") {
      if (attachment.joined) return;
      const hosts = this.sockets("host");
      if (attachment.role === "guest" && !hosts.length) {
        this.send(ws, { type: "error", code: "peer-unavailable", message: "Room host is not connected" });
        ws.close(1013, "Host unavailable");
        return;
      }
      attachment.joined = true;
      ws.serializeAttachment(attachment);

      if (attachment.role === "host") {
        this.send(ws, { type: "ready", id: attachment.id });
        // Preserve guest sockets across a host transport reconnect. Re-announce
        // each guest so the host can rebuild its per-player connection objects.
        for (const guest of this.sockets("guest")) {
          const a = guest.deserializeAttachment();
          if (a?.joined) {
            this.send(ws, { type: "incoming", id: a.id });
            this.send(guest, { type: "host_back" });
          }
        }
      } else {
        const host = this.sockets("host")[0];
        if (!host) {
          this.send(ws, { type: "error", code: "peer-unavailable", message: "Room host is not connected" });
          ws.close(1013, "Host unavailable");
          return;
        }
        this.send(ws, { type: "ready", id: attachment.id });
        this.send(host, { type: "incoming", id: attachment.id });
      }
      return;
    }

    if (!attachment.joined) return;
    if (msg.type === "data") {
      const target = msg.target;
      const recipient = attachment.role === "guest"
        ? this.sockets("host")[0]
        : this.sockets("guest").find((candidate) => candidate.deserializeAttachment()?.id === target);
      if (recipient) this.send(recipient, {
        type: "data",
        source: attachment.role === "guest" ? attachment.id : undefined,
        data: msg.data,
      });
      return;
    }

    if (msg.type === "leave" && attachment.role === "host") {
      const guest = this.sockets("guest").find((candidate) => candidate.deserializeAttachment()?.id === msg.target);
      if (guest) guest.close(1000, "Host closed connection");
    }
  }

  webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment();
    if (!attachment) return;
    if (attachment.role === "host") {
      // Guests can remain connected during the host's reconnect backoff.
      for (const guest of this.sockets("guest")) this.send(guest, { type: "host_lost" });
    } else {
      for (const host of this.sockets("host")) this.send(host, { type: "left", id: attachment.id });
    }
  }

  webSocketError(ws) {
    try { ws.close(1011, "Relay socket error"); } catch {}
  }
}
