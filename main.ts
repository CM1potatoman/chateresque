// Archivist Chat Server - Full Debug
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

Deno.serve({ port: 8080 }, (req) => {
  console.log("🌐 Incoming request:", req.url);
  
  const upgrade = req.headers.get("upgrade") || "";
  console.log("🔄 Upgrade header:", upgrade);
  
  if (upgrade.toLowerCase() !== "websocket") {
    console.log("❌ Not a WebSocket request");
    return new Response("Archivist Chat Server", { 
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
  
  console.log("✅ WebSocket upgrade");
  const { socket, response } = Deno.upgradeWebSocket(req);
  let username = "";
  
  channel.onmessage = (event) => {
    console.log("📨 Broadcast received:", event.data.substring(0, 50));
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };
  
  socket.onopen = async () => {
    console.log("🔌 WebSocket opened");
    try {
      console.log("📖 Reading KV...");
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
    console.log("💬 Message received:", event.data.substring(0, 100));
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "join") {
        username = data.username;
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
        
        channel.postMessage(JSON.stringify(joinMsg));
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
        
        channel.postMessage(JSON.stringify(chatMsg));
      }
    } catch (e) {
      console.error("❌ Parse error:", e);
    }
  };
  
  socket.onclose = () => {
    console.log(`👋 DISCONNECT: ${username || "Unknown"}`);
  };
  
  socket.onerror = (e) => {
    console.error("⚠️ WebSocket error:", e);
  };
  
  return response;
});
