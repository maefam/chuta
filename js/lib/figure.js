// AIが返す図（SVG）の関門。応答はそのまま画面に入れず、必ずここを通す。
// DOMParser で木をたどり、許可した要素・属性だけを新しく組み直す（文字列の置きかえはしない）。
// 使えない入力は "" を返す。呼び出し側は "" のときは何も表示しない。

const SVG_NS = "http://www.w3.org/2000/svg";

// 許可するタグ（これ以外は中身ごと捨てる）
const ALLOWED_TAGS = new Set(["svg", "g", "line", "circle", "ellipse", "rect", "path", "polyline", "polygon", "text", "tspan"]);

// 中身をテキストとしてだけ残す要素（タグを入れない）
const TEXT_ONLY_TAGS = new Set(["text", "tspan"]);

// 許可する属性名（大文字小文字のゆれを吸収するため、小文字→正式名の対応表にする）
const ALLOWED_ATTR_NAMES = [
  "viewBox",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "text-anchor",
  "font-size",
  "transform",
  "dominant-baseline",
];
const ALLOWED_ATTR_MAP = new Map(ALLOWED_ATTR_NAMES.map((name) => [name.toLowerCase(), name]));

// 数字・小数点・マイナス・空白・カンマだけを許す属性
const NUMERIC_ATTRS = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "stroke-width", "font-size", "stroke-dasharray", "viewBox"]);

const NUMERIC_RE = /^[-0-9.,\s]+$/;
const D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]+$/;
const POINTS_RE = /^[0-9.,\-\s]+$/;
const TRANSFORM_RE = /^(\s*(translate|scale|rotate|matrix)\s*\([-0-9.,\s]*\)\s*)+$/i;
// 危険なパターン（このどれかを含む属性値は丸ごと捨てる）
const DANGEROUS_RE = /(javascript:|url\(|<|&#)/i;

const MAX_ELEMENTS = 200;
const FORCED_VIEWBOX = "0 0 400 240";

// SVG文字列を安全な形にして返す。使えなければ ""。
export function sanitizeSvg(rawInput) {
  let src = rawInput;
  // タグが実体参照（&lt; など）で書かれて届くことがある。そのままでは図として読めないので、
  // 生のタグが1つも無く、実体参照だけがあるときに限って元に戻してから読む。
  if (typeof src === "string" && !src.includes("<") && src.includes("&lt;")) {
    src = src
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  const text = String(src || "").trim();
  if (!text) return "";

  let doc;
  try {
    doc = new DOMParser().parseFromString(text, "image/svg+xml");
  } catch {
    return "";
  }
  if (!doc || doc.getElementsByTagName("parsererror").length > 0) return "";

  const root = doc.documentElement;
  if (!root || root.localName !== "svg") return "";

  // 要素が多すぎると描画が重くなる／固まる恐れがあるのであきらめる
  if (root.querySelectorAll("*").length + 1 > MAX_ELEMENTS) return "";

  const outDoc = document.implementation.createDocument(SVG_NS, "svg", null);
  const outRoot = outDoc.documentElement;
  // 外側は必ずこの viewBox にする。AIが別の値や width/height を書いていても無視する。
  outRoot.setAttribute("viewBox", FORCED_VIEWBOX);

  copyChildren(root, outRoot, outDoc);

  if (!outRoot.hasChildNodes()) return ""; // 中身が残らなければ意味がない

  return new XMLSerializer().serializeToString(outRoot);
}

function copyChildren(srcParent, destParent, outDoc) {
  for (const child of Array.from(srcParent.children)) {
    const built = buildElement(child, outDoc);
    if (built) destParent.appendChild(built);
  }
}

// 許可した要素だけを新しく作って返す。許可しない要素は null（呼び出し側で中身ごと捨てられる）。
function buildElement(srcEl, outDoc) {
  const tag = srcEl.localName;
  if (!ALLOWED_TAGS.has(tag)) return null;

  const el = outDoc.createElementNS(SVG_NS, tag);
  copyAttributes(srcEl, el);

  if (TEXT_ONLY_TAGS.has(tag)) {
    // 文字要素の中身はテキストとしてだけ残す（子要素のタグは入れない）
    const t = srcEl.textContent || "";
    if (t) el.appendChild(outDoc.createTextNode(t));
    return el;
  }

  copyChildren(srcEl, el, outDoc);
  return el;
}

function copyAttributes(srcEl, destEl) {
  for (const attr of Array.from(srcEl.attributes)) {
    const lower = attr.name.toLowerCase();
    // on～、href／xlink:href、style、class、id は必ず捨てる
    if (lower.startsWith("on")) continue;
    if (lower === "href" || lower.endsWith(":href")) continue;
    if (lower === "style" || lower === "class" || lower === "id") continue;

    const canonical = ALLOWED_ATTR_MAP.get(lower);
    if (!canonical) continue; // 許可リストにないものは捨てる

    const value = attr.value;
    if (!isSafeValue(canonical, value)) continue;
    destEl.setAttribute(canonical, value);
  }
}

function isSafeValue(name, value) {
  if (DANGEROUS_RE.test(value)) return false;
  if (name === "d") return D_RE.test(value);
  if (name === "points") return POINTS_RE.test(value);
  if (name === "transform") return TRANSFORM_RE.test(value);
  if (NUMERIC_ATTRS.has(name)) return NUMERIC_RE.test(value);
  // fill, stroke, stroke-linecap, stroke-linejoin, text-anchor, dominant-baseline は
  // 色名・キーワードなので、上の危険パターンの確認だけで通す。
  return true;
}
