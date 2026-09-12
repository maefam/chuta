// ちゅーた先生 サービスワーカー。
// 役割は起動の速さとオフラインでの立ち上がりだけ。アプリの静的ファイル（html/css/js/assets）を
// キャッシュし、取得は「まずネットワーク、だめならキャッシュ」にする。
// APIへの通信（api.anthropic.com / api.openai.com）は絶対にキャッシュしない。素通しさせる。

const CACHE_VERSION = "chuta-static-v2"; // バージョンを上げると activate で古いキャッシュを消す
const NO_CACHE_HOSTS = ["api.anthropic.com", "api.openai.com"];

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/state.js",
  "./js/ui/home.js",
  "./js/ui/camera.js",
  "./js/ui/chat.js",
  "./js/ui/handoff.js",
  "./js/ui/parent.js",
  "./js/ai/provider.js",
  "./js/ai/claude.js",
  "./js/ai/openai.js",
  "./js/ai/manual.js",
  "./js/ui/manual.js",
  "./js/ai/mock.js",
  "./js/ai/prompt.js",
  "./js/ai/schema.js",
  "./js/ai/errors.js",
  "./js/lib/store.js",
  "./js/lib/image.js",
  "./js/lib/answer.js",
  "./js/lib/furigana.js",
  "./js/lib/kanji.js",
  "./js/lib/voice.js",
  "./js/lib/usage.js",
  "./assets/chuta.js",
  "./assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // 1つのファイルが無くても（例：並行して作られているファイルがまだ無い等）
        // インストール全体を失敗させない。addAll は1つでも失敗すると全滅するため使わない。
        Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // API呼び出しはPOSTなので、ここで既にほぼ対象外になる

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // APIへの通信は絶対にキャッシュしない。respondWith を呼ばず、ブラウザの既定の取得に任せる。
  if (NO_CACHE_HOSTS.includes(url.hostname)) return;

  // 教え方のメモの正本（knowledge.md）もキャッシュしない。親がGitHubで編集してもすぐ効くように、
  // 常にネットワークから直接取りに行かせる（APIの通信と同じ扱い）。
  if (url.pathname.endsWith("/knowledge.md")) return;

  // 同一オリジンの静的ファイルだけを対象にする（フォントCDN等を将来足しても壊れないように）。
  if (url.origin !== self.location.origin) return;

  // ブラウザ自身の保存分をそのまま使うと、置き場のファイルを差し替えても古いままになる。
  // no-cache で毎回サーバに確かめさせる（変わっていなければ 304 が返るだけなので軽い）。
  event.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // ナビゲーション（画面遷移）だけは index.html で代替し、オフラインでも起動できるようにする
        if (req.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        return Response.error();
      })
  );
});
