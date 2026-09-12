// 保護者画面。PINで開き、設定編集・接続をためす・セッション一覧を提供する。
import { Settings, Sessions, Suggestions } from "../lib/store.js";
import { objectUrl } from "../lib/image.js";
import { ask, AiError } from "../ai/provider.js";
import { TutorSession } from "../state.js";
import { toRubyHtml, stripRuby } from "../lib/furigana.js";
import { hasHardKanji } from "../lib/kanji.js";
import { probeSpeech, isChrome } from "../lib/voice.js";
import { Usage } from "../lib/usage.js";

const SPEECH_RESULT_LABEL = {
  ok: "使える",
  unsupported: "この端末では使えない",
  blocked: "この端末では使えない",
  unknown: "確かめられない",
};

const GRADES = ["小1", "小2", "小3", "小4", "小5", "小6"];
const EFFORTS = [
  { v: "low", label: "ひかえめ" },
  { v: "medium", label: "ふつう" },
  { v: "high", label: "しっかり" },
];

const ERROR_MESSAGE = {
  auth: "認証に失敗しました。キーを確かめてください。",
  network: "通信できませんでした。回線を確かめてください。",
  cors: "このブラウザから直接つなげませんでした。",
  format: "応答の形が崩れました。",
  limit: "利用の上限にかかったようです。",
};

// ctx = { onClose() }  もどる操作
export function initParent(root, ctx) {
  showPinGate();

  function showPinGate() {
    const settings = Settings.load();
    let entered = "";

    root.innerHTML = `
      <div class="parent">
        <div class="parent__pin">
          <button class="btn-text" type="button" data-act="close">もどる</button>
          <p class="home__title">おうちの人の合いことば</p>
          <div class="parent__pin-display" data-el="dots"></div>
          <p class="parent__pin-error" data-el="error"></p>
          <div class="parent__pinpad">
            ${["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "消"]
              .map((k) => (k ? `<button type="button" data-key="${k}">${k}</button>` : `<span></span>`))
              .join("")}
          </div>
        </div>
      </div>
    `;
    root.querySelector('[data-act="close"]').addEventListener("click", () => ctx.onClose());
    const dotsEl = root.querySelector('[data-el="dots"]');
    const errorEl = root.querySelector('[data-el="error"]');

    function renderDots() {
      dotsEl.innerHTML = Array.from({ length: 4 })
        .map((_, i) => `<span class="parent__pin-dot${i < entered.length ? " parent__pin-dot--filled" : ""}"></span>`)
        .join("");
    }
    renderDots();

    root.querySelectorAll("[data-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        if (key === "消") {
          entered = entered.slice(0, -1);
        } else if (entered.length < 4) {
          entered += key;
        }
        renderDots();
        if (entered.length === 4) {
          if (entered === (settings.pin || "0000")) {
            showSettings(settings);
          } else {
            errorEl.textContent = "ちがうようです。もう一度どうぞ。";
            entered = "";
            setTimeout(renderDots, 300);
          }
        }
      });
    });
  }

  function showSettings(settings) {
    root.innerHTML = `
      <div class="parent">
        <div class="parent__top">
          <h1>おうちの人の設定</h1>
          <button class="btn-text" type="button" data-act="close">もどる</button>
        </div>
        <div class="parent__body">
          ${
            !isChrome()
              ? `<p class="parent__chrome-notice">ホーム画面のアイコンから開くと、音声入力が使えます。</p>`
              : ""
          }
          <section class="parent__section">
            <h2>AIのつなぎ先</h2>
            <div class="field">
              <label>使うAI</label>
              <select data-f="provider">
                <option value="mock">検証用（キー不要）</option>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div class="field">
              <label>Claude キー</label>
              <input type="password" data-f="claudeKey" autocomplete="off" />
            </div>
            <div class="field">
              <label>Claude モデル名</label>
              <input type="text" data-f="claudeModel" />
            </div>
            <div class="field">
              <label>OpenAI キー</label>
              <input type="password" data-f="openaiKey" autocomplete="off" />
            </div>
            <div class="field">
              <label>OpenAI モデル名</label>
              <input type="text" data-f="openaiModel" />
            </div>
            <div class="field">
              <label>考える深さ</label>
              <select data-f="effort">
                ${EFFORTS.map((e) => `<option value="${e.v}">${e.label}</option>`).join("")}
              </select>
            </div>
            <button class="btn-secondary" type="button" data-act="test" style="width:100%;">接続をためす</button>
            <p class="parent__test-result" data-el="test-result" hidden></p>
          </section>

          <section class="parent__section">
            <h2>費用の見積もり</h2>
            <p class="parent__hint">Claude は自動で計算します。OpenAIなど表にないAIを使うときは、ここに単価を入れてください。</p>
            <div class="field-row">
              <div class="field">
                <label>入力の単価（100万トークンあたり米ドル）</label>
                <input type="number" min="0" step="0.01" data-f="otherInputPrice" />
              </div>
              <div class="field">
                <label>出力の単価（100万トークンあたり米ドル）</label>
                <input type="number" min="0" step="0.01" data-f="otherOutputPrice" />
              </div>
            </div>
            <div class="field">
              <label>円換算レート（1ドルあたり円）</label>
              <input type="number" min="1" step="1" data-f="usdJpy" />
            </div>
          </section>

          <section class="parent__section">
            <h2>音声入力</h2>
            <div class="field field--checkbox">
              <label><input type="checkbox" data-f="voiceFallback" /> 音声の代わりの方法を使う（OpenAIのキーが必要です）</label>
            </div>
            <button class="btn-secondary" type="button" data-act="voice-test" style="width:100%;">音声入力をためす</button>
            <p class="parent__test-result" data-el="voice-test-result" hidden></p>
          </section>

          <section class="parent__section">
            <h2>利用量</h2>
            <div class="usage-grid">
              <div class="usage-block">
                <h3>今日</h3>
                <dl class="usage-block__list" data-el="usage-today"></dl>
              </div>
              <div class="usage-block">
                <h3>今月</h3>
                <dl class="usage-block__list" data-el="usage-month"></dl>
              </div>
            </div>
          </section>

          <section class="parent__section">
            <h2>お子さまの設定</h2>
            <div class="field">
              <label>学年</label>
              <select data-f="grade">
                ${GRADES.map((g) => `<option value="${g}">${g}</option>`).join("")}
              </select>
            </div>
            <div class="field-row">
              <div class="field">
                <label>1日に解ける回数</label>
                <input type="number" min="1" data-f="dailyLimit" />
              </div>
              <div class="field">
                <label>1回の往復の上限</label>
                <input type="number" min="1" data-f="turnLimit" />
              </div>
            </div>
            <div class="field">
              <label>1日の上限金額（円・概算、0で上限なし）</label>
              <input type="number" min="0" step="1" data-f="dailyYen" />
            </div>
            <div class="field">
              <label>合いことば（4けたの数字）</label>
              <input type="text" inputmode="numeric" maxlength="4" data-f="pin" />
            </div>
          </section>

          <section class="parent__section" data-el="suggestions-section" hidden>
            <h2>ちゅーた先生からの提案</h2>
            <ul class="suggestion-list" data-el="suggestion-list"></ul>
          </section>

          <section class="parent__section">
            <h2>教え方のメモ（ナレッジ）</h2>
            <div class="field">
              <label>ちゅーた先生への申し送り事項</label>
              <textarea data-f="knowledge" placeholder="例）まず線分図を描かせる。式より先に図。"></textarea>
            </div>
          </section>

          <div class="parent__save-row">
            <button class="btn-primary" type="button" data-act="save">保存する</button>
          </div>

          <section class="parent__section">
            <h2>これまでの記録</h2>
            <ul class="session-list" data-el="session-list"></ul>
          </section>
        </div>
      </div>

      <div class="modal-overlay" data-el="modal" hidden>
        <div class="modal-card">
          <div class="modal-card__top">
            <strong data-el="modal-title">記録</strong>
            <button class="btn-text" type="button" data-act="modal-close">とじる</button>
          </div>
          <div class="modal-card__body" data-el="modal-body"></div>
        </div>
      </div>
    `;

    root.querySelector('[data-act="close"]').addEventListener("click", () => ctx.onClose());

    for (const key of [
      "provider",
      "claudeKey",
      "claudeModel",
      "openaiKey",
      "openaiModel",
      "effort",
      "grade",
      "dailyLimit",
      "turnLimit",
      "dailyYen",
      "pin",
      "knowledge",
      "otherInputPrice",
      "otherOutputPrice",
      "usdJpy",
    ]) {
      const el = root.querySelector(`[data-f="${key}"]`);
      if (el) el.value = settings[key] ?? (key === "usdJpy" ? 150 : key === "otherInputPrice" || key === "otherOutputPrice" || key === "dailyYen" ? 0 : "");
    }
    const voiceFallbackEl = root.querySelector('[data-f="voiceFallback"]');
    if (voiceFallbackEl) voiceFallbackEl.checked = Boolean(settings.voiceFallback);

    root.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const patch = collectForm();
      await Settings.save(patch);
      const saveBtn = root.querySelector('[data-act="save"]');
      const original = saveBtn.textContent;
      saveBtn.textContent = "保存しました";
      setTimeout(() => (saveBtn.textContent = original), 1200);
    });

    root.querySelector('[data-act="voice-test"]').addEventListener("click", async () => {
      const resultEl = root.querySelector('[data-el="voice-test-result"]');
      resultEl.hidden = false;
      resultEl.className = "parent__test-result";
      resultEl.textContent = "確かめています…";
      let result;
      try {
        result = await probeSpeech();
      } catch {
        result = "unknown";
      }
      resultEl.classList.add(result === "ok" ? "parent__test-result--ok" : result === "unknown" ? "" : "parent__test-result--ng");
      resultEl.textContent = SPEECH_RESULT_LABEL[result] || SPEECH_RESULT_LABEL.unknown;
    });

    root.querySelector('[data-act="test"]').addEventListener("click", async () => {
      const resultEl = root.querySelector('[data-el="test-result"]');
      resultEl.hidden = false;
      resultEl.className = "parent__test-result";
      resultEl.textContent = "確かめています…";
      const testSettings = { ...settings, ...collectForm() };
      try {
        const testSession = new TutorSession({ settings: testSettings, sessionId: `connection-test-${Date.now()}` });
        testSession.pushChild("これは接続確認です。「はい」とだけ答えてください。", undefined);
        await ask({ settings: testSettings, session: testSession });
        resultEl.classList.add("parent__test-result--ok");
        resultEl.textContent = "つながりました。";
      } catch (err) {
        resultEl.classList.add("parent__test-result--ng");
        const code = err instanceof AiError ? err.code : undefined;
        resultEl.textContent = (code && ERROR_MESSAGE[code]) || "うまくつながりませんでした。";
      }
    });

    function collectForm() {
      const patch = {};
      for (const key of ["provider", "claudeKey", "claudeModel", "openaiKey", "openaiModel", "effort", "grade", "pin", "knowledge"]) {
        const el = root.querySelector(`[data-f="${key}"]`);
        if (el) patch[key] = el.value;
      }
      for (const key of ["dailyLimit", "turnLimit"]) {
        const el = root.querySelector(`[data-f="${key}"]`);
        if (el) patch[key] = Number(el.value) || 1;
      }
      // 0を許す項目（上限なし／単価未設定）は || で救わず、そのまま数値化する
      for (const key of ["dailyYen", "otherInputPrice", "otherOutputPrice"]) {
        const el = root.querySelector(`[data-f="${key}"]`);
        if (el) patch[key] = Number(el.value) || 0;
      }
      const usdJpyEl = root.querySelector('[data-f="usdJpy"]');
      if (usdJpyEl) patch.usdJpy = Number(usdJpyEl.value) || 150;
      const voiceFallbackEl = root.querySelector('[data-f="voiceFallback"]');
      if (voiceFallbackEl) patch.voiceFallback = Boolean(voiceFallbackEl.checked);
      return patch;
    }

    renderSuggestions();
    renderSessionList();
    renderUsage();

    // 今日・今月の呼び出し回数・トークン数・概算費用（実装仕様4版4章）。
    // 金額（yen）が null のときは単価が入っていないということなので、金額欄は出さずトークン数だけ出す。
    function renderUsage() {
      renderUsageBlock(root.querySelector('[data-el="usage-today"]'), Usage.today());
      renderUsageBlock(root.querySelector('[data-el="usage-month"]'), Usage.month());
    }

    function renderUsageBlock(dl, data) {
      if (!dl || !data) return;
      const rows = [
        ["呼び出し回数", `${data.calls || 0}回`],
        ["入力トークン", `${(data.inputTokens || 0).toLocaleString("ja-JP")}`],
        ["出力トークン", `${(data.outputTokens || 0).toLocaleString("ja-JP")}`],
      ];
      if (typeof data.yen === "number") {
        rows.push(["概算費用", `約${Math.round(data.yen).toLocaleString("ja-JP")}円`]);
      }
      dl.innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
    }

    // ちゅーた先生からの提案（実装仕様3版3章）。自動でナレッジには書き込まず、
    // 「入れる」を押したときだけナレッジ本文の末尾に足して保存する。
    async function renderSuggestions() {
      const sectionEl = root.querySelector('[data-el="suggestions-section"]');
      const listEl = root.querySelector('[data-el="suggestion-list"]');
      const list = (await Suggestions.list()) || [];
      if (list.length === 0) {
        sectionEl.hidden = true;
        listEl.innerHTML = "";
        return;
      }
      sectionEl.hidden = false;
      listEl.innerHTML = list
        .map(
          (s) => `<li class="suggestion-item" data-id="${s.id}">
            <p class="suggestion-item__text"></p>
            <div class="suggestion-item__buttons">
              <button class="btn-secondary" type="button" data-act="accept">入れる</button>
              <button class="btn-text" type="button" data-act="reject">いらない</button>
            </div>
          </li>`
        )
        .join("");
      listEl.querySelectorAll(".suggestion-item").forEach((li, i) => {
        const s = list[i];
        li.querySelector(".suggestion-item__text").innerHTML = toRubyHtml(s.text);
        li.querySelector('[data-act="accept"]').addEventListener("click", () => acceptSuggestion(s));
        li.querySelector('[data-act="reject"]').addEventListener("click", () => rejectSuggestion(s));
      });
    }

    async function acceptSuggestion(s) {
      const textarea = root.querySelector('[data-f="knowledge"]');
      const current = (textarea && textarea.value) || "";
      const updated = current.trim() ? `${current}\n${s.text}` : s.text;
      if (textarea) textarea.value = updated;
      await Settings.save({ knowledge: updated });
      settings.knowledge = updated;
      await Suggestions.remove(s.id);
      renderSuggestions();
    }

    async function rejectSuggestion(s) {
      await Suggestions.remove(s.id);
      renderSuggestions();
    }

    async function renderSessionList() {
      const listEl = root.querySelector('[data-el="session-list"]');
      const sessions = await Sessions.list();
      if (!sessions || sessions.length === 0) {
        listEl.innerHTML = `<li class="session-empty">まだ記録がありません。</li>`;
        return;
      }
      listEl.innerHTML = sessions
        .map((s, i) => {
          const date = new Date(s.createdAt).toLocaleString("ja-JP");
          const unit = (s.meta && s.meta.unit_name) || (s.meta && s.meta.notes && s.meta.notes.unit_name) || "";
          const unitHtml = unit ? toRubyHtml(unit) : "（単元不明）";
          const open = s.meta && !s.meta.endedAt ? `<span class="session-item__open">とちゅう</span>` : "";
          return `<li><button class="session-item" type="button" data-idx="${i}">
            <span class="session-item__date">${date}</span>
            <span class="session-item__unit">${unitHtml}</span>
            ${open}
          </button></li>`;
        })
        .join("");
      listEl.querySelectorAll("[data-idx]").forEach((btn) => {
        btn.addEventListener("click", () => openSessionModal(sessions[Number(btn.dataset.idx)].id));
      });
    }

    async function openSessionModal(id) {
      const modal = root.querySelector('[data-el="modal"]');
      const body = root.querySelector('[data-el="modal-body"]');
      const title = root.querySelector('[data-el="modal-title"]');
      const full = await Sessions.get(id);
      const meta = full.meta || {};
      const unitName = meta.unit_name || (meta.notes && meta.notes.unit_name) || "";
      title.innerHTML = unitName ? toRubyHtml(unitName) : "会話の記録";
      body.innerHTML = "";

      // 概要：単元・日時・所要時間・ヒントの到達段数・引き継ぎの有無（実装仕様3版2章）
      const overview = document.createElement("dl");
      overview.className = "session-detail";
      overview.innerHTML = `
        <dt>単元</dt><dd data-el="d-unit"></dd>
        <dt>日時</dt><dd data-el="d-date"></dd>
        <dt>所要時間</dt><dd data-el="d-duration"></dd>
        <dt>ヒントの到達段数</dt><dd data-el="d-hint"></dd>
        <dt>引き継ぎ</dt><dd data-el="d-handoff"></dd>
      `;
      body.appendChild(overview);
      overview.querySelector('[data-el="d-unit"]').innerHTML = unitName ? toRubyHtml(unitName) : "（単元不明）";
      overview.querySelector('[data-el="d-date"]').textContent = new Date(full.createdAt).toLocaleString("ja-JP");
      overview.querySelector('[data-el="d-duration"]').textContent = meta.endedAt
        ? formatDuration(meta.endedAt - full.createdAt)
        : "（進行中）";
      overview.querySelector('[data-el="d-hint"]').textContent = hintLevelLabel(meta.hintLevel);
      overview.querySelector('[data-el="d-handoff"]').textContent = meta.handoff ? "あり" : "なし";

      // 中断したままのセッションは、ここから終わりにできる。
      // 2週間たったものはアプリが自動で締めるので、その旨を出す。
      if (!meta.endedAt) {
        const close = document.createElement("section");
        close.className = "session-detail__close";
        close.innerHTML = `
          <p>このセッションはとちゅうのままです。「続きから」に出ています。</p>
          <button class="btn-secondary" type="button" data-act="end-session">終わりにする</button>
        `;
        close.querySelector('[data-act="end-session"]').addEventListener("click", async () => {
          await Sessions.setMeta(id, { endedAt: Date.now(), summary: "おうちの方が終わりにしました。" });
          root.querySelector('[data-el="modal"]').hidden = true;
          await renderSessionList();
        });
        body.appendChild(close);
      } else if (meta.autoClosed) {
        const auto = document.createElement("p");
        auto.className = "session-detail__auto-closed";
        auto.textContent = "とちゅうのまま2週間たったので、自動で終わりにしました。";
        body.appendChild(auto);
      }

      // レポート本文と「送る」（実装仕様3版2章）
      const reportSection = document.createElement("section");
      reportSection.className = "session-detail__report";
      if (meta.report) {
        reportSection.innerHTML = `
          <h3>おうちの人へのレポート</h3>
          <p class="session-detail__report-text"></p>
          <button class="btn-secondary session-detail__send" type="button">送る</button>
        `;
        reportSection.querySelector(".session-detail__report-text").innerHTML = toRubyHtml(meta.report);
        reportSection
          .querySelector(".session-detail__send")
          .addEventListener("click", () => sendReport(full, unitName));
        body.appendChild(reportSection);
      } else if (meta.endedAt) {
        reportSection.innerHTML = `<h3>おうちの人へのレポート</h3><p class="session-detail__report-missing">レポートは作れませんでした。</p>`;
        body.appendChild(reportSection);
      }

      if (meta.handoff) {
        const note = document.createElement("div");
        note.className = "handoff-note";
        note.innerHTML = `<strong>おうちの人への引き継ぎメモ</strong><p></p>`;
        note.querySelector("p").innerHTML = toRubyHtml(meta.handoff);
        body.appendChild(note);
      }

      const transcript = document.createElement("div");
      transcript.className = "session-detail__transcript";
      (full.entries || []).forEach((entry) => {
        const row = document.createElement("div");
        row.className = "bubble-row " + (entry.who === "child" ? "bubble-row--child" : "bubble-row--chuta");
        const bubble = document.createElement("div");
        bubble.className = "bubble " + (entry.who === "child" ? "bubble--child" : "bubble--chuta");
        if (entry.text) {
          const p = document.createElement("div");
          if (entry.who === "child") {
            p.textContent = entry.text;
          } else {
            p.innerHTML = toRubyHtml(entry.text);
          }
          bubble.appendChild(p);
        }
        if (entry.image) {
          const img = document.createElement("img");
          img.src = objectUrl(entry.image);
          bubble.appendChild(img);
        }
        row.appendChild(bubble);
        transcript.appendChild(row);
      });
      body.appendChild(transcript);

      appendKanjiWarningIfNeeded(body, full);
      modal.hidden = false;
    }

    // 教育漢字の一覧に取りこぼしがあっても子どもの画面は壊さない。ここは保護者画面だけの
    // 警告表示なので、判定に失敗しても静かに無視する（実装仕様3版4章）。
    function appendKanjiWarningIfNeeded(body, full) {
      try {
        const meta = full.meta || {};
        const chutaTexts = (full.entries || []).filter((e) => e.who !== "child").map((e) => e.text || "");
        const combined = [meta.report || "", meta.handoff || "", ...chutaTexts].join("\n");
        if (hasHardKanji(combined)) {
          const warn = document.createElement("p");
          warn.className = "session-detail__kanji-warn";
          warn.textContent = "読みにくい字が混じっているかもしれません。";
          body.appendChild(warn);
        }
      } catch {
        // 判定できなくても表示は止めない
      }
    }

    function formatDuration(ms) {
      if (!ms || ms < 0) return "（不明）";
      const minutes = Math.round(ms / 60000);
      if (minutes < 1) return "1分未満";
      if (minutes < 60) return `${minutes}分`;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m ? `${h}時間${m}分` : `${h}時間`;
    }

    function hintLevelLabel(level) {
      const n = Number(level) || 0;
      return n > 0 ? `${n}段目` : "ヒントなし";
    }

    // 「送る」。navigator.share があればそれを使い、なければ mailto を開く。
    // 本文は stripRuby をかけた素のテキストで、写真は含めない（実装仕様3版2章）。
    async function sendReport(full, unitName) {
      const meta = full.meta || {};
      const title = "ちゅーた先生 学習レポート";
      const date = new Date(full.createdAt).toLocaleString("ja-JP");
      const text = [
        `【${title}】`,
        `単元：${stripRuby(unitName || "（単元不明）")}`,
        `日時：${date}`,
        "",
        stripRuby(meta.report || ""),
      ].join("\n");

      if (navigator.share) {
        try {
          await navigator.share({ title, text });
        } catch {
          // ユーザーが共有をやめたときなど。何もしない。
        }
      } else {
        const subject = encodeURIComponent(title);
        const encodedBody = encodeURIComponent(text);
        window.location.href = `mailto:?subject=${subject}&body=${encodedBody}`;
      }
    }

    root.querySelector('[data-act="modal-close"]').addEventListener("click", () => {
      root.querySelector('[data-el="modal"]').hidden = true;
    });
  }
}
