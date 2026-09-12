// AIがうっかりLaTeX風の書き方をしたときの受け皿。表示の直前に素の日本語テキストへ直す。
// 使うときは必ず toRubyHtml(toPlainMath(text)) の順で通すこと（逆だとタグが壊れる）。
// 変換して意味が変わる可能性がある書き方は、無理に変換せずそのまま残す。

// \dfrac{a}{b} と \frac{a}{b} をまとめて a/b に直す（入れ子の {} は対象にしない）
const FRAC_RE = /\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g;
// \sqrt{a} を √a に直す
const SQRT_RE = /\\sqrt\{([^{}]*)\}/g;

export function toPlainMath(text) {
  if (!text) return text;
  let s = String(text);

  // 全角＄は半角の＄と同じ扱いにする
  s = s.replace(/＄/g, "$");

  // \left \right は削除（後ろに続く括弧はそのまま残る）
  s = s.replace(/\\left/g, "").replace(/\\right/g, "");

  // 分数・根号
  s = s.replace(FRAC_RE, "$1/$2");
  s = s.replace(SQRT_RE, "√$1");

  // 記号
  s = s.replace(/\\times/g, "×");
  s = s.replace(/\\div/g, "÷");
  s = s.replace(/\\cdot/g, "×");
  s = s.replace(/\\pi/g, "π");
  s = s.replace(/\\%/g, "%");

  // 2乗・3乗だけを上付き文字にする。それ以外の指数は意味を変えないためそのまま残す。
  s = s.replace(/\^\{2\}/g, "²").replace(/\^2\b/g, "²");
  s = s.replace(/\^\{3\}/g, "³").replace(/\^3\b/g, "³");

  // 下付きは中身だけ残す（_{1} や _1 の形）
  s = s.replace(/_\{([^{}]*)\}/g, "$1");
  s = s.replace(/_([0-9A-Za-z])/g, "$1");

  // 数式の囲みを外し、中身だけ残す（$$より先に処理する）
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, "$1");
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, "$1");
  s = s.replace(/\$([^$]*)\$/g, "$1");

  // 残った \コマンド は円記号だけ落として語をそのまま残す
  s = s.replace(/\\([A-Za-z]+)/g, "$1");
  s = s.replace(/\\/g, "");

  return s;
}
