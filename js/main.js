// 画面遷移とイベント配線。ここが唯一、画面をまたいだ状態（設定・セッション）を持つ。
import { Settings, Sessions, Suggestions } from "./lib/store.js";
import { objectUrl } from "./lib/image.js";
import { judge } from "./lib/answer.js";
import { Usage } from "./lib/usage.js";
import { TutorSession } from "./state.js";
import { ask, AiError } from "./ai/provider.js";
import { buildAnswerNote, HANDOFF_REQUEST, PRACTICE_END_NOTE, REPORT_REQUEST } from "./ai/prompt.js";
import { setManualHandler } from "./ai/manual.js";
import { renderHome } from "./ui/home.js";
import { initCamera } from "./ui/camera.js";
import { initChat } from "./ui/chat.js";
import { initHandoff } from "./ui/handoff.js";
import { initParent } from "./ui/parent.js";
import { openManualOverlay } from "./ui/manual.js";
import { loadRemote, combine } from "./lib/knowledge.js";

// 定着の類題（S6）の問題数。アプリが決める（実装仕様2版7章）。
const PRACTICE_DEFAULT = 3;
const PRACTICE_MIN = 2;
const PRACTICE_MAX = 5;

const ERROR_MESSAGE = {
  auth: "つなぐためのキーがちがうようです。おうちの人に見てもらおう。",
  network: "通信がうまくいきませんでした。少し待ってからもう一度ためそう。",
  cors: "このブラウザから直接つなげませんでした。おうちの人に伝えよう。",
  format: "うまく答えが作れなかったよ。もう一度聞いてみよう。",
  limit: "今日はたくさん使ったみたい。少し待ってからにしよう。",
};

const homeEl = document.getElementById("screen-home");
const cameraEl = document.getElementById("screen-camera");
const chatEl = document.getElementById("screen-chat");
const handoffEl = document.getElementById("screen-handoff");
const parentEl = document.getElementById("screen-parent");
const SCREENS = [homeEl, cameraEl, chatEl, handoffEl, parentEl];

let settings = Settings.load();
let session = null;
let sessionId = null;
let chatController = null;
let cameraController = null;
let trackedUrls = [];
let practiceMistakeSeen = false; // S6で一度でもまちがえたか（practiceTotal を伸ばすかの判断用）
let practiceSkipped = false; // S6で「あとでやる」を選んだか（親レポートに書いてもらう）

// 定着の類題を「あとでやる」で切り上げたことをレポート作成の依頼に添える一言（親要望3章）。
const PRACTICE_SKIP_NOTE =
  "［アプリからの補足：定着の類題は、子どもが「あとでやる」を選んだので残っています。レポートにその旨を書いてください。］";

// ソフトキーボードが出て画面が縮んだとき、実際に見えている高さを --app-h に反映する（親要望1章）。
// visualViewport が無い環境（古いブラウザなど）では何もしない。
function setupViewportHeightVar() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const update = () => {
    document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
  };
  update();
  vv.addEventListener("resize", update);
}

// 教え方のメモの正本（knowledge.md）。セッション開始時に1回だけ取りに行き、そのセッション中は使い回す。
let remoteKnowledge = { text: "", from: "none", fetchedAt: null };

// セッションを始める・続きから開くときに呼ぶ。取れなくても会話は普通に始めるので、ここで失敗を吸収する。
async function refreshRemoteKnowledge() {
  try {
    remoteKnowledge = await loadRemote();
  } catch {
    remoteKnowledge = { text: "", from: "none", fetchedAt: null };
  }
}

// AIに渡す設定。保存済みの settings はそのまま使わず、knowledge だけ正本＋端末メモの合成文字列に
// 差し替えた別オブジェクトを返す（保存側に合成後の文字列が混ざらないようにするため）。
function aiSettings() {
  return { ...settings, knowledge: combine(remoteKnowledge.text, settings.knowledge) };
}

function showScreen(el) {
  for (const s of SCREENS) s.hidden = s !== el;
}

function trackUrl(url) {
  trackedUrls.push(url);
  return url;
}

function revokeTrackedUrls() {
  trackedUrls.forEach((u) => URL.revokeObjectURL(u));
  trackedUrls = [];
}

function stopCameraIfAny() {
  if (cameraController) {
    cameraController.stop();
    cameraController = null;
  }
}

// ---------- ホーム ----------

// 今日の概算費用が保護者の決めた上限額（settings.dailyYen、既定0＝上限なし）を超えているか
// （実装仕様4版4章）。yen が null（単価未入力）のときは判定のしようがないので超えていない扱いにする。
function overDailyCostLimit() {
  const limit = Number(settings.dailyYen) || 0;
  if (limit <= 0) return false;
  const today = Usage.today();
  return typeof today.yen === "number" && today.yen > limit;
}

let staleChecked = false;

async function mountHome() {
  settings = Settings.load();
  // 起動後の最初の一度だけ、中断したまま2週間たったセッションを自動で締める
  if (!staleChecked) {
    staleChecked = true;
    try {
      await Sessions.closeStale(14);
    } catch {
      // 締められなくても起動は止めない
    }
  }
  const [sessions, todayCount] = await Promise.all([Sessions.list(), Sessions.countToday()]);
  const continuable = (sessions || []).find((s) => s.meta && !s.meta.endedAt) || null;
  // セッション数の上限、金額の上限のどちらかにかかっていれば新しいセッションを始めさせない。
  // 「続きから」は対象外（会話の途中で超えても、そのセッションは最後まで続けさせる）。
  renderHome(homeEl, {
    continuable,
    overDailyLimit: todayCount >= settings.dailyLimit || overDailyCostLimit(),
    onTakePhoto: startPhotoFlow,
    onTextQuestion: startTextFlow,
    onContinue: continueSession,
    onOpenParent: openParent,
  });
}

async function goHome() {
  stopCameraIfAny();
  revokeTrackedUrls();
  session = null;
  sessionId = null;
  chatController = null;
  await mountHome();
  showScreen(homeEl);
}

// ---------- 撮影から開始 ----------

async function startPhotoFlow() {
  sessionId = await Sessions.create();
  session = new TutorSession({ settings, sessionId });
  practiceMistakeSeen = false;
  practiceSkipped = false;
  await refreshRemoteKnowledge();
  chatController = initChat(chatEl, chatCtx());
  showScreen(cameraEl);
  mountCamera(false);
}

function mountCamera(returnToChatOnCancel) {
  cameraController = initCamera(cameraEl, {
    onCaptured: async (blob) => {
      cameraController = null;
      showScreen(chatEl);
      await sendTurn({ text: "", image: blob });
    },
    onCancel: async () => {
      cameraController = null;
      if (returnToChatOnCancel) {
        showScreen(chatEl);
      } else {
        await Sessions.remove(sessionId);
        await goHome();
      }
    },
  });
}

// ---------- 文字で聞くから開始 ----------

async function startTextFlow() {
  sessionId = await Sessions.create();
  session = new TutorSession({ settings, sessionId });
  practiceMistakeSeen = false;
  practiceSkipped = false;
  await refreshRemoteKnowledge();
  showScreen(chatEl);
  chatController = initChat(chatEl, chatCtx());
  chatController.openTextInput();
}

// ---------- 続きから ----------

async function continueSession(target) {
  const id = typeof target === "string" ? target : target && target.id;
  if (!id) return;
  sessionId = id;
  const stored = await Sessions.get(id);
  session = new TutorSession({ settings, sessionId: id });
  await session.hydrate(stored);
  // practiceTotal が既定より大きければ、途中でまちがえて伸ばした跡と見なす
  practiceMistakeSeen = (session.practiceTotal || 0) > PRACTICE_DEFAULT;
  practiceSkipped = Boolean(stored && stored.meta && stored.meta.practiceSkipped);
  await refreshRemoteKnowledge();
  showScreen(chatEl);
  chatController = initChat(chatEl, chatCtx());
  replayHistory(stored);
}

function replayHistory(stored) {
  for (const entry of (stored && stored.entries) || []) {
    if (entry.who === "child") {
      const url = entry.image ? trackUrl(objectUrl(entry.image)) : null;
      chatController.appendChild(entry.text, url);
    } else {
      chatController.appendChutaText(entry.text, entry.figure);
    }
  }
  const lastReply = stored && stored.meta && stored.meta.lastReply;
  if (lastReply) {
    chatController.restoreControls(lastReply, {
      practiceRemaining: practiceRemainingFor(session.phase),
      callParent: session.shouldCallParent(),
    });
  }
}

// ---------- 会話中のやりとり ----------

function chatCtx() {
  return {
    onSend: (payload) => sendTurn(payload),
    onStop: onStopPressed,
    onRequestPhoto: () => {
      showScreen(cameraEl);
      mountCamera(true);
    },
    onGoHome: goHome,
    onCallParent: () => triggerHandoff(),
    onDismissCallParent: () => dismissCallParent(),
    onPracticeSkip: () => onPracticeSkipPressed(),
    settings, // 音声ボタン（声の代わりの方法・OpenAIキーの判定）に使う
  };
}

function lastAssistantText() {
  const hist = (session && session.history) || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].role === "assistant") return hist[i].text;
  }
  return "";
}

// 段階が S6 のときの残り問題数。それ以外は null（練習中の小さな表示の元）
function practiceRemainingFor(phase) {
  if (phase !== "S6") return null;
  const total = session.practiceTotal || 0;
  const done = session.practiceDone || 0;
  return Math.max(0, total - done);
}

// S6 に入った最初のターンで呼ぶ。既定3問。全問正解が続けば2問で切り上げる。
// 数を増やすことはしない。まちがえた子に「あと○問」が増えていくのは応援にならないため。
function startPractice() {
  session.practiceTotal = PRACTICE_DEFAULT;
  session.practiceDone = 0;
  session.practiceAsked = 0;
  session.practiceMiss = 0;
  practiceMistakeSeen = false;
}

// S6 中の数値回答を判定したあとに呼ぶ。
function recordPracticeResult(judgement) {
  session.practiceAsked = (session.practiceAsked || 0) + 1;
  if (judgement === "correct") {
    session.practiceDone = (session.practiceDone || 0) + 1;
    // まちがえずに2問できたら、そこで切り上げる
    if (!practiceMistakeSeen && session.practiceDone >= PRACTICE_MIN) {
      session.practiceTotal = Math.min(session.practiceTotal || PRACTICE_DEFAULT, PRACTICE_MIN);
    }
  } else if (judgement === "incorrect") {
    practiceMistakeSeen = true;
    session.practiceMiss = (session.practiceMiss || 0) + 1;
  }
}

// 類題を打ち切るべきか。出した数が上限に達したか、必要な数を解き終えたとき。
function practiceShouldEnd() {
  if (session.phase !== "S6") return false;
  const asked = session.practiceAsked || 0;
  const done = session.practiceDone || 0;
  const total = session.practiceTotal || PRACTICE_DEFAULT;
  return asked >= PRACTICE_MAX || done >= total;
}

// AIの応答を段階・ヒント段数・行き詰まり回数に反映する共通処理（実装仕様2版4章・7章）。
// 呼ぶ前の phase / hintLevel を noteProgress に渡すため、mutate する前に控えておく。
async function applyAiReply(reply) {
  const prevPhase = session.phase;
  const prevHintLevel = session.hintLevel;
  const phase = session.applyPhase(reply.phase);
  await session.pushChuta(reply);
  await session.noteProgress(prevPhase, prevHintLevel);
  if (prevPhase !== "S6" && phase === "S6") startPractice();
  await maybeSaveSuggestion(reply);
  return { phase, prevPhase };
}

// まとめ（S7）のときだけ knowledge_suggestion が入る。自動でナレッジには書き込まず、
// 保護者画面で親が「入れる」を押したときだけ反映する（実装仕様3版3章）。
async function maybeSaveSuggestion(reply) {
  const text = reply && reply.knowledge_suggestion && reply.knowledge_suggestion.trim();
  if (!text) return;
  // まとめのターンと、終了処理のレポート生成ターンの両方で knowledge_suggestion が
  // 入って二重に溜まることがあるため、同じセッション・同じ文面なら足さない。
  const existing = (await Suggestions.list()) || [];
  const isDuplicate = existing.some((s) => s.sessionId === sessionId && s.text === text);
  if (!isDuplicate) await Suggestions.add(sessionId, text);
}

// session.pushChuta / noteProgress が phase・hintLevel・notes・stuckTurns・errorStreak・
// practiceDone・practiceTotal はすでに保存している。ここでは保護者画面の一覧表示用の unit_name と、
// 再開時に下部コントロールを復元するための lastReply、練習問題数だけ追加で残す。
async function saveTurnMeta(reply) {
  await Sessions.setMeta(sessionId, {
    unit_name: session.notes && session.notes.unit_name,
    lastReply: { expect: reply.expect, choices: reply.choices, unit: reply.unit },
    practiceDone: session.practiceDone,
    practiceTotal: session.practiceTotal,
    practiceAsked: session.practiceAsked,
    practiceMiss: session.practiceMiss,
  });
}

async function sendTurn({ text, image, isAnswer, unit }) {
  if (!session || !chatController) return;
  const imageUrl = image ? trackUrl(objectUrl(image)) : null;
  chatController.appendChild(text || "", imageUrl);
  // pushChild が履歴への積み込みと IndexedDB への保存の両方をやる。
  // 画像のbase64化を待つ必要があるので必ず await する（待たないと画像なしでAIに送ってしまう）。
  await session.pushChild(text || "", image);

  // テンキーの「決定」からの送信だけ、アプリ側で答え合わせをして結果をAIに伝える（notes.answer は画面に出さない）。
  let judgement;
  let extraNote;
  if (isAnswer) {
    judgement = judge(text, session.notes && session.notes.answer);
    extraNote = buildAnswerNote(text, unit || "", judgement);
  }
  // 類題を出しきったら、次の返事でまとめに進むよう頼む（まちがえ続けても終われるようにするため）
  if (practiceShouldEnd()) {
    extraNote = extraNote ? `${extraNote} ${PRACTICE_END_NOTE}` : PRACTICE_END_NOTE;
  }

  chatController.setThinking(true);
  let reply;
  try {
    reply = await ask({ settings: aiSettings(), session, extraNote });
  } catch (err) {
    chatController.setThinking(false);
    const code = err instanceof AiError ? err.code : undefined;
    chatController.appendChutaText((code && ERROR_MESSAGE[code]) || "うまくつながりませんでした。もう一度ためそう。");
    return;
  }
  chatController.setThinking(false);

  const { phase, prevPhase } = await applyAiReply(reply);
  // 寄り道の確認問題に正解した回は、段階もヒント段数も動かないが前には進んでいる。
  // 行き詰まりとして数えると、おうちの人を呼ぶ判断が早まりすぎるので戻す。
  if (judgement === "correct") {
    session.stuckTurns = 0;
  }
  if (isAnswer && prevPhase === "S6" && judgement && judgement !== "unknown") {
    recordPracticeResult(judgement);
  }
  await saveTurnMeta(reply);

  if (reply.done || session.overLimit()) {
    const say = await finalizeSession(reply.say);
    chatController.showEnding({ say, unitName: session.notes && session.notes.unit_name });
    return;
  }

  const callParent = Boolean(reply.call_parent) || session.shouldCallParent();
  chatController.showReply(reply, {
    callParent,
    practiceRemaining: practiceRemainingFor(phase),
  });
}

// セッションが終わる4つの経路（done、往復上限、「やめる」、引き継ぎ画面の「今日はここまで」）
// すべてがここを通る。終了処理の中で親レポートを1回だけ作らせ、終了画面用の say を返す
// （実装仕様3版2章）。レポート作りに失敗しても、子どもの画面は普通に終わらせる。
async function finalizeSession(fallbackSay) {
  const say = await generateReport(fallbackSay);
  await Sessions.setMeta(sessionId, { endedAt: Date.now(), summary: say });
  return say;
}

// 子どもの発言として「今日はここまでにする」を1ターン積み、ask を1回だけ呼んで report を受け取る。
// 同じセッションで二重に呼ばれないよう、session に立てたフラグで防ぐ。
async function generateReport(fallbackSay) {
  if (!session || session._reportRequested) return fallbackSay;
  session._reportRequested = true;
  try {
    await session.pushChild("今日はここまでにする", undefined);
    if (chatController) chatController.setThinking(true);
    const note = practiceSkipped ? `${REPORT_REQUEST} ${PRACTICE_SKIP_NOTE}` : REPORT_REQUEST;
    const reply = await ask({ settings: aiSettings(), session, extraNote: note });
    if (chatController) chatController.setThinking(false);
    await session.pushChuta(reply);
    await maybeSaveSuggestion(reply);
    if (reply.report) {
      await Sessions.setMeta(sessionId, { report: reply.report, reportAt: Date.now() });
    }
    return reply.say || fallbackSay;
  } catch (err) {
    if (chatController) chatController.setThinking(false);
    return fallbackSay; // 保護者画面には report が残らないので「作れませんでした」と出せる
  }
}

async function onStopPressed() {
  const fallback = lastAssistantText() || "また今度、続きをやろう。";
  const say = await finalizeSession(fallback);
  chatController.showEnding({ say, unitName: session.notes && session.notes.unit_name });
}

// 定着の類題（S6）で「あとでやる」を選んだとき。やめるのと同じように終了処理へ入るが、
// 記録に残してから終える（親要望3章）。生成されるレポートにその旨が添えられる（generateReport 参照）。
async function onPracticeSkipPressed() {
  if (!session || !chatController) return;
  practiceSkipped = true;
  await Sessions.setMeta(sessionId, { practiceSkipped: true });
  const fallback = lastAssistantText() || "また今度、続きをやろう。";
  const say = await finalizeSession(fallback);
  chatController.showEnding({ say, unitName: session.notes && session.notes.unit_name });
}

// 「もう少しやる」。今回の呼びかけは流し、行き詰まり回数をリセットして会話を続ける（実装仕様2版5章）。
async function dismissCallParent() {
  if (!session) return;
  session.stuckTurns = 0;
  await Sessions.setMeta(sessionId, { stuckTurns: 0 });
}

// ---------- おうちの人への引き継ぎ ----------

// 子どもの「おうちの人に聞く」、または呼びかけ二択の「おうちの人を呼ぶ」の両方から呼ばれる（実装仕様2版5章）。
async function triggerHandoff() {
  if (!session || !chatController) return;
  chatController.appendChild("おうちの人に聞きたい", null);
  await session.pushChild("おうちの人に聞きたい", undefined);

  chatController.setThinking(true);
  let reply;
  try {
    reply = await ask({ settings: aiSettings(), session, extraNote: HANDOFF_REQUEST });
  } catch (err) {
    chatController.setThinking(false);
    const code = err instanceof AiError ? err.code : undefined;
    chatController.appendChutaText((code && ERROR_MESSAGE[code]) || "うまくつながりませんでした。もう一度ためそう。");
    return;
  }
  chatController.setThinking(false);

  await applyAiReply(reply);
  await saveTurnMeta(reply);
  await Sessions.setMeta(sessionId, { handoff: reply.handoff, handoffAt: Date.now() });

  await showHandoffScreen(reply);
}

async function collectPhotoUrls() {
  const stored = await Sessions.get(sessionId);
  const urls = [];
  for (const entry of (stored && stored.entries) || []) {
    if (entry.who === "child" && entry.image) urls.push(trackUrl(objectUrl(entry.image)));
  }
  return urls;
}

async function showHandoffScreen(reply) {
  const photoUrls = await collectPhotoUrls();
  const noteMissing = !reply.handoff;
  showScreen(handoffEl);
  initHandoff(handoffEl, {
    text: noteMissing ? reply.say : reply.handoff,
    noteMissing,
    photoUrls,
    onTaught: () => resumeAfterHandoff(),
    onFinish: () => finishFromHandoff(),
  });
}

function resumeAfterHandoff() {
  showScreen(chatEl);
  sendTurn({ text: "おうちの人に教えてもらった" });
}

async function finishFromHandoff() {
  const say = lastAssistantText() || "また今度、続きをやろう。";
  await finalizeSession(say);
  await goHome();
}

// ---------- 保護者画面 ----------

function openParent() {
  stopCameraIfAny();
  showScreen(parentEl);
  initParent(parentEl, { onClose: goHome });
}

// ---------- 起動 ----------

setManualHandler(openManualOverlay); // provider が manual のときだけ使われる（手わたし経路・実装仕様5）
setupViewportHeightVar();
mountHome().then(() => showScreen(homeEl));
