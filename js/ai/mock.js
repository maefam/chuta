// キーなしで第2・第3段階の流れを全部確かめるための偽プロバイダ。
// session.phase / session.hintLevel / session.practiceDone / session.practiceTotal を見て、
// S1→S2→S3（hint_levelを1→2→3）→S4（類題での解説）→S5（答え合わせ、1回はわざとphotoを促す）
// →S6（類題2〜5問）→S7 と進む。途中で1回だけ call_parent:true を返す。
// extraNote に HANDOFF_REQUEST が渡されたときは、handoff に親向けのメモを入れて返す。
// extraNote に REPORT_REQUEST が渡されたときは、report に親向けのレポートを入れて返す。
// S7に進むターンでは knowledge_suggestion に追記案を1〜2行入れる。
// どこかの発言に1つだけ「漢字《かんじ》」形式のふりがなを混ぜる（S4の発言）。
// 0.6秒ほど待ってから返す。
// usage は実際のAPI呼び出しがないので常に0（実装仕様4 第4章）。

import { HANDOFF_REQUEST, REPORT_REQUEST } from "./prompt.js";

const BASE_NOTES = {
  subject: "算数",
  unit_name: "わり算",
  problem: "48個のあめを6人で同じ数ずつ分けると、1人分は何個か。",
  answer: "8",
  prereq: ["九九"],
};

export async function ask({ settings, session, extraNote }) {
  const reply = await buildReply({ settings, session, extraNote });
  return { reply, usage: { inputTokens: 0, outputTokens: 0 } };
}

async function buildReply({ settings, session, extraNote }) {
  await wait(600);

  if (extraNote === HANDOFF_REQUEST) {
    return buildHandoff(session);
  }

  if (extraNote === REPORT_REQUEST) {
    return buildReport(session);
  }

  const phase = session.phase;
  const hintLevel = session.hintLevel;

  if (phase === "S1") {
    return step({
      phase: "S2",
      hint_level: 0,
      expect: "choice",
      say: "写真を見せてくれてありがとう。まず、この問題が何を聞いているか、いっしょに見てみよう。どこまで分かったかな。",
      choices: ["問題は読めた", "まだよくわからない"],
    });
  }

  if (phase === "S2") {
    return step({
      phase: "S3",
      hint_level: 0,
      expect: "number",
      unit: "個",
      say: "ちょっと寄り道していいかな。まずは簡単な確認をしよう。12個のあめを3人で同じ数ずつ分けると、1人分は何個になる?",
      diagnosis: "わり算の意味はつかめている",
    });
  }

  if (phase === "S3") {
    if (hintLevel < 1) {
      return step({
        phase: "S3",
        hint_level: 1,
        expect: "choice",
        say: "いいね、その調子。もとの問題にもどろう。まずは「全部の数」と「分ける人数」がどこに書いてあるか、指でさしてみよう。",
        choices: ["させた", "どこかわからない"],
        diagnosis: "式の立て方でつまずいている",
      });
    }
    if (hintLevel < 2) {
      // 途中で1回だけ、行きづまりを想定して call_parent を立てる
      const callParent = !session._mockAskedParent;
      if (callParent) session._mockAskedParent = true;
      return step({
        phase: "S3",
        hint_level: 2,
        expect: "choice",
        say: "そこまで見つかればじゅうぶんだよ。全部の数を、分ける人数で分けるとどうなるか、図か表に書いてみよう。",
        choices: ["書いてみた", "まだ迷う"],
        diagnosis: "式の立て方でつまずいている",
        call_parent: callParent,
      });
    }
    return step({
      phase: "S4",
      hint_level: 3,
      expect: "choice",
      say: "じゃあ、いっしょに最初の一手だけやってみよう。全部の数を分ける人数で割る式を、いっしょに書いてみるよ。",
      choices: ["わかった"],
      diagnosis: "式の立て方でつまずいている",
      error_type: "式が立てられない",
    });
  }

  if (phase === "S4") {
    return step({
      phase: "S5",
      hint_level: 3,
      expect: "photo",
      say: "似た問題で工夫《くふう》のしかたを確かめよう。12個のあめを3人で分けると1人4個だね。同じやり方で、もとの問題もやってみて。どうやって計算したか見せてくれる?",
    });
  }

  if (phase === "S5") {
    // 1回はわざと写真を促す（式のまちがいを確かめる想定）
    if (!session._mockPhotoAsked) {
      session._mockPhotoAsked = true;
      return step({
        phase: "S5",
        hint_level: 3,
        expect: "photo",
        say: "なるほど。じゃあ、ここまでの計算をノートに書いて見せてくれるかな。",
        error_type: "くり上がりのまちがい",
      });
    }
    return step({
      phase: "S6",
      hint_level: 3,
      expect: "number",
      unit: "個",
      say: "なるほど。じゃあ、ここまでは合っているね。同じやり方で、もう1問やってみよう。63個のあめを7人で同じ数ずつ分けると、1人分は何個かな。",
      problem: "63個のあめを7人で同じ数ずつ分けると、1人分は何個か。",
      answer: "9",
    });
  }

  if (phase === "S6") {
    const practiceDone = session.practiceDone || 0;
    const practiceTotal = session.practiceTotal || 3;
    if (practiceDone < practiceTotal) {
      // 1問目はS5→S6の遷移時にすでに出題済みなので、2問目からここで作る
      const idx = practiceDone + 2;
      const divisor = idx + 4;
      const quotient = idx + 1;
      const total = divisor * quotient;
      return step({
        phase: "S6",
        hint_level: 3,
        expect: "number",
        unit: "個",
        say: `よくできました。もう1問いってみよう。${total}個のあめを${divisor}人で同じ数ずつ分けると、1人分は何個かな。`,
        problem: `${total}個のあめを${divisor}人で同じ数ずつ分けると、1人分は何個か。`,
        answer: String(quotient),
      });
    }
    return step({
      phase: "S7",
      hint_level: 3,
      expect: "none",
      done: true,
      say: "今日はわり算の意味と使い方が分かるようになったね。次に似た問題が出たら、全部の数と分ける人数がどこにあるかをまず探してみよう。",
      problem: "",
      answer: "",
      prereq: [],
      knowledge_suggestion:
        "わり算の文章題でつまずく子には、先に「全部の数」と「分ける人数」を指でさす練習をさせると式が立てやすい。\n" +
        "数を易しくした類題を1つはさむと、もとの問題の式に自分で気づきやすい。",
    });
  }

  // S7 に入ったあとに呼ばれた場合はそのまま終了を返す
  return step({
    phase: "S7",
    hint_level: hintLevel,
    expect: "none",
    done: true,
    say: "今日はよくがんばったね。また分からない問題があったら見せてね。",
    problem: "",
    answer: "",
    prereq: [],
  });
}

// 応答オブジェクトを組み立てる。渡されなかった項目は既定値かBASE_NOTESで埋める。
function step(o) {
  return {
    say: o.say,
    choices: o.choices || [],
    expect: o.expect,
    unit: o.unit || "",
    phase: o.phase,
    hint_level: o.hint_level,
    done: o.done || false,
    handoff: "",
    call_parent: o.call_parent || false,
    report: "",
    knowledge_suggestion: o.knowledge_suggestion || "",
    notes: {
      subject: BASE_NOTES.subject,
      unit_name: BASE_NOTES.unit_name,
      problem: o.problem !== undefined ? o.problem : BASE_NOTES.problem,
      answer: o.answer !== undefined ? o.answer : BASE_NOTES.answer,
      prereq: o.prereq !== undefined ? o.prereq : BASE_NOTES.prereq,
      diagnosis: o.diagnosis || "",
      error_type: o.error_type || "",
    },
  };
}

// おうちの人への引き継ぎメモを求められたときの返事（実装仕様2 第5章・第9章）
function buildHandoff(session) {
  const handoff = [
    "算数のわり算の文章題に取り組んでいます。",
    "「全部の数」と「分ける人数」を見つけるところまでは自分で進められました。",
    "式を立てるところで手が止まっていて、ヒントを3段階まで出しています。",
    "数を易しくした類題を見せましたが、まだもとの問題にはもどれていません。",
    "次は、全部の数を分ける人数で割る式を、いっしょに1回書いてみると進みやすいと思います。",
  ].join("\n");

  return {
    say: "そうだね、ここは一度おうちの人に聞いてみようか。",
    choices: [],
    expect: "none",
    unit: "",
    phase: session.phase,
    hint_level: session.hintLevel,
    done: false,
    handoff,
    call_parent: false,
    report: "",
    knowledge_suggestion: "",
    notes: {
      subject: BASE_NOTES.subject,
      unit_name: BASE_NOTES.unit_name,
      problem: BASE_NOTES.problem,
      answer: BASE_NOTES.answer,
      prereq: BASE_NOTES.prereq,
      diagnosis: "式の立て方でつまずいている",
      error_type: "",
    },
  };
}

// おうちの人へのレポートを求められたときの返事（実装仕様3 第2章・第5章）
function buildReport(session) {
  const report = [
    `単元：${BASE_NOTES.subject}・${BASE_NOTES.unit_name}`,
    "きょうは「わり算の文章題」に取り組みました。",
    "全部の数と分ける人数を見つけるところまでは自分で進められました。",
    "式を立てるところで手が止まり、ヒントを3段階まで出しました。",
    "数を易しくした類題を見せたあと、もとの問題の式に自分で気づけました。",
    "答え合わせのあと、定着の類題にも取り組み、最後まで解き切りました。",
    "まちがいの型：くり上がりの計算まちがいが1回ありました。",
    "同じまちがいが続くようなら、くり上がりのある計算を少し多めに練習させてください。",
    "式を立てる前に「全部の数」と「分ける人数」を指でさす習慣がついてきています。",
    "つぎは、似た問題を自分で探して解いてみると、さらに定着すると思います。",
  ].join("\n");

  return {
    say: "きょうはわり算の文章題、最後までよくがんばったね。今日のことをおうちの人にも伝えておくね。",
    choices: [],
    expect: "none",
    unit: "",
    phase: session.phase,
    hint_level: session.hintLevel,
    done: true,
    handoff: "",
    call_parent: false,
    report,
    knowledge_suggestion: "",
    notes: {
      subject: BASE_NOTES.subject,
      unit_name: BASE_NOTES.unit_name,
      problem: BASE_NOTES.problem,
      answer: BASE_NOTES.answer,
      prereq: BASE_NOTES.prereq,
      diagnosis: "式の立て方でつまずいたが、類題を経て自力で式を立てられた",
      error_type: "",
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
