// ホーム画面。中央にキャラクター、画面幅いっぱいの「写真をとる」、
// 下に小さく「文字で聞く」、中断中セッションがあれば「続きから」。右上に歯車。
import { CHUTA } from "../../assets/chuta.js";

// ctx = {
//   continuable: {id, unitName, createdAt} | null,
//   overDailyLimit: boolean,
//   dailyLimit: number,
//   onTakePhoto(), onTextQuestion(), onContinue(id), onOpenParent(),
// }
export function renderHome(root, ctx) {
  root.innerHTML = `
    <div class="home">
      <button class="btn-icon home__gear" type="button" aria-label="設定">⚙️</button>
      <div class="home__character">${CHUTA.normal}</div>
      <p class="home__title">なにを勉強する？</p>
      <div class="home__buttons">
        <button class="btn-primary" type="button" data-act="photo">写真をとる</button>
        <div class="home__secondary-row">
          <button class="btn-secondary" type="button" data-act="text">文字で聞く</button>
          ${ctx.continuable ? `<button class="btn-secondary" type="button" data-act="continue">続きから</button>` : ""}
        </div>
      </div>
      ${ctx.overDailyLimit ? `<p class="home__limit-notice">今日はここまで。また明日にしよう。</p>` : ""}
    </div>
  `;

  root.querySelector('[data-act="photo"]').addEventListener("click", () => {
    if (ctx.overDailyLimit) {
      showLimitNotice(root);
      return;
    }
    ctx.onTakePhoto();
  });

  root.querySelector('[data-act="text"]').addEventListener("click", () => {
    if (ctx.overDailyLimit) {
      showLimitNotice(root);
      return;
    }
    ctx.onTextQuestion();
  });

  const continueBtn = root.querySelector('[data-act="continue"]');
  if (continueBtn) {
    continueBtn.addEventListener("click", () => ctx.onContinue(ctx.continuable.id));
  }

  root.querySelector(".home__gear").addEventListener("click", () => ctx.onOpenParent());
}

function showLimitNotice(root) {
  let notice = root.querySelector(".home__limit-notice");
  if (!notice) {
    notice = document.createElement("p");
    notice.className = "home__limit-notice";
    root.querySelector(".home").appendChild(notice);
  }
  notice.textContent = "今日はここまで。また明日にしよう。";
}
