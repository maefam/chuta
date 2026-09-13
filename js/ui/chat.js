// 会話画面。吹き出しの列＋ expect による下部コントロールの切り替え。
import { CHUTA } from "../../assets/chuta.js";
import { toRubyHtml } from "../lib/furigana.js";
import { toPlainMath } from "../lib/mathtext.js";
import { speechSupport, startDictation, transcribeWithOpenAI } from "../lib/voice.js";
import { sanitizeSvg } from "../lib/figure.js";

const FIXED_CHOICES = ["わからない", "わかった、次へ"];
const MAX_CHOICE_BUTTONS = 4;
// choices が空で返ってきたときの受け皿（親要望4章）。expect が number/photo 以外のときだけ使う。
const FALLBACK_CHOICES = ["もう一度説明して", "つづけて", "自分の考えを話す"];

// 「声で話すのはこの端末では使えないみたい」の案内は、ページを開いている間に一度だけ伝える
// （実装仕様4版2章）。会話をやり直しても何度も言わないよう、モジュール単位で持つ。
let blockedNoticeShown = false;

// visualViewport の resize リスナー。initChat を呼び直すたびに前回分を外し、多重登録を防ぐ。
let vvResizeHandler = null;

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
//   onPracticeSkip(), // 定着の類題（S6）の「あとでやる」
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
    <div class="modal-overlay" data-el="figure-modal" hidden>
      <div class="modal-card modal-card--full modal-card--figure">
        <div class="modal-card__top">
          <strong>図</strong>
          <button class="btn-text" type="button" data-act="figure-modal-close">とじる</button>
        </div>
        <div class="modal-card__body" data-el="figure-modal-body"></div>
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
  const figureModalEl = root.querySelector('[data-el="figure-modal"]');
  const figureModalBody = root.querySelector('[data-el="figure-modal-body"]');

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
  root.querySelector('[data-act="figure-modal-close"]').addEventListener("click", closeFigureModal);
  figureModalEl.addEventListener("click", (ev) => {
    if (ev.target === figureModalEl) closeFigureModal();
  });

  function openFigureModal(safeSvg) {
    figureModalBody.innerHTML = safeSvg;
    figureModalEl.hidden = false;
  }
  function closeFigureModal() {
    figureModalEl.hidden = true;
    figureModalBody.innerHTML = "";
  }
  root.querySelector('[data-act="call-parent"]').addEventListener("click", () => ctx.onCallParent());
  root.querySelector('[data-act="photo"]').addEventListener("click", () => ctx.onRequestPhoto());
  root.querySelector('[data-act="write"]').addEventListener("click", () => {
    setTextRowOpen(textRow.hidden);
  });

  // 文字入力とテンキー・選択肢は入力の手段が重なるので、同時には出さない。
  // 両方出すとキーボードが開いたときに下の操作が画面から溢れる。
  function setTextRowOpen(open) {
    textRow.hidden = !open;
    answerArea.hidden = open;
    if (open) {
      textInput.focus();
      scrollToBottom();
    }
  }
  root.querySelector('[data-act="text-send"]').addEventListener("click", sendTextInput);
  textInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendTextInput();
    }
  });

  const voiceBtn = root.querySelector('[data-act="voice"]');
  if (voiceBtn) wireVoice(voiceBtn);

  // キーボードの開閉で見えている高さが変わったとき、会話を一番下までスクロールし直す（親要望1章）。
  // visualViewport が無い環境では何もしない。
  if (window.visualViewport) {
    if (vvResizeHandler) window.visualViewport.removeEventListener("resize", vvResizeHandler);
    vvResizeHandler = () => scrollToBottom();
    window.visualViewport.addEventListener("resize", vvResizeHandler);
  }

  function sendTextInput() {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = "";
    setTextRowOpen(false);
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

  // figure はAIが返したSVG文字列（空のことが多い）。表示前に必ず sanitizeSvg を通す。
  function appendChuta(text, figure) {
    const row = document.createElement("div");
    row.className = "bubble-row bubble-row--chuta";
    row.innerHTML = `<div class="bubble bubble--chuta"></div>`;
    const bubble = row.querySelector(".bubble");
    bubble.innerHTML = toRubyHtml(toPlainMath(text || ""));
    const safeSvg = figure ? sanitizeSvg(figure) : "";
    if (safeSvg) bubble.appendChild(buildFigureEl(safeSvg));
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  // 吹き出しの中に図を置く。タップすると画面いっぱいに広げて見せる（細かい目盛りが読めるように）。
  function buildFigureEl(safeSvg) {
    const wrap = document.createElement("div");
    wrap.className = "chuta-figure";
    wrap.setAttribute("role", "button");
    wrap.tabIndex = 0;
    wrap.innerHTML = `<div class="chuta-figure__svg">${safeSvg}</div><span class="chuta-figure__hint">タップで大きく</span>`;
    const open = () => openFigureModal(safeSvg);
    wrap.addEventListener("click", open);
    wrap.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });
    return wrap;
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
    appendChuta(reply.say, reply.figure);
    setFace(reply.done ? "praise" : "normal");
    renderControls(reply, opts);
  }

  function renderControls(reply, opts) {
    lastReply = reply;
    lastOpts = opts || {};
    answerArea.innerHTML = "";

    const remaining = lastOpts.practiceRemaining;
    const isS6 = remaining !== undefined && remaining !== null; // 定着の類題（S6）の最中か
    practiceEl.hidden = !isS6;
    if (!practiceEl.hidden) practiceEl.textContent = `あと${remaining}問`;

    if (lastOpts.callParent) {
      textRow.hidden = true;
      renderCallParentChoice();
      return;
    }

    // expect が number/photo 以外なのに choices が空のときの受け皿（親要望4章）
    const choicesEmpty = !reply.choices || reply.choices.length === 0;

    textRow.hidden = reply.expect !== "text";
    if (reply.expect === "choice") {
      renderChoices(choicesEmpty ? FALLBACK_CHOICES : reply.choices, isS6);
    } else if (reply.expect === "number") {
      renderNumpad(reply.unit || "");
    } else if (reply.expect === "photo") {
      renderPhotoPrompt();
    } else if (reply.expect === "text") {
      if (choicesEmpty) renderChoices(FALLBACK_CHOICES, isS6);
      textInput.focus();
    } else if (choicesEmpty) {
      // "none" は原則ボタンなし（応答待ちのみ）だが、choices が空のときだけ受け皿を出す
      renderChoices(FALLBACK_CHOICES, isS6);
    }

    // 定着の類題は答えを数で打つことが多い。選択肢を出さない場面でも
    // 「あとでやる」で切り上げられるように、ここで単独のボタンを足す。
    if (isS6 && !answerArea.querySelector('[data-act="skip-practice"]')) {
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "skip-practice";
      skip.dataset.act = "skip-practice";
      skip.textContent = "あとでやる";
      skip.addEventListener("click", () => ctx.onPracticeSkip());
      answerArea.appendChild(skip);
    }
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

  // includeSkip: 定着の類題（S6）のときだけ true。目立たせないよう、ほかの選択肢と同じ大きさで
  // いちばん最後に「あとでやる」を足す（親要望3章）。
  function renderChoices(aiChoices, includeSkip) {
    // アプリが自動で足す「わからない」などと同じ文言がAI側にもあると、同じボタンが2つ並ぶ。
    // 見た目が紛らわしいだけでなく子どもが迷うので、重なったものは落とす。
    const norm = (t) => String(t || "").replace(/[\s、。!?！？]/g, "");
    const fixedNorm = FIXED_CHOICES.map(norm);
    const deduped = aiChoices.filter((c) => c && !fixedNorm.includes(norm(c)));
    const room = MAX_CHOICE_BUTTONS - FIXED_CHOICES.length;
    const shown = deduped.slice(0, Math.max(0, room));
    const all = [...shown.map((c) => ({ label: c, fixed: false })), ...FIXED_CHOICES.map((c) => ({ label: c, fixed: true }))];
    if (includeSkip) all.push({ label: "あとでやる", fixed: true, skip: true });
    const grid = document.createElement("div");
    grid.className = "choice-grid";
    all.forEach(({ label, fixed, skip }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn" + (fixed ? " choice-btn--fixed" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => (skip ? ctx.onPracticeSkip() : ctx.onSend({ text: label })));
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
        ${["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((k) => `<button class="numpad-key" type="button" data-key="${k}">${k}</button>`).join("")}
        <button class="numpad-key" type="button" data-key=".">.</button>
        <button class="numpad-key" type="button" data-key="/">/</button>
        <button class="numpad-key numpad-key--erase" type="button" data-key="erase">消す</button>
        <button class="numpad-key numpad-key--dontknow" type="button" data-key="dontknow">わからない</button>
        <button class="numpad-key numpad-key--enter" type="button" data-key="enter">決定</button>
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
        if (key === "dontknow") {
          // 答えを出せなかったときの出口。答えとしては扱わない（採点しない）
          value = "";
          ctx.onSend({ text: "わからない" });
          return;
        } else if (key === "erase") {
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
    root.querySelector('[data-el="summary-unit"]').innerHTML = unitName ? toRubyHtml(toPlainMath(unitName)) : "（記録なし）";
    root.querySelector('[data-el="summary-say"]').innerHTML = toRubyHtml(toPlainMath(say || ""));
    root.querySelector('[data-act="home"]').addEventListener("click", () => ctx.onGoHome());
  }

  // figure は省略可（会話の再読みこみで entry.figure を渡せるようにしてある）。
  function appendChutaText(text, figure) {
    appendChuta(text, figure);
  }

  function openTextInput() {
    textRow.hidden = false;
    textInput.focus();
    scrollToBottom();
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
