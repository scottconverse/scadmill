import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.env.SCADMILL_STATIC_ROOT || "dist");
const port = Number(process.env.SCADMILL_STATIC_PORT || 4175);
const rawBase = process.env.SCADMILL_STATIC_BASE_PATH?.trim() || "/";
const basePath = `/${rawBase.replace(/^\/+|\/+$/gu, "")}/`.replace(/^\/\/$/u, "/");
const rootPrefix = `${root}${sep}`;

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
});

function send(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://static.invalid").pathname);
  } catch {
    send(response, 400, "Invalid URL");
    return;
  }
  if (!pathname.startsWith(basePath)) {
    send(response, 404, "Not found");
    return;
  }
  const relativePath = pathname.slice(basePath.length) || "index.html";
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    send(response, 404, "Not found");
    return;
  }
  try {
    if (!statSync(candidate).isFile()) throw new Error("not a file");
  } catch {
    send(response, 404, "Not found");
    return;
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": CONTENT_TYPES[extname(candidate)] || "application/octet-stream",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(candidate).pipe(response);
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`ScadMill static evidence server: http://127.0.0.1:${port}${basePath}\n`);
});
