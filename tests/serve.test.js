import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createSiteServer } from "../scripts/serve.mjs";

async function fixture(t, built = false) {
  const directory = await mkdtemp(join(tmpdir(), "dropzone-http-"));
  const root = join(directory, "site");
  const app = built ? "app-0123456789ab" : "src";
  const assets = built ? "assets-0123456789ab" : "public/assets";
  for (const path of [app, assets, ".git", "scripts", "tests"])
    await mkdir(join(root, path), { recursive: true });
  for (const [path, content] of [
    ["index.html", "<h1>Кейсы</h1>"],
    ["404.html", "<h1>Кейсы</h1>"],
    [app + "/main.js", "document.title = 'Кейсы';"],
    [assets + "/case.webp", "изображение"],
    [".env", "секрет"],
    [".git/config", "личные данные"],
    ["README.md", "служебный файл"],
    ["scripts/build.mjs", "служебный файл"],
    ["tests/example.js", "служебный файл"],
    ["_headers", "служебный файл"],
  ])
    await writeFile(join(root, path), content);
  await writeFile(join(directory, "private.js"), "личные данные");
  await symlink(join(directory, "private.js"), join(root, app, "outside.js"));
  await symlink(join(root, ".env"), join(root, app, "hidden.js"));
  const server = createSiteServer(root, built);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const get = (path, method = "GET") =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: server.address().port, path, method },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  return { get, app, root, assets: built ? assets : "assets" };
}

for (const built of [false, true]) {
  const mode = built ? "сборки" : "разработки";
  test(`Сервер ${mode} отдаёт интерфейс, ресурсы и заголовки приватности`, async (t) => {
    const { get, app, assets } = await fixture(t, built);
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.equal(page.body, "<h1>Кейсы</h1>");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.match(page.headers["content-security-policy"], /connect-src 'none'/);
    assert.equal((await get(`/${app}/main.js`)).status, 200);
    assert.equal((await get(`/${assets}/case.webp`)).status, 200);
    const head = await get("/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal((await get("/", "POST")).status, 405);
  });

  test(`Сервер ${mode} закрывает служебные файлы, обход путей и ссылки наружу`, async (t) => {
    const { get, app, root, assets } = await fixture(t, built);
    for (const path of [
      "/.env",
      "/.git/config",
      "/%2egit/config",
      "/README.md",
      "/scripts/build.mjs",
      "/tests/example.js",
      "/_headers",
      `/${app}/%2e%2e%2f.env`,
      `/${assets}/%2e%2e%2f%2e%2e%2f.env`,
      `/${app}/outside.js`,
      `/${app}/hidden.js`,
      `/${app}/%5c..%5c.env`,
      "/%E0%A4%A",
    ]) {
      const result = await get(path);
      assert.equal(result.status, 404, path);
      assert.equal(result.body.includes("личные данные"), false, path);
      assert.equal(result.body.includes("секрет"), false, path);
    }
    if (built) assert.equal((await get("/src/main.js")).status, 404);
    await unlink(join(root, "index.html"));
    await symlink(join(root, ".env"), join(root, "index.html"));
    assert.equal((await get("/")).status, 404);
  });
}
