// 画像の縮小・切り取り・base64化。EXIFの回転補正はしない（第1段階では不要）。

// ビデオ要素の現在のフレームを1枚のJPEG Blobにする
export async function grabFrame(videoEl) {
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return blobFromCanvas(canvas);
}

// 長辺が maxEdge を超えないように縮小する
export async function shrink(blob, maxEdge = 1600) {
  const img = await blobToImage(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return blobFromCanvas(canvas);
  } finally {
    releaseImage(img);
  }
}

// rect:{x,y,w,h} は 0..1 の相対値。その範囲だけ切り出す
export async function crop(blob, rect) {
  const img = await blobToImage(blob);
  try {
    const sx = rect.x * img.width;
    const sy = rect.y * img.height;
    const sw = rect.w * img.width;
    const sh = rect.h * img.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return blobFromCanvas(canvas);
  } finally {
    releaseImage(img);
  }
}

// Blob を {base64, mediaType} にする（AIへの送信用）
export async function toBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mediaType = head.slice(head.indexOf(":") + 1, head.indexOf(";"));
  return { base64, mediaType };
}

// 表示用の一時URL。解放（URL.revokeObjectURL）はUI側の責任
export function objectUrl(blob) {
  return URL.createObjectURL(blob);
}

// ---- 内部ヘルパ ----

function blobFromCanvas(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      img._chutaUrl = url;
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function releaseImage(img) {
  if (img._chutaUrl) URL.revokeObjectURL(img._chutaUrl);
}
