// 設定は localStorage、セッション（会話ログ・画像）は IndexedDB に保存する。

const SETTINGS_KEY = "chuta.settings";
const SUGGESTIONS_KEY = "chuta.suggestions";
const DB_NAME = "chuta";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

const DEFAULT_SETTINGS = {
  provider: "mock",
  claudeKey: "",
  openaiKey: "",
  claudeModel: "claude-opus-5",
  openaiModel: "gpt-5.6-terra",
  effort: "medium",
  grade: "小5",
  pin: "0000",
  dailyLimit: 3,
  turnLimit: 30,
  knowledge: "",
  otherInputPrice: 0,
  otherOutputPrice: 0,
  usdJpy: 150,
  voiceFallback: false,
  dailyYen: 0,
};

export const Settings = {
  // 既定値を埋めた設定オブジェクトを返す
  load() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
      stored = {};
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  },
  // 部分更新
  save(partial) {
    const merged = { ...Settings.load(), ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  },
};

// 未承認の「ちゅーた先生からの提案」（ナレッジへの追記案）。Settings と同じく localStorage に持つ。
function loadSuggestions() {
  try {
    const arr = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSuggestions(list) {
  localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(list));
}

export const Suggestions = {
  // => [{id, sessionId, text, createdAt}] 新しい順
  list() {
    return loadSuggestions().sort((a, b) => b.createdAt - a.createdAt);
  },
  // 提案を1件足す
  add(sessionId, text) {
    const item = { id: newId(), sessionId, text, createdAt: Date.now() };
    const list = loadSuggestions();
    list.push(item);
    saveSuggestions(list);
    return item;
  },
  // 提案を1件消す（「入れる」「いらない」どちらでも消す）
  remove(id) {
    saveSuggestions(loadSuggestions().filter((s) => s.id !== id));
  },
};

// ---- IndexedDB を Promise でくるむ小さなヘルパ ----

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  try {
    const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    return await fn(store);
  } finally {
    db.close();
  }
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

export const Sessions = {
  // => sessionId
  async create() {
    const id = newId();
    const record = {
      id,
      entries: [],
      meta: {
        phase: "S1",
        hintLevel: 0,
        notes: null,
        endedAt: null,
        summary: null,
        stuckTurns: 0,
        errorStreak: 0,
        practiceDone: 0,
        practiceTotal: 0,
        handoff: null,
        handoffAt: null,
      },
      createdAt: Date.now(),
    };
    await withStore("readwrite", (store) => reqToPromise(store.add(record)));
    return id;
  },

  // entry: {who:'child'|'chuta', text, image?:Blob, ts:number}
  async append(id, entry) {
    await withStore("readwrite", async (store) => {
      const record = await reqToPromise(store.get(id));
      if (!record) return;
      record.entries.push({ ts: Date.now(), ...entry });
      await reqToPromise(store.put(record));
    });
  },

  // {phase, hintLevel, notes, endedAt, summary}
  async setMeta(id, patch) {
    await withStore("readwrite", async (store) => {
      const record = await reqToPromise(store.get(id));
      if (!record) return;
      record.meta = { ...record.meta, ...patch };
      await reqToPromise(store.put(record));
    });
  },

  // => {id, entries:[...], meta:{...}, createdAt}
  async get(id) {
    return withStore("readonly", (store) => reqToPromise(store.get(id)));
  },

  // => [{id, createdAt, meta}] 新しい順
  async list() {
    const all = await withStore("readonly", (store) => reqToPromise(store.getAll()));
    return all
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, createdAt, meta }) => ({ id, createdAt, meta }));
  },

  // 中断したまま2週間たったセッションを、自動で終わりにする。
  // 記録としては残すが「続きから」には出さない。レポートは作らない（時間がたちすぎていて意味がないため）。
  // => 締めた件数
  async closeStale(days = 14) {
    const limit = Date.now() - days * 24 * 60 * 60 * 1000;
    const all = await withStore("readonly", (store) => reqToPromise(store.getAll()));
    const stale = all.filter((r) => r && r.meta && !r.meta.endedAt && r.createdAt < limit);
    for (const r of stale) {
      await Sessions.setMeta(r.id, {
        endedAt: Date.now(),
        autoClosed: true,
        summary: "とちゅうのまま2週間たったので、自動で終わりにしました。",
      });
    }
    return stale.length;
  },

  async remove(id) {
    await withStore("readwrite", (store) => reqToPromise(store.delete(id)));
  },

  // 今日作られたセッション数（利用上限の判定用）
  async countToday() {
    const { start, end } = todayRange();
    const all = await withStore("readonly", (store) => reqToPromise(store.getAll()));
    return all.filter((r) => r.createdAt >= start && r.createdAt < end).length;
  },
};
