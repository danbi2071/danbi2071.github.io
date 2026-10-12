/*
 * minutes-app.js — 회의록 정리 화면: 쓰기 → 회의 정보 → 정리 확인 → 받기
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TYPES = [
    ["discuss", "논의"],
    ["decide", "결정"],
    ["task", "할 일"],
    ["issue", "이슈"],
    ["skip", "빼기"],
  ];
  const META_KEYS = ["title", "date", "place", "attendees", "writer"];

  const SAMPLE = `10월 12일 강사 운영 회의
참석: 김팀장, 이매니저, 홍길동 강사
장소: 3층 회의실

이번 생성형 AI 교육 반응이 엄청 좋았어요. 근데 실습 시간이 좀 부족하다는 얘기가 많았음
다음 기수부터 실습 시간을 30분 늘리기로 했어요
교재는 김팀장님이 10월 15일까지 최종본 공유해 주시기로 함
수강생 설문 링크는 이매니저가 이번 주 금요일까지 보낼게요
강사료 서류는 홍길동 강사가 10/20까지 제출해야 함
프로젝터가 자주 꺼지는 문제가 있어서 시설팀에 수리 요청해야 할 것 같아요
수강생들이 자료를 미리 받으면 좋겠어요
다음 회의는 10월 26일에 하기로 결정`;

  const state = {
    analysis: null,
    overrides: new Map(), // 원래 문장 → 사용자가 고친 값 (다시 정리해도 유지)
    metaEdited: new Set(),
  };

  // ---------- 알림 (app.js 의 toast 와 같은 요소를 쓴다) ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }
  const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- 정리 ----------
  function items() {
    if (!state.analysis) return [];
    return state.analysis.items.map((it) => ({ ...it, ...(state.overrides.get(it.raw) || {}) }));
  }

  function report() {
    const v = {};
    META_KEYS.forEach((k) => (v[k] = $("m-" + k).value.trim()));
    const today = Minutes.fmtDate(new Date(), true);
    return {
      title: v.title,
      written: `작성일 ${today}${v.writer ? ` · 작성자 ${v.writer}` : ""}`,
      date: v.date,
      place: v.place,
      attendees: v.attendees,
      items: items().filter((it) => it.type !== "skip"),
    };
  }

  function fillMeta() {
    const meta = state.analysis.meta;
    const auto = {
      title: meta.title,
      date: meta.date ? Minutes.fmtDate(meta.date, true) + (meta.dateText.match(/\d{1,2}:\d{2}.*$/) ? " " + meta.dateText.match(/\d{1,2}:\d{2}.*$/)[0] : "") : meta.dateText,
      place: meta.place,
      attendees: meta.attendees.join(", "),
      writer: meta.writer || (Store.getProfile().name || ""),
    };
    META_KEYS.forEach((k) => { if (!state.metaEdited.has(k)) $("m-" + k).value = auto[k] || ""; });
  }

  const analyze = debounce(() => {
    const text = $("m-text").value;
    state.analysis = text.trim() ? Minutes.analyze(text) : null;
    if (state.analysis) fillMeta();
    renderItems();
    render();
  }, 300);

  // ---------- ③ 정리 확인 ----------
  function renderItems() {
    const list = $("m-items");
    list.innerHTML = "";
    const all = items();
    $("m-empty").hidden = all.length > 0;
    for (const it of all) {
      const li = document.createElement("li");
      li.className = `m-item is-${it.type}`;
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "들어갈 곳");
      sel.innerHTML = TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
      sel.value = it.type;
      const main = document.createElement("input");
      main.type = "text";
      main.className = "m-main";
      main.setAttribute("aria-label", it.type === "task" ? "할 일" : "보고서 문구");
      main.value = it.type === "task" ? it.task : it.text;
      const extra = document.createElement("div");
      extra.className = "m-extra";
      if (it.type === "task") {
        extra.innerHTML = `<input type="text" class="m-owner" aria-label="담당자" placeholder="담당자"><input type="text" class="m-due" aria-label="기한" placeholder="기한">`;
        extra.querySelector(".m-owner").value = it.owner;
        extra.querySelector(".m-due").value = it.due;
      }
      const raw = document.createElement("small");
      raw.className = "m-raw";
      raw.textContent = "원래 문장: " + it.raw;

      const save = (patch) => {
        state.overrides.set(it.raw, { ...(state.overrides.get(it.raw) || {}), ...patch });
        render();
      };
      sel.addEventListener("change", () => { save({ type: sel.value }); renderItems(); });
      main.addEventListener("input", () => save(it.type === "task" ? { task: main.value } : { text: main.value }));
      extra.querySelector(".m-owner")?.addEventListener("input", (e) => save({ owner: e.target.value }));
      extra.querySelector(".m-due")?.addEventListener("input", (e) => save({ due: e.target.value }));

      const row = document.createElement("div");
      row.className = "m-row";
      row.append(sel, main);
      li.append(row);
      if (it.type === "task") li.append(extra);
      li.append(raw);
      list.appendChild(li);
    }
  }

  // ---------- 미리보기 ----------
  function render() {
    const r = report();
    const ready = !!state.analysis;
    ["m-hwpx", "m-xlsx", "m-copy"].forEach((id) => ($(id).disabled = !ready));
    $("m-pdf").disabled = !(ready && pdfReady);
    const paper = $("m-preview");
    if (!ready) {
      paper.innerHTML = '<svg class="clip"><use href="#clip"/></svg><div class="preview-empty"><p>회의 내용을 쓰면<br>여기에 보고서가 만들어져요.</p></div>';
      return;
    }
    const of = (type) => r.items.filter((it) => it.type === type);
    const list = (arr) => (arr.length ? arr.map((it) => `<li>${esc(it.text)}</li>`).join("") : "<li>해당 없음</li>");
    const tasks = of("task");
    const taskRows = tasks.length
      ? tasks.map((t, i) => `<tr><td class="c">${i + 1}</td><td>${esc(t.task)}</td><td class="c">${esc(t.owner || "-")}</td><td class="c">${esc(t.due || "-")}</td></tr>`).join("")
      : '<tr><td class="c">-</td><td>해당 없음</td><td class="c">-</td><td class="c">-</td></tr>';
    paper.innerHTML = `<svg class="clip"><use href="#clip"/></svg>
      <h3 class="r-title">${esc(Minutes.reportTitle(r.title))}</h3>
      <p class="r-written">${esc(r.written)}</p>
      <h4>1. 회의 개요</h4>
      <table class="r-table r-meta"><tr><th>일시</th><td>${esc(r.date || "-")}</td></tr><tr><th>장소</th><td>${esc(r.place || "-")}</td></tr><tr><th>참석자</th><td>${esc(r.attendees || "-")}</td></tr></table>
      <h4>2. 주요 논의 내용</h4><ul class="r-list">${list(of("discuss"))}</ul>
      <h4>3. 결정 사항</h4><ul class="r-list">${list(of("decide"))}</ul>
      <h4>4. 향후 조치 계획</h4>
      <table class="r-table"><tr><th class="c">번호</th><th>할 일</th><th class="c">담당자</th><th class="c">기한</th></tr>${taskRows}</table>
      <h4>5. 건의 및 이슈</h4><ul class="r-list">${list(of("issue"))}</ul>`;
  }

  // ---------- 입력 ----------
  $("m-text").addEventListener("input", analyze);
  META_KEYS.forEach((k) =>
    $("m-" + k).addEventListener("input", () => { state.metaEdited.add(k); render(); })
  );
  $("m-sample").addEventListener("click", () => {
    $("m-text").value = SAMPLE;
    state.overrides.clear();
    state.metaEdited.clear();
    analyze();
  });
  $("m-clear").addEventListener("click", () => {
    $("m-text").value = "";
    state.overrides.clear();
    state.metaEdited.clear();
    META_KEYS.forEach((k) => ($("m-" + k).value = ""));
    analyze();
  });

  async function readDocx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    return Array.from(doc.getElementsByTagNameNS(W, "p"))
      .map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join(""))
      .join("\n");
  }

  $("m-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("m-error").hidden = true;
    try {
      const text = /\.docx$/i.test(file.name) ? await readDocx(await file.arrayBuffer()) : await file.text();
      $("m-text").value = text;
      state.overrides.clear();
      state.metaEdited.clear();
      analyze();
      toast(`'${file.name}'을 불러왔어요.`);
    } catch (_) {
      $("m-error").textContent = ".txt 또는 .docx 파일만 불러올 수 있어요.";
      $("m-error").hidden = false;
    }
  });

  // ---------- 받기 ----------
  const fileBase = () => (($("m-title").value.trim() || "회의") + "_결과보고").replace(/[\\/:*?"<>|]/g, "");

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function withBusy(btn, label, job) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    $("m-error").hidden = true;
    try { await job(); }
    catch (err) {
      $("m-error").textContent = err.message || "파일을 만들지 못했어요.";
      $("m-error").hidden = false;
    } finally {
      btn.textContent = old;
      render();
    }
  }

  $("m-hwpx").addEventListener("click", (e) =>
    withBusy(e.currentTarget, "만드는 중…", async () => {
      saveBlob(await Minutes.toHwpx(report()), fileBase() + ".hwpx");
      toast("한글 보고서를 받았어요.");
    })
  );

  $("m-xlsx").addEventListener("click", () => {
    const r = report();
    const tasks = r.items.filter((it) => it.type === "task");
    const wb = XLSX.utils.book_new();
    const taskSheet = XLSX.utils.aoa_to_sheet([
      ["번호", "할 일", "담당자", "기한", "진행 상태"],
      ...tasks.map((t, i) => [i + 1, t.task, t.owner, t.due, ""]),
    ]);
    taskSheet["!cols"] = [{ wch: 6 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    const label = Object.fromEntries(Minutes.SECTIONS);
    const allSheet = XLSX.utils.aoa_to_sheet([
      ["구분", "내용"],
      ["보고서", Minutes.reportTitle(r.title)],
      ["일시", r.date], ["장소", r.place], ["참석자", r.attendees],
      ...r.items.map((it) => [label[it.type], it.type === "task" ? `${it.task} (담당: ${it.owner || "-"}, 기한: ${it.due || "-"})` : it.text]),
    ]);
    allSheet["!cols"] = [{ wch: 16 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, taskSheet, "할 일");
    XLSX.utils.book_append_sheet(wb, allSheet, "회의 결과");
    XLSX.writeFile(wb, fileBase() + ".xlsx");
    toast(tasks.length ? `할 일 ${tasks.length}개를 엑셀로 받았어요.` : "엑셀로 받았어요. 할 일은 없어요.");
  });

  $("m-copy").addEventListener("click", async () => {
    const text = Minutes.toText(report());
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("보고서 글을 복사했어요. 메일이나 메신저에 붙여 넣으세요.");
  });

  // PDF: 양식 채우기와 같은 변환 서버를 쓴다
  const PDF_SERVER = ((window.APP_CONFIG && APP_CONFIG.pdfServer) || "").replace(/\/$/, "");
  let pdfReady = false;
  (async () => {
    if (!PDF_SERVER) return;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(PDF_SERVER + "/health", { signal: ctl.signal });
      clearTimeout(timer);
      pdfReady = r.ok;
    } catch (_) { pdfReady = false; }
    $("m-pdf-status").textContent = pdfReady ? "" : "PDF 변환 서버가 꺼져 있어요. 받은 .hwpx를 한글에서 PDF로 저장해 주세요.";
    render();
  })();

  $("m-pdf").addEventListener("click", (e) =>
    withBusy(e.currentTarget, "PDF로 바꾸는 중…", async () => {
      const hwpx = await Minutes.toHwpx(report());
      const r = await fetch(PDF_SERVER + "/convert", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: hwpx });
      if (!r.ok) throw new Error("PDF로 바꾸지 못했어요. 받은 .hwpx를 한글에서 PDF로 저장해 주세요.");
      saveBlob(await r.blob(), fileBase() + ".pdf");
      toast("PDF 보고서를 받았어요.");
    })
  );

  render();
})();
