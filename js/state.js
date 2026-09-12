// セッションの状態機械。段階遷移とヒント段数の確定はここが最終権限を持つ（実装仕様4章）。

import { Sessions } from "./lib/store.js";
import { toBase64 } from "./lib/image.js";

const PHASE_ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"];

export class TutorSession {
  constructor({ settings, sessionId }) {
    this.settings = settings;
    this.sessionId = sessionId;
    this.phase = "S1";
    this.hintLevel = 0;
    this.turnCount = 0;
    this.notes = null;
    this.history = [];
    this.stuckTurns = 0; // 段階もヒント段数も進まなかった往復の連続数
    this.errorStreak = 0; // 同じ notes.error_type が続いた回数
    this.practiceDone = 0;
    this.practiceAsked = 0;
    this.practiceMiss = 0; // S6で正解した類題の数
    this.practiceTotal = 0; // S6で出す予定の類題の数（アプリが2〜5のあいだで決める）
    this._prevErrorType = ""; // noteProgress の内部比較用（前回の error_type）
  }

  // 保存済みセッションから履歴を復元する。IndexedDBには書き戻さない（二重記録を避けるため）。
  async hydrate(stored) {
    if (!stored) return;
    this.history = [];
    this.turnCount = 0;
    for (const e of stored.entries || []) {
      if (e.who === "child") {
        const item = { role: "user", text: e.text };
        if (e.image) {
          const { base64, mediaType } = await toBase64(e.image);
          item.image = { base64, mediaType };
        }
        this.history.push(item);
        this.turnCount++;
      } else {
        this.history.push({ role: "assistant", text: e.text });
      }
    }
    const meta = stored.meta || {};
    if (meta.phase) this.phase = meta.phase;
    if (typeof meta.hintLevel === "number") this.hintLevel = meta.hintLevel;
    if (meta.notes) this.notes = meta.notes;
    if (typeof meta.stuckTurns === "number") this.stuckTurns = meta.stuckTurns;
    if (typeof meta.errorStreak === "number") this.errorStreak = meta.errorStreak;
    if (typeof meta.practiceDone === "number") this.practiceDone = meta.practiceDone;
    if (typeof meta.practiceAsked === "number") this.practiceAsked = meta.practiceAsked;
    if (typeof meta.practiceMiss === "number") this.practiceMiss = meta.practiceMiss;
    if (typeof meta.practiceTotal === "number") this.practiceTotal = meta.practiceTotal;
    this._prevErrorType = (this.notes && this.notes.error_type) || "";
  }

  // 子どもの発言を履歴に積み、IndexedDBにも残す。
  // image は撮影・切り取り後の Blob（任意）。base64化を待つ必要があるため呼び出し側は await すること。
  async pushChild(text, image) {
    const entry = { role: "user", text };
    if (image) {
      const { base64, mediaType } = await toBase64(image);
      entry.image = { base64, mediaType };
    }
    this.history.push(entry);
    this.turnCount++;
    await Sessions.append(this.sessionId, { who: "child", text, image, ts: Date.now() });
  }

  // AIの応答を履歴に積む。子どもに見せるのは say だけ（notesは積まない）。
  // notes と hintLevel をセッションの状態として更新し、IndexedDBにも反映する。
  async pushChuta(aiReply) {
    this.history.push({ role: "assistant", text: aiReply.say });
    this.notes = aiReply.notes;
    if (Number.isInteger(aiReply.hint_level) && aiReply.hint_level > this.hintLevel) {
      this.hintLevel = aiReply.hint_level; // hint_level は減らない
    }
    await Sessions.append(this.sessionId, { who: "chuta", text: aiReply.say, ts: Date.now() });
    await this._persistMeta();
  }

  // 現在の状態をまとめて Sessions.setMeta に残す（再開時の hydrate で戻すため）
  async _persistMeta() {
    await Sessions.setMeta(this.sessionId, {
      phase: this.phase,
      hintLevel: this.hintLevel,
      notes: this.notes,
      stuckTurns: this.stuckTurns,
      errorStreak: this.errorStreak,
      practiceDone: this.practiceDone,
      practiceTotal: this.practiceTotal,
      practiceAsked: this.practiceAsked,
      practiceMiss: this.practiceMiss,
    });
  }

  // pushChuta と applyPhase のあとに呼ぶ。呼ばれる前の段階とヒント段数を渡し、
  // 段階が進んだか hintLevel が上がっていれば stuckTurns を 0 に戻し、どちらも動かなければ 1 増やす。
  // notes.error_type が空でなく前回と同じ値なら errorStreak を増やし、ちがう値または空なら 0 に戻す。
  async noteProgress(prevPhase, prevHintLevel) {
    const advanced = this.phase !== prevPhase || this.hintLevel > prevHintLevel;
    this.stuckTurns = advanced ? 0 : this.stuckTurns + 1;

    const errorType = (this.notes && this.notes.error_type) || "";
    this.errorStreak = errorType && errorType === this._prevErrorType ? this.errorStreak + 1 : 0;
    this._prevErrorType = errorType;

    await this._persistMeta();
  }

  // アプリ側から見た行き詰まりの判定（実装仕様2 第4章）
  shouldCallParent() {
    const stuckAtHint3 = this.hintLevel >= 3 && (this.phase === "S3" || this.phase === "S4") && this.stuckTurns >= 2;
    // 定着の類題で2問まちがえたら、そこで粘らずにおうちの人を呼ぶ
    const strugglingInPractice = this.phase === "S6" && this.practiceMiss >= 2;
    return stuckAtHint3 || this.errorStreak >= 3 || strugglingInPractice;
  }

  // 実装仕様4章の規則でAIの提案を丸め、確定した段階を返す
  applyPhase(suggested) {
    const order = PHASE_ORDER;
    const curIdx = order.indexOf(this.phase);
    const s5Idx = order.indexOf("S5");
    const s6Idx = order.indexOf("S6");
    let sugIdx = order.indexOf(suggested);
    if (sugIdx < 0) sugIdx = curIdx; // 不正な値は現在の段階を保つ

    if (this.overLimit()) {
      this.phase = "S7";
      return this.phase;
    }

    if (sugIdx === s6Idx && curIdx < s5Idx) {
      sugIdx = s5Idx; // S5を通らずにS6へは行かせない
    }
    if (sugIdx < curIdx) {
      sugIdx = curIdx; // 段階は後退させない
    }
    const nextIdx = sugIdx - curIdx >= 2 ? curIdx + 1 : sugIdx; // 2つ以上先なら1つだけ進める

    this.phase = order[nextIdx];
    return this.phase;
  }

  // turnCount が settings.turnLimit を超えたか
  overLimit() {
    return this.turnCount > this.settings.turnLimit;
  }
}
