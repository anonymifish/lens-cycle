import { createInterface } from "node:readline";

const port = process.env.CDP_PORT ?? "9333";
const [target] = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
if (!target?.webSocketDebuggerUrl) throw new Error("Lens Cycle WebView target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve } = pending.get(message.id);
  pending.delete(message.id);
  resolve(message);
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
await send("Page.enable");
console.log(`@@READY ${target.title} ${target.url}`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    const result = await send(request.method, request.params ?? {});
    console.log(`@@RESULT ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`@@ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
}

socket.close();
