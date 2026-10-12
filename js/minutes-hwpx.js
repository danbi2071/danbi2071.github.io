/*
 * minutes-hwpx.js — 정리한 회의 결과를 한글 보고서 양식(samples/회의결과보고_양식.hwpx)에 채운다.
 * 양식의 {{표시}} 문단을 찾아 글자를 넣고, 목록은 문단을 복사해 늘리고, 할 일 표는 행을 복사해 늘린다.
 */
(function () {
  "use strict";

  const { NS, XML_DECL, parseXml, kids, kid, textOf } = Hwpx.util;

  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // 문단 하나의 글자를 바꾼다 (첫 글자 모양은 그대로)
  function setParaText(doc, p, text) {
    const run = kids(p, "run")[0];
    const charPr = run ? run.getAttribute("charPrIDRef") : "0";
    Array.from(p.children).forEach((c) => p.removeChild(c));
    const r = doc.createElementNS(NS.hp, "hp:run");
    r.setAttribute("charPrIDRef", charPr);
    const t = doc.createElementNS(NS.hp, "hp:t");
    t.textContent = text;
    r.appendChild(t);
    p.appendChild(r);
  }

  const findPara = (doc, marker) =>
    Array.from(doc.getElementsByTagNameNS(NS.hp, "p")).find((p) => textOf(p).trim() === marker) || null;

  function fillPara(doc, marker, text) {
    const p = findPara(doc, marker);
    if (p) setParaText(doc, p, text);
  }

  // 표시 문단을 목록 길이만큼 복사해서 "○ 내용" 으로 채운다
  function fillList(doc, marker, lines) {
    const p = findPara(doc, marker);
    if (!p) return;
    const list = lines.length ? lines : ["해당 없음"];
    list.forEach((line) => {
      const copy = p.cloneNode(true);
      setParaText(doc, copy, `○ ${line}`);
      p.parentNode.insertBefore(copy, p);
    });
    p.parentNode.removeChild(p);
  }

  // {{TASK}} 가 있는 행을 할 일 수만큼 복사한다
  function fillTasks(doc, tasks) {
    const p = findPara(doc, "{{TASK}}");
    if (!p) return;
    let tr = p;
    while (tr && tr.localName !== "tr") tr = tr.parentNode;
    const tbl = tr.parentNode;
    const baseRow = +kid(kids(tr, "tc")[0], "cellAddr").getAttribute("rowAddr");
    const rows = tasks.length ? tasks : [{ task: "해당 없음", owner: "", due: "" }];
    rows.forEach((t, i) => {
      const copy = tr.cloneNode(true);
      const values = { "{{N}}": tasks.length ? String(i + 1) : "-", "{{TASK}}": t.task, "{{OWNER}}": t.owner || "-", "{{DUE}}": t.due || "-" };
      for (const cp of copy.getElementsByTagNameNS(NS.hp, "p")) {
        const mark = textOf(cp).trim();
        if (mark in values) setParaText(doc, cp, values[mark]);
      }
      for (const tc of kids(copy, "tc")) kid(tc, "cellAddr").setAttribute("rowAddr", String(baseRow + i));
      tbl.insertBefore(copy, tr);
    });
    tbl.removeChild(tr);
    tbl.setAttribute("rowCnt", String(+tbl.getAttribute("rowCnt") - 1 + rows.length));
  }

  /** report: { title, written, date, place, attendees, items[] } → Blob(.hwpx) */
  async function toHwpx(report) {
    const form = await Hwpx.load(base64ToBuffer(REPORT_TEMPLATE.base64), REPORT_TEMPLATE.name);
    const of = (type) => report.items.filter((it) => it.type === type);
    const sections = form.sections.map((sec) => {
      const doc = parseXml(sec.xml);
      fillPara(doc, "{{TITLE}}", Minutes.reportTitle(report.title));
      fillPara(doc, "{{WRITTEN}}", report.written || "");
      fillPara(doc, "{{DATE}}", report.date || "-");
      fillPara(doc, "{{PLACE}}", report.place || "-");
      fillPara(doc, "{{ATTENDEES}}", report.attendees || "-");
      fillList(doc, "{{DISCUSS}}", of("discuss").map((it) => it.text));
      fillList(doc, "{{DECIDE}}", of("decide").map((it) => it.text));
      fillList(doc, "{{ISSUES}}", of("issue").map((it) => it.text));
      fillTasks(doc, of("task"));
      return { path: sec.path, xml: XML_DECL + new XMLSerializer().serializeToString(doc.documentElement), changed: true };
    });
    return Hwpx.save(form, { sections, binId: null });
  }

  Minutes.toHwpx = toHwpx;
})();
