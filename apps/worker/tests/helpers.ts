import http from "node:http";
import type { AddressInfo } from "node:net";

/** PNG mínimo válido (assinatura + IHDR 1x1): o downloader seguro lê as dimensões do cabeçalho. */
export const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
]);
export const pngResponse = () => new Response(PNG, { headers: { "content-type": "image/png" } });
/** Resolve qualquer host para um IP público de documentação (sem DNS real nos testes). */
export const publicResolve = async () => ["93.184.216.34"];

/** Servidor HTTP real que envia os cabeçalhos e depois estanca o corpo. */
export async function startStalledServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    if (req.url === "/image") {
      // cabeçalho de imagem válido e o corpo para no meio: só o timeout total salva o worker
      res.writeHead(200, { "content-type": "image/png" });
      res.write(PNG.subarray(0, 12));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"ok":');
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
