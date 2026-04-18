// Archivist Chat Server - Production with Explicit KV
const kv = await Deno.openKv();
const channel = new BroadcastChannel("archivist-chat");

interface ChatMessage {
  type: "chat" | "system";
  username: string;
  message: string;
  timestamp: number;
}

const MESSAGES_KEY = ["archivist_messages"];

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
  
  channel.onmessage = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };
  
  socket.onopen = async () => {
    console.log("Client connected");
    const result = await kv.get<ChatMessage[]>(MESSAGES_KEY);
    const messages = result.value || [];
    const recent = messages.slice(-50);
    for (const msg of recent) {
      socket.send(JSON.stringify(msg));
    }
  };
  
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === "join") {
        username = data.username;
        
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
        
        channel.postMessage(JSON.stringify(joinMsg));
      }
      
      if (data.type === "chat" && username) {
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
        
        channel.postMessage(JSON.stringify(chatMsg));
      }
    } catch (e) {
      // Silent fail
    }
  };
  
  socket.onclose = () => {};
  socket.onerror = () => {};
  
  return response;
});
