// AIが `漢字《かんじ》` の形で書くふりがなを <ruby> タグに変換する。
// 会話の吹き出し、まとめ、類題の文、引き継ぎ画面の本文など、AIの出力をHTMLとして
// 表示するすべての場所でこの toRubyHtml を通すこと。生の文字列を innerHTML に直接入れてはいけない。

const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

// 「漢字」の直前にあるときだけルビ化の対象にする文字の範囲。
// CJK統合漢字、拡張A、々〆〇々のくり返し記号を含む。
const KANJI_RUN = "[\\u4E00-\\u9FFF\\u3400-\\u4DBF\\u3005\\u3006\\u3007\\u303B]+";
// 《読み》の中に《や》を含まない範囲だけを読みとして受け取る。
const RUBY_RE = new RegExp(`(${KANJI_RUN})《([^《》]*)》`, "g");

// HTMLエスケープしてから《》をルビに変換する。閉じがない、直前に漢字がないなど
// 対応しない《》はそのまま文字として残る（すでにエスケープ済みなので実行はされない）。
export function toRubyHtml(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(RUBY_RE, (whole, kanji, reading) => {
    if (!reading) return whole; // 読みが空のものは変換しない
    return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
  });
}

// 《読み》を取り除いた素のテキストを返す（レポートの送信やログ、保護者への平文用）。
// 漢字そのものは残す。
export function stripRuby(text) {
  return String(text ?? "").replace(RUBY_RE, "$1");
}
