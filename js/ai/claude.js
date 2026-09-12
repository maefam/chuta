// Claude API（POST /v1/messages）を1回だけ呼ぶ。再問い合わせ（format崩れ時）は provider.js が担当する。

import { buildSystem, buildStateNote } from "./prompt.js";
import { REPLY_SCHEMA } from "./schema.js";
import { AiError } from "./errors.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export async function ask({ settings, session, extraNote }) {
  const body = {
    model: settings.claudeModel,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: buildSystem({ grade: settings.grade, knowledge: settings.knowledge }),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: buildMessages(session, settings, extraNote),
    output_config: {
      effort: settings.effort,
      format: { type: "json_schema", schema: REPLY_SCHEMA },
    },
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": settings.claudeKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
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
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) {
    throw new AiError({ code: "format", message: "テキスト応答がない", detail: JSON.stringify(data) });
  }
  let reply;
  try {
    reply = JSON.parse(block.text);
  } catch (e) {
    throw new AiError({ code: "format", message: "JSONとして読めない", detail: e.message });
  }
  return { reply, usage: extractUsage(data) };
}

// data.usage からトークン数を取り出す。取れなければ0（実装仕様4 第4章）。
function extractUsage(data) {
  const u = data.usage || {};
  return {
    inputTokens: Number(u.input_tokens) || 0,
    outputTokens: Number(u.output_tokens) || 0,
  };
}

// session.history から Claude の messages 配列を組み立てる。
// 画像はテキストブロックより前に置く。毎ターンの状態メモは最後の user メッセージの末尾に足す
// （システムプロンプト自体は変えず、プロンプトキャッシュを効かせるため）。
// extraNote があれば、状態メモに続けてもう1つのテキストブロックとして足す（実装仕様2 第2章）。
function buildMessages(session, settings, extraNote) {
  const msgs = session.history.map((h) => ({ role: h.role, content: buildContentBlocks(h) }));
  appendStateNote(msgs, session, settings, extraNote);
  return msgs;
}

function buildContentBlocks(h) {
  const blocks = [];
  if (h.image) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: h.image.mediaType, data: h.image.base64 },
    });
  }
  blocks.push({ type: "text", text: h.text });
  return blocks;
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
  const blocks = [{ type: "text", text: note }];
  if (extraNote) blocks.push({ type: "text", text: extraNote });

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      msgs[i].content.push(...blocks);
      return;
    }
  }
  // user メッセージがまだない場合（通常は起こらない）
  msgs.push({ role: "user", content: blocks });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
