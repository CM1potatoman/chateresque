// Archivist Chat Server - FIXED BROADCAST
console.log("🚀 ARCHIVIST CHAT SERVER STARTING - PRODUCTION");

const kv = await Deno.openKv();
console.log("✅ KV opened");

const channel = new BroadcastChannel("archivist-chat");
console.log("📡 BroadcastChannel created");

interface ChatMessage {
  type: "chat" | "system";
  username: string;
  message: string;
  timestamp: number;
}

const MESSAGES_KEY = ["archivist_messages"];

const clients = new Map<string, WebSocket>();

Deno.serve({ port: 8080 }, (req) => {
  const upgrade = req.headers.get("upgrade") || "";

  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Archivist Chat Server", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let username = "";

  // Each connection gets its own listener so onmessage reassignment
  // doesn't wipe out other clients' handlers
  const channelHandler = (event: MessageEvent) => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        JSON.parse(event.data); // validate before forwarding
        socket.send(event.data);
      } catch (e) {
        console.error("Invalid JSON on channel:", event.data);
      }
    }
  };

  channel.addEventListener("message", channelHandler);

  socket.onopen = async () => {
    console.log("🔌 WebSocket opened");
    try {
      const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
      const messages = result.value || [];
      console.log(`📜 Retrieved ${messages.length} messages`);

      const recent = messages.slice(-50);
      for (const msg of recent) {
        socket.send(JSON.stringify(msg));
      }
      console.log(`📤 Sent ${recent.length} messages to client`);
    } catch (e) {
      console.error("❌ KV read error:", e);
    }
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "ping") return;

      if (data.type === "join") {
        username = data.username;
        clients.set(username, socket);
        console.log(`👋 JOIN: ${username}`);

        const joinMsg: ChatMessage = {
          type: "system",
          username: "Archivist",
          message: `${username} joins the archive`,
          timestamp: Date.now(),
        };

        const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
        const messages = result.value || [];
        messages.push(joinMsg);
        await kv.set(MESSAGES_KEY, messages.slice(-200));
        console.log(`💾 Saved join. Total: ${messages.length}`);

        // Broadcast to all OTHER clients via channel (handles multi-instance)
        // and directly for reliability
        const jsonMsg = JSON.stringify(joinMsg);
        channel.postMessage(jsonMsg);

        for (const [name, client] of clients.entries()) {
          if (name !== username && client.readyState === WebSocket.OPEN) {
            client.send(jsonMsg);
          }
        }
      }

      if (data.type === "chat" && username) {
        console.log(`💬 CHAT: ${username}: ${data.message}`);

        const chatMsg: ChatMessage = {
          type: "chat",
          username: username,
          message: data.message,
          timestamp: Date.now(),
        };

        const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
        const messages = result.value || [];
        messages.push(chatMsg);
        await kv.set(MESSAGES_KEY, messages.slice(-200));
        console.log(`💾 Saved chat. Total: ${messages.length}`);

        const jsonMsg = JSON.stringify(chatMsg);
        channel.postMessage(jsonMsg);

        // Send to all clients INCLUDING sender so they see it on other devices/instances
        for (const [_, client] of clients.entries()) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(jsonMsg);
          }
        }
      }
    } catch (e) {
      console.error("❌ Parse error:", e);
    }
  };

  socket.onclose = () => {
    // Clean up this connection's channel listener
    channel.removeEventListener("message", channelHandler);
    console.log(`👋 DISCONNECT: ${username || "Unknown"}`);

    if (username) {
      clients.delete(username);

      const leaveMsg: ChatMessage = {
        type: "system",
        username: "Archivist",
        message: `${username} leaves the archive`,
        timestamp: Date.now(),
      };

      // Fire and forget - save disconnect message and notify others
      (async () => {
        try {
          const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
          const messages = result.value || [];
          messages.push(leaveMsg);
          await kv.set(MESSAGES_KEY, messages.slice(-200));

          const jsonMsg = JSON.stringify(leaveMsg);
          channel.postMessage(jsonMsg);

          for (const [_, client] of clients.entries()) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(jsonMsg);
            }
          }
        } catch (e) {
          console.error("❌ Disconnect save error:", e);
        }
      })();
    }
  };

  socket.onerror = (e) => {
    console.error("⚠️ WebSocket error:", e);
  };

  return response;
});
