// OpenAI API（POST /v1/chat/completions）を1回だけ呼ぶ。再問い合わせ（format崩れ時）は provider.js が担当する。

import { buildSystem, buildStateNote } from "./prompt.js";
import { REPLY_SCHEMA } from "./schema.js";
import { AiError } from "./errors.js";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export async function ask({ settings, session, extraNote }) {
  const body = {
    model: settings.openaiModel,
    messages: buildMessages(session, settings, extraNote),
    response_format: {
      type: "json_schema",
      json_schema: { name: "chuta_reply", strict: true, schema: REPLY_SCHEMA },
    },
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof TypeError) {
      throw new AiError({ code: "cors", message: "このブラウザから直接つなげませんでした", detail: e.message });
    }
    throw new AiError({ code: "network", message: "通信に失敗した", detail: e.message });
  }

  if (!res.ok) {
    const detail = await safeText(res);
    if (res.status === 401 || res.status === 403) {
      throw new AiError({ code: "auth", message: "認証に失敗した", detail });
    }
    if (res.status === 429) {
      throw new AiError({ code: "limit", message: "利用上限に達した", detail });
    }
    throw new AiError({ code: "network", message: `通信エラー(${res.status})`, detail });
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== "string") {
    throw new AiError({ code: "format", message: "本文がない", detail: JSON.stringify(data) });
  }
  let reply;
  try {
    reply = JSON.parse(content);
  } catch (e) {
    throw new AiError({ code: "format", message: "JSONとして読めない", detail: e.message });
  }
  return { reply, usage: extractUsage(data) };
}

// data.usage からトークン数を取り出す。取れなければ0（実装仕様4 第4章）。
function extractUsage(data) {
  const u = data.usage || {};
  return {
    inputTokens: Number(u.prompt_tokens) || 0,
    outputTokens: Number(u.completion_tokens) || 0,
  };
}

// session.history から OpenAI の messages 配列を組み立てる（先頭にシステムメッセージを1つ置く）。
// 毎ターンの状態メモは最後の user メッセージの末尾に足す。
// extraNote があれば、状態メモに続けてもう1つのテキストブロックとして足す（実装仕様2 第2章）。
function buildMessages(session, settings, extraNote) {
  const msgs = [{ role: "system", content: buildSystem({ grade: settings.grade, knowledge: settings.knowledge }) }];
  for (const h of session.history) {
    msgs.push({ role: h.role, content: buildContentParts(h) });
  }
  appendStateNote(msgs, session, settings, extraNote);
  return msgs;
}

function buildContentParts(h) {
  const parts = [];
  if (h.image) {
    parts.push({ type: "image_url", image_url: { url: `data:${h.image.mediaType};base64,${h.image.base64}` } });
  }
  parts.push({ type: "text", text: h.text });
  return parts;
}

function appendStateNote(msgs, session, settings, extraNote) {
  const note = buildStateNote({
    phase: session.phase,
    hintLevel: session.hintLevel,
    turnCount: session.turnCount,
    turnLimit: settings.turnLimit,
    stuckTurns: session.stuckTurns,
    practiceDone: session.practiceDone,
    practiceTotal: session.practiceTotal,
  });
  const parts = [{ type: "text", text: note }];
  if (extraNote) parts.push({ type: "text", text: extraNote });

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      msgs[i].content.push(...parts);
      return;
    }
  }
  msgs.push({ role: "user", content: parts });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
