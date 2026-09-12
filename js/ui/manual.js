// 手わたし経路の覆い（保護者向け・テスト用）。子どもの画面には出てこない。
// main.js が起動時に setManualHandler(openManualOverlay) を呼んで js/ai/manual.js に登録する。
// #manual-overlay は index.html に用意した、どの画面の上にも出せる全画面の覆い。

import { validateReply } from "../ai/schema.js";
import { extractJson } from "../ai/manual.js";

// {text, images:[{dataUrl,label}]} => Promise<string|null>（null は「やめる」）
export function openManualOverlay({ text, images }) {
  const el = document.getElementById("manual-overlay");
  return new Promise((resolve) => {
    render(el, text, images || []);
    el.hidden = false;

    const sendTextEl = el.querySelector('[data-el="manual-send-text"]');
    const pasteEl = el.querySelector('[data-el="manual-paste-text"]');
    const errorEl = el.querySelector('[data-el="manual-error"]');

    function close(result) {
      el.hidden = true;
      el.innerHTML = "";
      resolve(result);
    }

    el.querySelector('[data-act="manual-copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // クリップボードが使えない環境では、欄を全選択するだけでよい
        sendTextEl.focus();
        sendTextEl.select();
      }
    });

    el.querySelector('[data-act="manual-cancel"]').addEventListener("click", () => close(null));

    el.querySelector('[data-act="manual-send"]').addEventListener("click", () => {
      const raw = pasteEl.value;
      const jsonText = extractJson(raw);
      if (!jsonText) {
        errorEl.textContent = "JSONが見つかりません。返ってきた文章ごと貼ってみてください。";
        return;
      }
      let obj;
      try {
        obj = JSON.parse(jsonText);
      } catch (e) {
        errorEl.textContent = `JSONとして読めません（${e.message}）。`;
        return;
      }
      const reason = validateReply(obj);
      if (reason) {
        errorEl.textContent = `形式が合いません（${reason}）。貼り直してください。`;
        return;
      }
      close(raw);
    });
  });
}

function render(el, text, images) {
  el.innerHTML = `
    <div class="modal-card modal-card--full manual-card">
      <div class="modal-card__top">
        <strong>手わたし（テスト用）</strong>
      </div>
      <div class="modal-card__body manual-body">
        <p class="manual-desc">この内容をチャットに貼り付けて、返ってきた答えを下に貼ってください。</p>
        <div class="field">
          <label>送る内容</label>
          <textarea class="manual-send-text" data-el="manual-send-text" readonly></textarea>
          <button class="btn-secondary" type="button" data-act="manual-copy">コピー</button>
        </div>
        ${
          images.length
            ? `<div class="manual-images">
                ${images.map((img) => `<img src="${img.dataUrl}" alt="${img.label}" />`).join("")}
              </div>
              <p class="manual-images-hint">写真はチャットに直接ドラッグしてください。</p>`
            : ""
        }
        <div class="field">
          <label>返ってきた答えをここに貼る</label>
          <textarea class="manual-paste-text" data-el="manual-paste-text" placeholder="ここに貼り付けてください"></textarea>
        </div>
        <p class="manual-error" data-el="manual-error"></p>
      </div>
      <div class="modal-card__foot manual-foot">
        <button class="btn-secondary" type="button" data-act="manual-cancel">やめる</button>
        <button class="btn-primary" type="button" data-act="manual-send">送る</button>
      </div>
    </div>
  `;
  el.querySelector('[data-el="manual-send-text"]').value = text;
}
