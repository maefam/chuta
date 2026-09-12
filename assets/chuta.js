// ちゅーた先生のキャラクター。手描きのインラインSVGを文字列として持つ。
// viewBoxで統一しているので、使う側はCSSで width/height を指定して拡縮する。
// 表情は4種。ふつう、考え中、ほめる、はげます。
// 顔の各部は、頭の輪郭の中心（cy=94）に目の高さがくるように置いている。
// 体は肩が見える分だけ。viewBox は絵の実寸に合わせて上下を詰めてある。

const C = {
  head: "#dcc4a8", // 顔
  ear: "#cdb999", // 耳の外
  earIn: "#e8a390", // 耳の中
  muzzle: "#f6ece0", // 口のまわり
  line: "#7a5a3f", // 眼鏡・鼻・口の線（茶）
  pupil: "#4a3628", // 黒目（茶寄り）
  whisker: "#a98f68", // ひげ
  cloth: "#7fa393", // 作務衣（淡い緑）
  lens: "#fdfbf7", // レンズ
};

// 耳と体は頭より先に描く（頭が上に重なって、首のすきまが出ないようにする）。
const BASE = `
  <circle cx="72" cy="54" r="17" fill="${C.ear}"/>
  <circle cx="72" cy="54" r="8.5" fill="${C.earIn}"/>
  <circle cx="128" cy="54" r="17" fill="${C.ear}"/>
  <circle cx="128" cy="54" r="8.5" fill="${C.earIn}"/>
  <path d="M54,146 Q54,120 100,120 Q146,120 146,146 Z" fill="${C.cloth}"/>
  <ellipse cx="100" cy="94" rx="38" ry="35" fill="${C.head}"/>
  <ellipse cx="100" cy="113" rx="17" ry="11" fill="${C.muzzle}"/>
  <ellipse cx="100" cy="106" rx="5" ry="3.6" fill="${C.line}"/>
  <path d="M84,112 L56,107 M84,116 L56,120 M116,112 L144,107 M116,116 L144,120"
        stroke="${C.whisker}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
`;

// 眼鏡のわく（レンズの中身は表情ごとに描く）
const GLASSES = `
  <circle cx="86" cy="94" r="12" fill="${C.lens}" stroke="${C.line}" stroke-width="2.6"/>
  <circle cx="114" cy="94" r="12" fill="${C.lens}" stroke="${C.line}" stroke-width="2.6"/>
  <path d="M98,94 L102,94" stroke="${C.line}" stroke-width="2.6"/>
  <path d="M74,92 L63,88 M126,92 L137,88" stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
`;

function svg(inner) {
  return `<svg viewBox="0 30 200 122" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ちゅーた先生">${BASE}${inner}</svg>`;
}

// ふつう。まっすぐ見て、口はわずかに上がる。
const normal = svg(`
  ${GLASSES}
  <circle cx="86" cy="94" r="3.6" fill="${C.pupil}"/>
  <circle cx="114" cy="94" r="3.6" fill="${C.pupil}"/>
  <path d="M93,121 Q100,126 107,121" stroke="${C.line}" stroke-width="2" fill="none" stroke-linecap="round"/>
`);

// 考え中。目線を上にやり、まゆを寄せ、口は結ぶ。右上に点を3つ。
const thinking = svg(`
  ${GLASSES}
  <circle cx="84" cy="90" r="3.6" fill="${C.pupil}"/>
  <circle cx="112" cy="90" r="3.6" fill="${C.pupil}"/>
  <path d="M76,76 Q86,72 95,75 M124,76 Q114,72 105,75"
        stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M94,122 L108,122" stroke="${C.line}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="152" cy="68" r="3" fill="${C.whisker}"/>
  <circle cx="163" cy="58" r="4" fill="${C.whisker}"/>
  <circle cx="176" cy="45" r="5.5" fill="${C.whisker}"/>
`);

// ほめる。目を細めて笑い、口を大きく開く。
const praise = svg(`
  ${GLASSES}
  <path d="M79,97 Q86,87 93,97" stroke="${C.pupil}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M107,97 Q114,87 121,97" stroke="${C.pupil}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M89,117 Q100,129 111,117" stroke="${C.line}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <path d="M46,82 L38,74 M46,94 L36,94 M154,82 L162,74 M154,94 L164,94"
        stroke="${C.cloth}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
`);

// はげます。まゆを上げてやわらかく笑い、手を上げる。
const encourage = svg(`
  <path d="M136,142 L154,122" stroke="${C.cloth}" stroke-width="13" fill="none" stroke-linecap="round"/>
  <circle cx="157" cy="118" r="9" fill="${C.head}"/>
  ${GLASSES}
  <circle cx="86" cy="92" r="3.6" fill="${C.pupil}"/>
  <circle cx="114" cy="92" r="3.6" fill="${C.pupil}"/>
  <path d="M76,74 Q86,69 95,73 M124,74 Q114,69 105,73"
        stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M91,119 Q100,128 109,119" stroke="${C.line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
`);

export const CHUTA = { normal, thinking, praise, encourage };
