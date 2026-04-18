// Archivist Chat Server - FIXED JSON CORRUPTION
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

// Store connected clients for direct broadcasting
const clients = new Map<string, WebSocket>();

Deno.serve({ port: 8080 }, (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Archivist Chat Server", { 
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
  
  const { socket, response } = Deno.upgradeWebSocket(req);
  let username = "";
  
  // Listen for broadcasts from other instances
  channel.onmessage = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        // Verify it's valid JSON before forwarding
        JSON.parse(event.data);
        socket.send(event.data);
      } catch (e) {
        console.error("Invalid JSON on channel:", event.data);
      }
    }
  };
  
  socket.onopen = async () => {
    console.log("🔌 WebSocket opened");
    try {
      const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
      const messages = result.value || [];
      console.log(`📜 Retrieved ${messages.length} messages`);
      
      const recent = messages.slice(-50);
      for (const msg of recent) {
        const jsonMsg = JSON.stringify(msg);
        socket.send(jsonMsg);
      }
      console.log(`📤 Sent ${recent.length} messages to client`);
    } catch (e) {
      console.error("❌ KV read error:", e);
    }
  };
  
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // Ignore ping messages
      if (data.type === "ping") {
        return;
      }
      
      if (data.type === "join") {
        username = data.username;
        clients.set(username, socket);
        console.log(`👋 JOIN: ${username}`);
        
        const joinMsg: ChatMessage = {
          type: "system",
          username: "Archivist",
          message: `${username} joins the archive`,
          timestamp: Date.now()
        };
        
        const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
        const messages = result.value || [];
        messages.push(joinMsg);
        await kv.set(MESSAGES_KEY, messages.slice(-200));
        console.log(`💾 Saved join. Total: ${messages.length}`);
        
        const jsonMsg = JSON.stringify(joinMsg);
        channel.postMessage(jsonMsg);
        
        // Also broadcast directly to ensure delivery
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
          timestamp: Date.now()
        };
        
        const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
        const messages = result.value || [];
        messages.push(chatMsg);
        await kv.set(MESSAGES_KEY, messages.slice(-200));
        console.log(`💾 Saved chat. Total: ${messages.length}`);
        
        const jsonMsg = JSON.stringify(chatMsg);
        channel.postMessage(jsonMsg);
        
        // Direct broadcast
        for (const [name, client] of clients.entries()) {
          if (name !== username && client.readyState === WebSocket.OPEN) {
            client.send(jsonMsg);
          }
        }
      }
    } catch (e) {
      console.error("❌ Parse error:", e);
    }
  };
  
  socket.onclose = () => {
    console.log(`👋 DISCONNECT: ${username || "Unknown"}`);
    if (username) {
      clients.delete(username);
    }
  };
  
  socket.onerror = (e) => {
    console.error("⚠️ WebSocket error:", e);
  };
  
  return response;
});
