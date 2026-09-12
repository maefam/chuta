// 答え合わせ（実装仕様2 第3章）。
// 数値の正誤はアプリが決める。AIの気分で揺れないようにするため。
// judge が modelRaw（AIの見立てた正解）を読めないときは、絶対に安易な 'incorrect' を返さない。

// 全角の英数記号（！-～ の範囲）を半角にする。数字・小数点・カンマ・スラッシュもここに含まれる。
function toHalfWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 全角→半角、空白とカンマの除去、末尾の単位らしき文字の除去
export function normalize(s) {
  if (s == null) return "";
  let t = toHalfWidth(String(s)).trim();
  t = t.replace(/\s+/g, "");
  t = t.replace(/,/g, "");
  // 数字を含むときだけ、末尾に続く単位らしき文字（cm、円、個など）を落とす。
  // 数字を含まない答え（言葉での答え）まで削ってしまわないようにする。
  if (/\d/.test(t)) {
    t = t.replace(/[^0-9.\/-]+$/u, "");
  }
  return t;
}

// 数値化 => number | null
// 整数・小数・分数（3/4）・帯分数（1 2/3 / 1と2/3）・全角数字・カンマ区切り・前後の空白・
// 末尾の単位（cm、円、個、人、g、mLなど）を読める。読めなければ null。
export function toNumber(s) {
  if (s == null) return null;
  let t = toHalfWidth(String(s)).trim();
  t = t.replace(/,/g, "");
  if (t === "") return null;

  // 読み取ったあとに別の数字が残っていたら、答えではなく文だとみて読めない扱いにする
  const restHasDigit = (mm) => /\d/.test(t.slice(mm[0].length));

  // 帯分数「1と2/3」
  let m = t.match(/^(-?\d+)\s*と\s*(\d+)\s*\/\s*(\d+)/);
  if (m) return restHasDigit(m) ? null : mixedToNumber(m[1], m[2], m[3]);

  // 帯分数「1 2/3」（空白区切り）
  m = t.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (m) return restHasDigit(m) ? null : mixedToNumber(m[1], m[2], m[3]);

  // 分数「3/4」
  m = t.match(/^(-?\d+)\s*\/\s*(\d+)/);
  if (m) {
    if (restHasDigit(m)) return null;
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!den) return null;
    return num / den;
  }

  // 整数・小数（末尾に単位が続いていてもよい。先頭から読める分だけ使う）
  m = t.match(/^-?\d+(\.\d+)?/);
  if (m) {
    if (restHasDigit(m)) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function mixedToNumber(whole, num, den) {
  const w = Number(whole);
  const n = Number(num);
  const d = Number(den);
  if (!d) return null;
  const sign = w < 0 ? -1 : 1;
  return w + sign * (n / d);
}

function relativelyEqual(a, b) {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale <= 1e-9;
}

// => 'correct' | 'incorrect' | 'unknown'
// 両方が数値になれば相対誤差1e-9で比べる。modelRawが数値にならなければ正規化した文字列どうしで比べ、
// それでも判断がつかなければ 'unknown' を返す。modelRawが読めないときに 'incorrect' を返してはいけない。
export function judge(childRaw, modelRaw) {
  const modelNum = toNumber(modelRaw);
  const childNum = toNumber(childRaw);
  if (modelNum != null && childNum != null) {
    return relativelyEqual(childNum, modelNum) ? "correct" : "incorrect";
  }

  // 子どもは数で答えたのに、正解が数として読めない。
  // ここで文字列どうしを比べると、ほぼ確実に「まちがい」と出てしまうので判断を渡す。
  if (modelNum == null && childNum != null) return "unknown";

  const modelNorm = normalize(modelRaw);
  const childNorm = normalize(childRaw);
  if (modelNorm === "" || childNorm === "") return "unknown"; // 正解・答えのどちらかが読めない
  return childNorm === modelNorm ? "correct" : "incorrect";
}
