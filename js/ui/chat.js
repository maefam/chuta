// 会話画面。吹き出しの列＋ expect による下部コントロールの切り替え。
import { CHUTA } from "../../assets/chuta.js";
import { toRubyHtml } from "../lib/furigana.js";
import { speechSupport, startDictation, transcribeWithOpenAI } from "../lib/voice.js";

const FIXED_CHOICES = ["わからない", "わかった、次へ"];
const MAX_CHOICE_BUTTONS = 4;

// 「声で話すのはこの端末では使えないみたい」の案内は、ページを開いている間に一度だけ伝える
// （実装仕様4版2章）。会話をやり直しても何度も言わないよう、モジュール単位で持つ。
let blockedNoticeShown = false;

// startDictation の onError に渡ってくる値から、Web Speech の裏側が止められている状態
// （Braveなどでの 'network' / 'service-not-allowed'）かどうかを見る。
function looksBlocked(err) {
  const code = typeof err === "string" ? err : (err && (err.error || err.code || err.type)) || "";
  return code === "network" || code === "service-not-allowed";
}

// ctx = {
//   onSend({text, image, isAnswer, unit}),   // image は任意の Blob。isAnswer はテンキー「決定」からの送信のとき true
//   onStop(),        // 画面内の確認ダイアログで「やめる」を選んだあと。保存～画面遷移は main.js の責任
//   onRequestPhoto(),
//   onGoHome(),      // まとめ画面の「ホームにもどる」（保存済みなので確認は不要）
//   onCallParent(),  // 「おうちの人に聞く」「おうちの人を呼ぶ」
//   onDismissCallParent(),  // 二択の「もう少しやる」
//   settings,        // 現在の設定（音声の代わりの方法・OpenAIキーの判定に使う）
// }
// 戻り値: コントローラ
export function initChat(root, ctx) {
  root.innerHTML = `
    <div class="chat">
      <div class="chat__top">
        <div class="chat__top-left">
          <div class="chat__face" data-el="face">${CHUTA.normal}</div>
          <span class="chat__title">ちゅーた先生</span>
        </div>
        <button class="chat__stop" type="button" data-act="stop">やめる</button>
      </div>
      <div class="chat__thinking" data-el="thinking" hidden>
        <div class="chat__thinking-face">${CHUTA.thinking}</div>
        <span>考え中…</span>
      </div>
      <div class="chat__messages" data-el="messages"></div>
      <div class="chat__bottom" data-el="bottom">
        <p class="chat__practice-note" data-el="practice" hidden></p>
        <div class="chat__answer-area" data-el="answer-area"></div>
        <div class="text-input-row" data-el="text-row" hidden>
          <textarea data-el="text-input" placeholder="ここに書いてね" rows="1"></textarea>
          <button class="send-btn" type="button" data-act="text-send" aria-label="送る">➤</button>
        </div>
        <div class="chat__utility-row">
          ${speechSupport() === "ok" ? `<button class="btn-text" type="button" data-act="voice">声で話す</button>` : ""}
          <button class="btn-text" type="button" data-act="write">文字で書く</button>
          <button class="btn-text" type="button" data-act="photo">写真をもう1枚</button>
          <button class="btn-text" type="button" data-act="call-parent">おうちの人に聞く</button>
        </div>
      </div>
    </div>
    <div class="confirm-overlay" data-el="stop-confirm" hidden>
      <div class="confirm-card">
        <p class="confirm-card__text">やめますか？<br />ここまでの内容は残ります。</p>
        <div class="confirm-card__buttons">
          <button class="btn-secondary" type="button" data-act="stop-cancel">つづける</button>
          <button class="btn-primary" type="button" data-act="stop-yes">やめる</button>
        </div>
      </div>
    </div>
  `;

  const messagesEl = root.querySelector('[data-el="messages"]');
  const thinkingEl = root.querySelector('[data-el="thinking"]');
  const faceEl = root.querySelector('[data-el="face"]');
  const answerArea = root.querySelector('[data-el="answer-area"]');
  const textRow = root.querySelector('[data-el="text-row"]');
  const textInput = root.querySelector('[data-el="text-input"]');
  const bottomEl = root.querySelector('[data-el="bottom"]');
  const practiceEl = root.querySelector('[data-el="practice"]');
  const stopConfirmEl = root.querySelector('[data-el="stop-confirm"]');

  let lastReply = null;
  let lastOpts = {};

  root.querySelector('[data-act="stop"]').addEventListener("click", () => {
    stopConfirmEl.hidden = false;
  });
  root.querySelector('[data-act="stop-cancel"]').addEventListener("click", () => {
    stopConfirmEl.hidden = true;
  });
  root.querySelector('[data-act="stop-yes"]').addEventListener("click", () => {
    stopConfirmEl.hidden = true;
    ctx.onStop();
  });
  root.querySelector('[data-act="call-parent"]').addEventListener("click", () => ctx.onCallParent());
  root.querySelector('[data-act="photo"]').addEventListener("click", () => ctx.onRequestPhoto());
  root.querySelector('[data-act="write"]').addEventListener("click", () => {
    textRow.hidden = !textRow.hidden;
    if (!textRow.hidden) textInput.focus();
  });
  root.querySelector('[data-act="text-send"]').addEventListener("click", sendTextInput);
  textInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendTextInput();
    }
  });

  const voiceBtn = root.querySelector('[data-act="voice"]');
  if (voiceBtn) wireVoice(voiceBtn);

  function sendTextInput() {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = "";
    ctx.onSend({ text });
  }

  // 声で話すボタンのふるまい（実装仕様4版2章）。
  // 通常は Web Speech API（startDictation）を使う。押したときに「blocked」（Braveなどで
  // 裏側が止められている状態）と分かったら、OpenAIのキーがあり保護者画面で
  // 「音声の代わりの方法を使う」が入になっていれば、録音して文字起こしする経路に切り替える。
  // それも使えなければ、その場でボタンを消し、一度だけ案内を出す。
  function wireVoice(btn) {
    let mode = "speech"; // 'speech' | 'record'
    let stopSpeech = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let busy = false; // 文字起こし待ちなど、二重押しを防ぐ

    btn.addEventListener("click", () => {
      if (busy) return;
      if (mode === "record") {
        toggleRecording();
      } else {
        startSpeech();
      }
    });

    function canUseFallback() {
      const settings = ctx.settings || {};
      return Boolean(settings.voiceFallback && settings.openaiKey);
    }

    function startSpeech() {
      btn.textContent = "きいています…";
      try {
        stopSpeech = startDictation({
          onText: (text) => {
            const trimmed = (text || "").trim();
            if (trimmed) ctx.onSend({ text: trimmed });
          },
          onEnd: () => {
            stopSpeech = null;
            if (mode === "speech") btn.textContent = "声で話す";
          },
          onError: (err) => {
            stopSpeech = null;
            if (looksBlocked(err)) {
              if (canUseFallback()) {
                mode = "record";
                btn.textContent = "声で話す";
              } else {
                showBlockedNoticeOnce();
                btn.hidden = true;
              }
            } else {
              btn.textContent = "声で話す";
            }
          },
        });
      } catch (err) {
        // startDictation 自体が例外を投げる実装のときも同じ扱いにする
        if (canUseFallback()) {
          mode = "record";
          btn.textContent = "声で話す";
        } else {
          showBlockedNoticeOnce();
          btn.hidden = true;
        }
      }
    }

    async function toggleRecording() {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) recordedChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
          finishRecording(blob);
        };
        mediaRecorder.start();
        btn.textContent = "きいています…";
      } catch {
        btn.textContent = "声で話す";
      }
    }

    async function finishRecording(blob) {
      busy = true;
      btn.textContent = "声で話す";
      try {
        const text = await transcribeWithOpenAI(blob, ctx.settings || {});
        const trimmed = (text || "").trim();
        if (trimmed) ctx.onSend({ text: trimmed });
      } catch {
        appendChutaText("うまく聞き取れなかったよ。ボタンか文字でおしえて。");
      } finally {
        busy = false;
      }
    }

    function showBlockedNoticeOnce() {
      if (blockedNoticeShown) return;
      blockedNoticeShown = true;
      appendChutaText("声で話すのはこの端末では使えないみたい。ボタンか文字でおしえて。");
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendChild(text, imageUrl) {
    const row = document.createElement("div");
    row.className = "bubble-row bubble-row--child";
    row.innerHTML = `<div class="bubble bubble--child"></div>`;
    const bubble = row.querySelector(".bubble");
    if (text) {
      const p = document.createElement("div");
      p.textContent = text;
      bubble.appendChild(p);
    }
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      bubble.appendChild(img);
    }
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function appendChuta(text) {
    const row = document.createElement("div");
    row.className = "bubble-row bubble-row--chuta";
    row.innerHTML = `<div class="bubble bubble--chuta"></div>`;
    row.querySelector(".bubble").innerHTML = toRubyHtml(text || "");
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function setFace(mood) {
    faceEl.innerHTML = CHUTA[mood] || CHUTA.normal;
  }

  function setThinking(on) {
    thinkingEl.hidden = !on;
    setFace(on ? "thinking" : "normal");
    bottomEl.style.opacity = on ? "0.45" : "1";
    bottomEl.style.pointerEvents = on ? "none" : "auto";
  }

  // reply = {say, choices, expect, unit, done}
  // opts = { callParent?:boolean, practiceRemaining?:number|null }
  function showReply(reply, opts) {
    appendChuta(reply.say);
    setFace(reply.done ? "praise" : "normal");
    renderControls(reply, opts);
  }

  function renderControls(reply, opts) {
    lastReply = reply;
    lastOpts = opts || {};
    answerArea.innerHTML = "";

    const remaining = lastOpts.practiceRemaining;
    practiceEl.hidden = remaining === undefined || remaining === null;
    if (!practiceEl.hidden) practiceEl.textContent = `あと${remaining}問`;

    if (lastOpts.callParent) {
      textRow.hidden = true;
      renderCallParentChoice();
      return;
    }

    textRow.hidden = reply.expect !== "text";
    if (reply.expect === "choice") {
      renderChoices(reply.choices || []);
    } else if (reply.expect === "number") {
      renderNumpad(reply.unit || "");
    } else if (reply.expect === "photo") {
      renderPhotoPrompt();
    } else if (reply.expect === "text") {
      textInput.focus();
    }
    // "none" のときは何も出さない（応答待ちのみ）
  }

  function renderCallParentChoice() {
    const grid = document.createElement("div");
    grid.className = "call-parent-grid";
    grid.innerHTML = `
      <button class="btn-primary call-parent-btn" type="button" data-act="cp-call">おうちの人を呼ぶ</button>
      <button class="btn-secondary call-parent-btn" type="button" data-act="cp-continue">もう少しやる</button>
    `;
    grid.querySelector('[data-act="cp-call"]').addEventListener("click", () => ctx.onCallParent());
    grid.querySelector('[data-act="cp-continue"]').addEventListener("click", () => {
      ctx.onDismissCallParent();
      renderControls(lastReply, { ...lastOpts, callParent: false });
    });
    answerArea.appendChild(grid);
  }

  function renderChoices(aiChoices) {
    const room = MAX_CHOICE_BUTTONS - FIXED_CHOICES.length;
    const shown = aiChoices.slice(0, Math.max(0, room));
    const all = [...shown.map((c) => ({ label: c, fixed: false })), ...FIXED_CHOICES.map((c) => ({ label: c, fixed: true }))];
    const grid = document.createElement("div");
    grid.className = "choice-grid";
    all.forEach(({ label, fixed }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn" + (fixed ? " choice-btn--fixed" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => ctx.onSend({ text: label }));
      grid.appendChild(btn);
    });
    answerArea.appendChild(grid);
  }

  function renderNumpad(unit) {
    let value = "";
    const wrap = document.createElement("div");
    wrap.className = "numpad-wrap";
    wrap.innerHTML = `
      <div class="numpad-display">
        <span data-el="np-value">&nbsp;</span>
        ${unit ? `<span class="numpad-display__unit">${unit}</span>` : ""}
      </div>
      <div class="numpad-grid">
        ${["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "/"].map((k) => `<button class="numpad-key" type="button" data-key="${k}">${k}</button>`).join("")}
        <button class="numpad-key numpad-key--erase" type="button" data-key="erase">消す</button>
        <button class="numpad-key numpad-key--wide" type="button" data-key="enter">決定</button>
      </div>
    `;
    answerArea.appendChild(wrap);
    const display = wrap.querySelector('[data-el="np-value"]');
    const update = () => {
      display.textContent = value || " ";
    };
    wrap.querySelectorAll("[data-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        if (key === "erase") {
          value = value.slice(0, -1);
        } else if (key === "enter") {
          if (!value) return;
          ctx.onSend({ text: value, unit, isAnswer: true });
          value = "";
        } else {
          value += key;
        }
        update();
      });
    });
  }

  function renderPhotoPrompt() {
    const wrap = document.createElement("div");
    wrap.className = "photo-prompt";
    wrap.innerHTML = `<button class="btn-primary" type="button">写真をとる</button>`;
    wrap.querySelector("button").addEventListener("click", () => ctx.onRequestPhoto());
    answerArea.appendChild(wrap);
  }

  function showEnding({ say, unitName }) {
    root.innerHTML = `
      <div class="chat__summary">
        <div class="chat__summary-face">${CHUTA.praise}</div>
        <h1 class="home__title">今日のまとめ</h1>
        <dl class="chat__summary-card">
          <dt>単元</dt>
          <dd data-el="summary-unit"></dd>
          <dt>ちゅーた先生から</dt>
          <dd data-el="summary-say"></dd>
        </dl>
        <button class="btn-primary" type="button" data-act="home" style="width:100%;max-width:420px;">ホームにもどる</button>
      </div>
    `;
    root.querySelector('[data-el="summary-unit"]').innerHTML = unitName ? toRubyHtml(unitName) : "（記録なし）";
    root.querySelector('[data-el="summary-say"]').innerHTML = toRubyHtml(say || "");
    root.querySelector('[data-act="home"]').addEventListener("click", () => ctx.onGoHome());
  }

  function appendChutaText(text) {
    appendChuta(text);
  }

  function openTextInput() {
    textRow.hidden = false;
    textInput.focus();
  }

  return {
    appendChild,
    appendChutaText,
    showReply,
    setThinking,
    showEnding,
    setFace,
    restoreControls: renderControls,
    openTextInput,
  };
}
