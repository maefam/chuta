// 引き継ぎ画面。おうちの人が読む画面なので、子ども向けの口調にしない。
// メモ本文（なければ say を代わりに表示）と、問題の写真があれば並べる。
import { toRubyHtml } from "../lib/furigana.js";

// ctx = {
//   text: string,           // メモ本文（handoff が空なら代わりに say を渡す）
//   noteMissing: boolean,   // handoff が空だったとき true。小さく注記を添える
//   photoUrls: string[],    // 問題の写真（object URL）。解放は呼び出し側の責任
//   onTaught(),             // 「教えてもらった」→ 会話に戻る
//   onFinish(),             // 「今日はここまで」→ セッションを終えてホームへ
// }
export function initHandoff(root, ctx) {
  const photoUrls = ctx.photoUrls || [];
  root.innerHTML = `
    <div class="handoff">
      <h1 class="handoff__title">おうちの人へ</h1>
      ${ctx.noteMissing ? `<p class="handoff__missing">メモは作れませんでした。かわりに、ちゅーた先生からの一言をのせます。</p>` : ""}
      <div class="handoff__note"></div>
      ${photoUrls.length
        ? `<div class="handoff__photos">${photoUrls.map(() => `<img />`).join("")}</div>`
        : ""}
      <div class="handoff__buttons">
        <button class="btn-primary" type="button" data-act="taught">教えてもらった</button>
        <button class="btn-secondary" type="button" data-act="finish">今日はここまで</button>
      </div>
    </div>
  `;

  root.querySelector(".handoff__note").innerHTML = toRubyHtml(ctx.text || "");

  const imgs = root.querySelectorAll(".handoff__photos img");
  imgs.forEach((img, i) => {
    img.src = photoUrls[i];
    img.alt = "問題の写真";
  });

  root.querySelector('[data-act="taught"]').addEventListener("click", () => ctx.onTaught());
  root.querySelector('[data-act="finish"]').addEventListener("click", () => ctx.onFinish());
}
