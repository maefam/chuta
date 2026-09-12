// 画像の縮小・切り取り・base64化。写真のExif回転指定は、読みこむ時点で向きを直しておく。

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
  const src = await loadImageSource(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(src.image, 0, 0, w, h);
    return blobFromCanvas(canvas);
  } finally {
    src.release();
  }
}

// rect:{x,y,w,h} は 0..1 の相対値。その範囲だけ切り出す
export async function crop(blob, rect) {
  const src = await loadImageSource(blob);
  try {
    const sx = rect.x * src.width;
    const sy = rect.y * src.height;
    const sw = rect.w * src.width;
    const sh = rect.h * src.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(src.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return blobFromCanvas(canvas);
  } finally {
    src.release();
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

// 写真の向き（Exifの回転指定）を直したうえで画像を読みこむ。
// createImageBitmap が使える環境では imageOrientation:"from-image" で向きを直す。
// 使えない環境ではこれまでどおり Image 要素を使う（向きは直らないが、機能は止めない）。
async function loadImageSource(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 対応していない形式・環境のときは Image 経由に落とす
    }
  }
  const img = await blobToImage(blob);
  return { image: img, width: img.width, height: img.height, release: () => releaseImage(img) };
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
