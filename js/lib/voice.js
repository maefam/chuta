// 音声入力の環境判定と代替経路（実装仕様4 第2章）。

import { AiError } from "../ai/errors.js";

function getSR() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

// window.SpeechRecognition の有無だけを見る => 'ok' | 'unsupported'
export function speechSupport() {
  return getSR() ? "ok" : "unsupported";
}

// 実際に短く start() して stop() し、結果を返す。2秒で必ず決着する（子どもを待たせない）。
// => 'ok' | 'unsupported' | 'blocked' | 'unknown'
export async function probeSpeech() {
  const SR = getSR();
  if (!SR) return "unsupported";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish("unknown"), 2000);

    let recog;
    try {
      recog = new SR();
    } catch {
      clearTimeout(timer);
      finish("unknown");
      return;
    }
    recog.lang = "ja-JP";

    recog.onstart = () => {
      // 起動を確かめられたのですぐ止める
      try {
        recog.stop();
      } catch {
        /* noop */
      }
    };
    recog.onerror = (e) => {
      clearTimeout(timer);
      if (e.error === "network" || e.error === "service-not-allowed") {
        finish("blocked"); // Braveなどで裏側が止められている状態
      } else {
        finish("ok"); // no-speech等は起動自体はできている
      }
    };
    recog.onend = () => {
      clearTimeout(timer);
      finish("ok"); // エラーなく終わったので使える
    };

    try {
      recog.start();
    } catch {
      clearTimeout(timer);
      finish("unknown");
    }
  });
}

// navigator.brave?.isBrave() を使う => Promise<boolean>
export async function isBrave() {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === "function") {
      return await navigator.brave.isBrave();
    }
  } catch {
    /* noop */
  }
  return false;
}

// Brave/Edge/Samsungなどを除いた素のChromeか => boolean
export function isChrome() {
  const ua = navigator.userAgent || "";
  if (!/Chrome\//.test(ua)) return false;
  if (/Edg\//.test(ua)) return false; // Edge
  if (/OPR\//.test(ua)) return false; // Opera
  if (/SamsungBrowser/.test(ua)) return false;
  if (navigator.brave) return false; // Brave（同期で判定できる存在チェック）
  return true;
}

// Web Speech API で音声認識を開始する。停止用の関数を返す。
export function startDictation({ onText, onEnd, onError }) {
  const SR = getSR();
  const recog = new SR();
  recog.lang = "ja-JP";
  recog.continuous = false;
  recog.interimResults = false;

  recog.onresult = (e) => {
    const text = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    if (onText) onText(text);
  };
  recog.onerror = (e) => {
    if (onError) onError(e.error);
  };
  recog.onend = () => {
    if (onEnd) onEnd();
  };

  recog.start();
  return () => {
    try {
      recog.stop();
    } catch {
      /* noop */
    }
  };
}

// 代替経路：MediaRecorderで録った音声をOpenAIの文字起こしに投げる => 文字列
// OpenAIのキーが入っていないときは呼び出し側が呼ばない。エラーは AiError と同じ形で投げる。
export async function transcribeWithOpenAI(blob, settings) {
  const form = new FormData();
  form.append("file", blob, "voice.webm");
  form.append("model", "whisper-1");
  form.append("language", "ja");

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.openaiKey}` },
      body: form,
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
  if (typeof data.text !== "string") {
    throw new AiError({ code: "format", message: "文字起こし結果がない", detail: JSON.stringify(data) });
  }
  return data.text;
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
