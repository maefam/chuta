// 手わたし経路。APIキーを使わず、実物のチャットに貼り付けて試すための経路。
// この層は画面を直接さわらない。main.js が起動時に setManualHandler で画面側の処理を登録する。
// provider.js から見た形は claude.js / openai.js と同じ ask({settings, session, extraNote})。

import { buildSystem, buildStateNote } from "./prompt.js";
import { AiError } from "./errors.js";

let handler = null;

// main.js が起動時に呼ぶ。handler は {text, images} => Promise<string|null|undefined>。
// 親が「やめる」を選んだときは null（または undefined）を返す約束にする。
export function setManualHandler(fn) {
  handler = fn;
}

export async function ask({ settings, session, extraNote }) {
  if (!handler) {
    throw new AiError({ code: "network", message: "手わたしの画面が用意されていません" });
  }

  const text = buildText({ settings, session, extraNote });
  const images = buildImages(session);

  const pasted = await handler({ text, images });
  if (pasted === null || pasted === undefined) {
    throw new AiError({ code: "network", message: "手わたしを中止しました" });
  }

  const jsonText = extractJson(pasted);
  if (!jsonText) {
    throw new AiError({ code: "format", message: "JSONが見つからない" });
  }
  let reply;
  try {
    reply = JSON.parse(jsonText);
  } catch (e) {
    throw new AiError({ code: "format", message: "JSONとして読めない", detail: e.message });
  }
  return { reply, usage: { inputTokens: 0, outputTokens: 0, model: "manual" } };
}

// 貼られた文字列から最初の { に対応する } までを取り出す。
// 前後に説明文や ```json の囲みが付いていても、文字列中の { } には惑わされないようにする。
export function extractJson(raw) {
  const s = String(raw || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// 送るはずの内容を、人が読んでそのまま貼り付けられる1つの文字列に組み立てる。
function buildText({ settings, session, extraNote }) {
  const system = buildSystem({ grade: settings.grade, knowledge: settings.knowledge });
  const note = buildStateNote({
    phase: session.phase,
    hintLevel: session.hintLevel,
    turnCount: session.turnCount,
    turnLimit: settings.turnLimit,
    stuckTurns: session.stuckTurns,
    practiceDone: session.practiceDone,
    practiceTotal: session.practiceTotal,
  });

  const parts = [
    "# 指示文",
    system,
    "",
    "# 会話の流れ",
    buildHistoryText(session.history),
    "",
    "# 状態メモ",
    note,
  ];
  if (extraNote) {
    parts.push("", "# アプリからの追加のお願い", extraNote);
  }
  parts.push(
    "",
    "# お願い",
    "上の指示文・会話の流れ・状態メモにもとづいて、指示文で指定された形のJSONオブジェクト1個だけを返してください。説明や前置きは書かないでください。"
  );
  return parts.join("\n");
}

// 会話の流れを人が読める形にする。画像そのものはここに埋め込まず、
// 「（写真が付いています。下に並べています）」とだけ添える。
function buildHistoryText(history) {
  const list = history || [];
  if (list.length === 0) return "（まだ会話はありません）";
  return list
    .map((h) => {
      const who = h.role === "user" ? "子ども" : "ちゅーた先生";
      const imgNote = h.image ? "（写真が付いています。下に並べています）" : "";
      return `${who}: ${h.text}${imgNote}`;
    })
    .join("\n\n");
}

// session.history から画像を集めて [{dataUrl, label}] にする（会話に写真があるときだけ）。
function buildImages(session) {
  const images = [];
  let n = 0;
  for (const h of (session && session.history) || []) {
    if (h.image) {
      n++;
      images.push({ dataUrl: `data:${h.image.mediaType};base64,${h.image.base64}`, label: `${n}枚目` });
    }
  }
  return images;
}
