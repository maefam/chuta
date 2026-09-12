// AI呼び出しの窓口。settings.provider で claude.js / openai.js / mock.js に振り分ける。
// 形式崩れ（JSON.parse失敗、または schema.js の validateReply が理由を返した）ときは、
// 同じ内容でもう一度だけ問い合わせる。2度目も崩れたら AiError({code:'format'}) を投げる。

import { validateReply } from "./schema.js";
import { AiError } from "./errors.js";
import { ask as claudeAsk } from "./claude.js";
import { ask as openaiAsk } from "./openai.js";
import { ask as mockAsk } from "./mock.js";
import { Usage } from "../lib/usage.js";

export { AiError } from "./errors.js";

// => 2章のJSONを検証済みオブジェクトとして返す（これまでどおり応答オブジェクトだけ。呼び出し側は変えなくてよい）
// extraNote は任意の文字列。会話の履歴を汚さずにAIへ一言添えたいときに使う（実装仕様2 第2章）。
export async function ask({ settings, session, extraNote }) {
  const impl = pickImpl(settings.provider);
  return requestOnce({ impl, settings, session, extraNote, retryLeft: 1 });
}

function pickImpl(provider) {
  if (provider === "claude") return claudeAsk;
  if (provider === "openai") return openaiAsk;
  return mockAsk;
}

// settings.provider に応じた、利用量記録に使うモデル名
function modelOf(settings) {
  if (settings.provider === "claude") return settings.claudeModel;
  if (settings.provider === "openai") return settings.openaiModel;
  return "mock";
}

async function requestOnce({ impl, settings, session, extraNote, retryLeft }) {
  let reply, usage;
  try {
    const result = await impl({ settings, session, extraNote });
    reply = result.reply;
    usage = result.usage;
  } catch (e) {
    if (e instanceof AiError && e.code === "format" && retryLeft > 0) {
      return requestOnce({ impl, settings, session, extraNote, retryLeft: retryLeft - 1 });
    }
    throw e;
  }

  // 問い合わせ1回分のトークン数と概算費用を記録する（実装仕様4 第4章）
  Usage.record({
    provider: settings.provider,
    model: modelOf(settings),
    inputTokens: usage ? usage.inputTokens : 0,
    outputTokens: usage ? usage.outputTokens : 0,
  });

  const reason = validateReply(reply);
  if (reason) {
    if (retryLeft > 0) {
      return requestOnce({ impl, settings, session, extraNote, retryLeft: retryLeft - 1 });
    }
    throw new AiError({ code: "format", message: "応答の形式が崩れている", detail: reason });
  }
  return reply;
}
