// 教え方のメモ（ナレッジ）の正本 ./knowledge.md を読み込み、端末内のメモとつなぐ。
// 正本は親がGitHubの画面で編集する読み取り専用ファイル。アプリからは書き戻さない。

const CACHE_KEY = "chuta.knowledge.remote";

// 正本を取りに行く。取れたら控え（localStorage）を更新して返す。
// 取れなければ控えを返し、控えも無ければ空文字を返す。呼び出し側でエラーを気にする必要はない。
// => {text, from:'network'|'cache'|'none', fetchedAt: number|null}
export async function loadRemote() {
  try {
    const res = await fetch("./knowledge.md", { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const fetchedAt = Date.now();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ text, fetchedAt }));
    } catch {
      // 控えが保存できなくても、取得できたこと自体は成功として扱う
    }
    return { text, from: "network", fetchedAt };
  } catch {
    const cached = cachedRemote();
    if (cached) return { text: cached.text, from: "cache", fetchedAt: cached.fetchedAt };
    return { text: "", from: "none", fetchedAt: null };
  }
}

// localStorage に控えてある前回分。無ければ null。
// => {text, fetchedAt} | null
export function cachedRemote() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (raw && typeof raw.text === "string") return raw;
  } catch {
    // 壊れていたら控えが無いものとして扱う
  }
  return null;
}

// 正本と端末のメモをつないでAIに渡す1つの文字列にする。
// どちらかが空なら残ったほうだけを返す。両方あれば、端末側に見出しを付けて間に1行あける。
export function combine(remoteText, localText) {
  const remote = (remoteText || "").trim();
  const local = (localText || "").trim();
  if (!remote) return local;
  if (!local) return remote;
  return `${remote}\n\n# この端末でのメモ\n\n${local}`;
}
