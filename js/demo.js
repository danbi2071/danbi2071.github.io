/*
 * demo.js — 샘플 데모: 빈 양식에 글자가 써지고, 서명과 도장이 찍히는 모습
 */
(function () {
  "use strict";

  const paper = document.getElementById("demo-paper");
  if (!paper) return;
  const cells = Array.from(paper.querySelectorAll("td[data-demo]"));
  const tabs = Array.from(document.querySelectorAll("[data-demo-view]"));
  const playBtn = document.getElementById("demo-play");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let runId = 0;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function setTab(view) {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.demoView === view)));
  }

  function showBefore() {
    runId++;
    paper.classList.remove("is-after", "signing", "stamping");
    cells.forEach((td) => { td.dataset.shown = ""; td.classList.remove("typing", "hl"); });
    setTab("before");
  }

  function showAfter() {
    runId++;
    paper.classList.remove("signing", "stamping");
    paper.classList.add("is-after");
    cells.forEach((td) => { td.dataset.shown = td.dataset.demo; td.classList.remove("typing"); td.classList.add("hl"); });
    setTab("after");
  }

  async function play() {
    if (reduce) return showAfter();
    showBefore();
    const id = runId;
    setTab("after");
    playBtn.disabled = true;
    try {
      await wait(300);
      for (const td of cells) {
        if (id !== runId) return;
        td.classList.add("typing", "hl");
        const text = td.dataset.demo;
        for (let i = 1; i <= text.length; i++) {
          if (id !== runId) return;
          td.dataset.shown = text.slice(0, i);
          await wait(38);
        }
        td.classList.remove("typing");
        await wait(120);
      }
      if (id !== runId) return;
      paper.classList.add("signing");
      await wait(1200);
      if (id !== runId) return;
      paper.classList.add("stamping", "is-after");
    } finally {
      playBtn.disabled = false;
    }
  }

  tabs.forEach((t) => t.addEventListener("click", () => (t.dataset.demoView === "after" ? showAfter() : showBefore())));
  playBtn.addEventListener("click", play);

  // 히어로의 "샘플 데모 보기" → 데모로 내려가서 재생
  document.querySelectorAll("[data-play-demo]").forEach((a) =>
    a.addEventListener("click", () => setTimeout(play, reduce ? 0 : 450))
  );

  showBefore();
})();
