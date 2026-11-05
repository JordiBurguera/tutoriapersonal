import { WebSocket, WebSocketServer } from 'ws';

const HEARTBEAT_MS = 30_000;

// Avisos en tiempo real. El mensaje no lleva datos: solo indica a cada cliente que vuelva a
// pedir su vista a la API, que es la que aplica los permisos.
export function createLive() {
  const wss = new WebSocketServer({ noServer: true });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.ping();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    broadcast() {
      for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send('changed');
    },
    attach(server, userFromCookie) {
      server.on('upgrade', (req, socket, head) => {
        if (req.url !== '/ws' || !userFromCookie(req.headers.cookie)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
