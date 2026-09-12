// 利用量の記録と概算費用の計算（実装仕様4 第4章）。
// localStorage の chuta.usage に日付ごとの合計で持つ。60日より古いものは捨てる。

import { Settings } from "./store.js";

const USAGE_KEY = "chuta.usage";
const KEEP_DAYS = 60;

// 100万トークンあたりの米ドル単価。表にない型（OpenAIのものを含む）は保護者画面の単価を使う。
const PRICE_TABLE = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
};

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthPrefix(d = new Date()) {
  return todayKey(d).slice(0, 7);
}

function load() {
  try {
    const obj = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function save(obj) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(obj));
}

// 60日より古い日付を捨てる
function prune(obj) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(obj)) {
    const t = new Date(`${key}T00:00:00`).getTime();
    if (Number.isFinite(t) && t < cutoff) delete obj[key];
  }
  return obj;
}

// 1回分の呼び出しの概算費用（円）。単価が求まらなければ null（推測で金額を出さない）。
function estimateYen({ model, inputTokens, outputTokens }) {
  const settings = Settings.load();
  let price = PRICE_TABLE[model];
  if (!price) {
    const inP = Number(settings.otherInputPrice) || 0;
    const outP = Number(settings.otherOutputPrice) || 0;
    if (!inP && !outP) return null;
    price = { input: inP, output: outP };
  }
  const usd = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
  const usdJpy = Number(settings.usdJpy) || 150;
  return usd * usdJpy;
}

export const Usage = {
  // 1回の問い合わせ分を足す
  record({ provider, model, inputTokens, outputTokens }) {
    const obj = prune(load());
    const key = todayKey();
    const day = obj[key] || { calls: 0, inputTokens: 0, outputTokens: 0, yen: 0, yenKnown: true };
    day.calls += 1;
    day.inputTokens += inputTokens || 0;
    day.outputTokens += outputTokens || 0;
    const yen = estimateYen({ model, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0 });
    if (yen === null) {
      // その日のどれか1回でも単価不明の呼び出しがあれば、その日の金額はもう出さない
      day.yenKnown = false;
    } else if (day.yenKnown) {
      day.yen += yen;
    }
    obj[key] = day;
    save(obj);
  },

  // => {calls, inputTokens, outputTokens, yen|null}
  today() {
    const obj = load();
    const day = obj[todayKey()];
    return summarize(day ? [day] : []);
  },

  // => 同じ形（今月分の合計）
  month() {
    const obj = load();
    const prefix = monthPrefix();
    const days = Object.keys(obj)
      .filter((k) => k.startsWith(prefix))
      .map((k) => obj[k]);
    return summarize(days);
  },

  reset() {
    save({});
  },
};

function summarize(days) {
  let calls = 0,
    inputTokens = 0,
    outputTokens = 0,
    yen = 0,
    yenKnown = days.length > 0;
  for (const d of days) {
    calls += d.calls || 0;
    inputTokens += d.inputTokens || 0;
    outputTokens += d.outputTokens || 0;
    if (d.yenKnown) {
      yen += d.yen || 0;
    } else {
      yenKnown = false;
    }
  }
  return { calls, inputTokens, outputTokens, yen: yenKnown ? yen : null };
}
