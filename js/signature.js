/*
 * signature.js — 서명 사진의 배경을 투명하게 만들고 여백을 잘라 낸다.
 * 모든 처리는 브라우저 안(Canvas)에서만 하고, 서명 사진은 밖으로 보내지 않는다.
 */
(function () {
  "use strict";

  const MAX_SIDE = 1200;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 열 수 없어요."));
      img.src = src;
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // 오츠(Otsu) 방법: 밝기 분포에서 "종이"와 "잉크"를 가르는 기준값을 자동으로 찾는다
  function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = i; }
    }
    return th;
  }

  /**
   * strength: 0~100. 높을수록 연한 부분까지 지운다.
   * 돌려주는 값: { url (PNG dataURL), width, height, ratio }
   */
  async function removeBackground(src, strength = 50) {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;

    // 이미 투명한 PNG 면 배경 제거를 건너뛴다
    let transparent = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transparent++;
    const alreadyClean = transparent > (w * h) / 4;

    if (!alreadyClean) {
      const lum = new Float32Array(w * h);
      const hist = new Array(256).fill(0);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        lum[j] = l;
        hist[l | 0]++;
      }
      const th = otsu(hist, w * h);
      // 기준값 근처를 부드럽게 넘기면 테두리가 자연스럽다
      const shift = (strength - 50) * 0.8;
      const hi = Math.min(250, th + 10 + shift);
      const lo = Math.max(0, hi - 60);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const l = lum[j];
        let a = l >= hi ? 0 : l <= lo ? 1 : (hi - l) / (hi - lo);
        a = Math.pow(a, 0.8);
        // 잉크는 조금 더 진하게
        px[i] = Math.round(px[i] * 0.7);
        px[i + 1] = Math.round(px[i + 1] * 0.7);
        px[i + 2] = Math.round(px[i + 2] * 0.75);
        px[i + 3] = Math.round(a * 255);
      }
      ctx.putImageData(data, 0, 0);
    }

    // 여백 잘라 내기
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[(y * w + x) * 4 + 3] > 40) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) throw new Error("서명을 찾지 못했어요. 흰 종이에 진한 펜으로 쓴 서명을 밝은 곳에서 찍어 주세요.");
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    out.getContext("2d").drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
    return { url: out.toDataURL("image/png"), width: cw, height: ch, ratio: cw / ch };
  }

  function dataUrlToBytes(url) {
    const b64 = url.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  window.Signature = { removeBackground, fileToDataUrl, dataUrlToBytes };
})();
