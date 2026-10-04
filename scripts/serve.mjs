import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function createSiteServer(directory, built = false) {
  const root = resolve(directory);
  return createServer(async (req, res) => {
    const fail = (status) =>
      res.writeHead(status, headers).end("Не найдено");
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
        return;
      }
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const segments = path.split("/").filter(Boolean);
      if (segments.some((part) => part.startsWith(".")) || path.includes("\\")) {
        fail(404);
        return;
      }
      let base;
      let relative;
      if (path === "/" || path === "/index.html" || (built && path === "/404.html")) {
        base = root;
        relative = path === "/" ? "index.html" : path.slice(1);
      } else if (!built && path.startsWith("/src/")) {
        base = resolve(root, "src");
        relative = path.slice(5);
      } else if (!built && path.startsWith("/assets/")) {
        base = resolve(root, "public/assets");
        relative = path.slice(8);
      } else if (built && /^\/(?:app|assets)-[a-f0-9]{12}\//.test(path)) {
        base = resolve(root, segments[0]);
        relative = segments.slice(1).join("/");
      } else {
        fail(404);
        return;
      }
      const file = resolve(base, relative);
      const type = types[extname(file)];
      if (!type || !file.startsWith(base + sep)) {
        fail(404);
        return;
      }
      const [actualRoot, actualBase, actualFile] = await Promise.all([
        realpath(root),
        realpath(base),
        realpath(file),
      ]);
      if (
        (actualBase !== actualRoot && !actualBase.startsWith(actualRoot + sep)) ||
        !actualFile.startsWith(actualBase + sep) ||
        actualFile !== resolve(actualBase, relative) ||
        !(await stat(actualFile)).isFile()
      ) {
        fail(404);
        return;
      }
      const body = req.method === "HEAD" ? null : await readFile(actualFile);
      res.writeHead(200, { ...headers, "Content-Type": type });
      res.end(body);
    } catch {
      fail(404);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = process.argv.includes("--dist");
  createSiteServer(built ? "dist" : ".", built).listen(5173, "127.0.0.1", () =>
    console.log("Сайт: http://127.0.0.1:5173"),
  );
}
