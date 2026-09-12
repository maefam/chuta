// 撮影画面。getUserMedia のプレビュー→シャッター→四隅ドラッグの切り取り。
// カメラが使えない環境では <input type="file" capture="environment"> に落とす。
import { grabFrame, shrink, crop, objectUrl } from "../lib/image.js";
import { CHUTA } from "../../assets/chuta.js";

const MIN_CROP = 0.15;

// ctx = { onCaptured(finalBlob), onCancel() }
// 戻り値: { stop() } カメラストリームを止める（画面を離れるとき呼ぶ）
export function initCamera(root, ctx) {
  let stream = null;
  let capturedBlob = null;
  let capturedUrl = null;

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function cleanupUrl() {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      capturedUrl = null;
    }
  }

  function cancel() {
    stopStream();
    cleanupUrl();
    ctx.onCancel();
  }

  async function finish(finalBlob) {
    stopStream();
    cleanupUrl();
    ctx.onCaptured(finalBlob);
  }

  renderLiveShell();
  startCamera();

  return { stop: stopStream };

  // ---- 描画 ----

  function renderLiveShell() {
    root.innerHTML = `
      <div class="camera">
        <div class="camera__top">
          <button class="btn-text" type="button" data-act="cancel" style="color:#fff;">もどる</button>
          <span></span>
        </div>
        <p class="camera__reason" data-el="reason" hidden></p>
        <div class="camera__stage" data-el="stage">
          <video class="camera__video" data-el="video" autoplay playsinline muted></video>
          <div class="camera__guide"></div>
        </div>
        <div class="camera__bottom">
          <button class="camera__shutter" type="button" data-act="shutter" aria-label="しゃしんをとる"></button>
        </div>
      </div>
    `;
    root.querySelector('[data-act="cancel"]').addEventListener("click", cancel);
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallbackToFile("このタブレットではカメラが使えません。");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = root.querySelector('[data-el="video"]');
      if (!video) return; // 画面がすでに切り替わっていたら何もしない
      video.srcObject = stream;
      const shutter = root.querySelector('[data-act="shutter"]');
      shutter.addEventListener("click", onShutter);
    } catch (err) {
      const reason =
        err && err.name === "NotAllowedError"
          ? "カメラの使用が許されなかったので、写真を選ぶ方法に切りかえました。"
          : "カメラが使えなかったので、写真を選ぶ方法に切りかえました。";
      fallbackToFile(reason);
    }
  }

  async function onShutter() {
    const video = root.querySelector('[data-el="video"]');
    if (!video) return;
    const blob = await grabFrame(video);
    stopStream();
    showCropPreview(blob);
  }

  function fallbackToFile(reason) {
    root.innerHTML = `
      <div class="camera">
        <div class="camera__top">
          <button class="btn-text" type="button" data-act="cancel" style="color:#fff;">もどる</button>
          <span></span>
        </div>
        <p class="camera__reason" data-el="reason">${reason}</p>
        <div class="camera__file-fallback">
          <div class="home__character" style="width:140px;">${CHUTA.encourage}</div>
          <label class="btn-primary" style="display:flex;align-items:center;justify-content:center;width:100%;max-width:420px;">
            写真をえらぶ
            <input type="file" accept="image/*" capture="environment" data-el="file-input" style="display:none;" />
          </label>
        </div>
      </div>
    `;
    root.querySelector('[data-act="cancel"]').addEventListener("click", cancel);
    const input = root.querySelector('[data-el="file-input"]');
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) showCropPreview(file);
    });
  }

  function showCropPreview(blob) {
    capturedBlob = blob;
    cleanupUrl();
    capturedUrl = objectUrl(blob);

    root.innerHTML = `
      <div class="camera">
        <div class="camera__top">
          <button class="btn-text" type="button" data-act="cancel" style="color:#fff;">もどる</button>
          <span style="color:#fff;font-size:0.9rem;">四すみを引っぱって切り取れます</span>
        </div>
        <div class="camera__stage" data-el="stage">
          <div class="camera__crop-frame" data-el="frame" style="position:relative;">
            <img class="camera__still" data-el="img" src="${capturedUrl}" />
            <div class="camera__crop-box" data-el="cropbox">
              <div class="camera__handle camera__handle--nw" data-handle="nw"></div>
              <div class="camera__handle camera__handle--ne" data-handle="ne"></div>
              <div class="camera__handle camera__handle--sw" data-handle="sw"></div>
              <div class="camera__handle camera__handle--se" data-handle="se"></div>
            </div>
          </div>
        </div>
        <div class="camera__confirm-row">
          <button class="btn-secondary" type="button" data-act="retake">とりなおす</button>
          <button class="btn-primary" type="button" data-act="ok">これでいい</button>
        </div>
      </div>
    `;
    root.querySelector('[data-act="cancel"]').addEventListener("click", cancel);
    root.querySelector('[data-act="retake"]').addEventListener("click", () => {
      cleanupUrl();
      renderLiveShell();
      startCamera();
    });

    const img = root.querySelector('[data-el="img"]');
    const rectState = { left: 0.08, top: 0.08, right: 0.92, bottom: 0.92 };

    const setup = () => {
      const frame = root.querySelector('[data-el="frame"]');
      const stage = root.querySelector('[data-el="stage"]');
      const naturalW = img.naturalWidth || 1;
      const naturalH = img.naturalHeight || 1;
      const stageRect = stage.getBoundingClientRect();
      const scale = Math.min(stageRect.width / naturalW, stageRect.height / naturalH);
      const frameW = naturalW * scale;
      const frameH = naturalH * scale;
      frame.style.width = frameW + "px";
      frame.style.height = frameH + "px";

      const cropBox = root.querySelector('[data-el="cropbox"]');
      renderCropBox();

      function renderCropBox() {
        cropBox.style.left = rectState.left * frameW + "px";
        cropBox.style.top = rectState.top * frameH + "px";
        cropBox.style.width = (rectState.right - rectState.left) * frameW + "px";
        cropBox.style.height = (rectState.bottom - rectState.top) * frameH + "px";
      }

      function dragHandle(handleName, ev) {
        ev.preventDefault();
        const pointerId = ev.pointerId;
        ev.target.setPointerCapture(pointerId);

        const move = (moveEv) => {
          const fRect = frame.getBoundingClientRect();
          let fx = (moveEv.clientX - fRect.left) / fRect.width;
          let fy = (moveEv.clientY - fRect.top) / fRect.height;
          fx = Math.min(1, Math.max(0, fx));
          fy = Math.min(1, Math.max(0, fy));

          if (handleName === "nw") {
            rectState.left = Math.min(fx, rectState.right - MIN_CROP);
            rectState.top = Math.min(fy, rectState.bottom - MIN_CROP);
          } else if (handleName === "ne") {
            rectState.right = Math.max(fx, rectState.left + MIN_CROP);
            rectState.top = Math.min(fy, rectState.bottom - MIN_CROP);
          } else if (handleName === "sw") {
            rectState.left = Math.min(fx, rectState.right - MIN_CROP);
            rectState.bottom = Math.max(fy, rectState.top + MIN_CROP);
          } else if (handleName === "se") {
            rectState.right = Math.max(fx, rectState.left + MIN_CROP);
            rectState.bottom = Math.max(fy, rectState.top + MIN_CROP);
          }
          renderCropBox();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      cropBox.querySelectorAll("[data-handle]").forEach((el) => {
        el.addEventListener("pointerdown", (ev) => dragHandle(el.dataset.handle, ev));
      });
    };

    if (img.complete && img.naturalWidth) {
      setup();
    } else {
      img.addEventListener("load", setup, { once: true });
    }

    root.querySelector('[data-act="ok"]').addEventListener("click", async () => {
      const rect = {
        x: rectState.left,
        y: rectState.top,
        w: rectState.right - rectState.left,
        h: rectState.bottom - rectState.top,
      };
      const croppedBlob = await crop(capturedBlob, rect);
      const finalBlob = await shrink(croppedBlob, 1600);
      finish(finalBlob);
    });
  }
}
