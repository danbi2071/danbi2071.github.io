/*
 * hwpx.js — 한글(.hwpx) 양식을 읽고, 칸을 찾아 채우고, 서명 이미지를 넣는다.
 *
 * .hwpx 구조 (zip)
 *   mimetype                 ← 반드시 맨 앞, 압축 안 함
 *   Contents/content.hpf     ← 파일 목록(manifest). 그림을 넣으면 여기에 등록
 *   Contents/header.xml      ← 글꼴·문단 모양 정의
 *   Contents/section0.xml …  ← 본문. 표는 hp:tbl > hp:tr > hp:tc
 *   BinData/imageN.png       ← 그림 파일
 */
(function () {
  "use strict";

  const NS = {
    hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
    hc: "http://www.hancom.co.kr/hwpml/2011/core",
    hh: "http://www.hancom.co.kr/hwpml/2011/head",
  };
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

  // 양식에서 찾을 항목과 단어 목록. 실제 양식을 모으면서 계속 늘린다.
  const FIELDS = [
    { key: "title", label: "강의명", syn: ["강의명", "교육명", "과정명", "강좌명", "프로그램명", "교육과정명", "교육과정", "과목명", "과정", "강의주제", "교육주제", "주제", "강의제목", "교육제목"] },
    { key: "date", label: "강의 날짜", syn: ["강의일자", "교육일자", "강의일", "교육일", "강의일시", "교육일시", "일시", "일자", "날짜", "교육기간", "강의기간", "실시일", "운영일"] },
    { key: "time", label: "강의 시간", syn: ["강의시간", "교육시간", "운영시간", "시간", "강의시수", "교육시수", "시수"] },
    { key: "content", label: "강의 내용", syn: ["강의내용", "교육내용", "주요교육내용", "주요내용", "세부내용", "강의개요", "교육개요", "내용"] },
    { key: "name", label: "강사명", syn: ["강사명", "강사성명", "강사이름", "성명", "이름", "강사", "신청인", "청구인", "예금주"] },
    { key: "rrn", label: "주민등록번호", syn: ["주민등록번호", "주민번호", "주민등록", "생년월일및주민번호"] },
    { key: "bank", label: "은행명", syn: ["은행명", "은행", "거래은행", "입금은행", "금융기관", "금융기관명"] },
    { key: "account", label: "계좌번호", syn: ["계좌번호", "입금계좌", "입금계좌번호", "계좌", "지급계좌", "통장번호"] },
    { key: "org", label: "소속", syn: ["소속", "소속기관"] },
    { key: "phone", label: "연락처", syn: ["연락처", "전화번호", "휴대전화", "휴대폰", "핸드폰", "전화"] },
    { key: "email", label: "이메일", syn: ["이메일", "전자우편", "email", "e-mail", "메일"] },
    { key: "writeDate", label: "작성일", syn: ["작성일", "작성일자", "신청일", "신청일자", "청구일", "청구일자", "제출일"] },
    { key: "sign", label: "서명", syn: ["서명", "강사서명", "본인서명", "신청인서명", "청구인서명", "서명또는인", "날인"], isSign: true },
  ];

  // 빈칸으로 볼 수 있는 내용: 비어 있음, "년 월 일", "(인)", "(서명)" 등
  const PLACEHOLDER_RE = /^[\s_.\-\/~:년월일시분()인서명또는]*$/;
  const SEAL_RE = /\((인|서명|서명\s*또는\s*인|印)\)|\(\s*인\s*\)/;

  // ---------- 작은 도우미 ----------
  const kids = (el, name) => Array.from(el.children).filter((c) => c.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;

  // 표 안의 표는 건너뛰고 글자만 모은다
  function textOf(el) {
    let out = "";
    (function walk(n) {
      for (const c of n.children) {
        if (c.localName === "tbl") continue;
        if (c.localName === "t") out += c.textContent;
        else if (c.localName === "p" && out && !out.endsWith("\n")) { out += "\n"; walk(c); }
        else walk(c);
      }
    })(el);
    return out.replace(/\n+$/, "");
  }

  function normalize(s) {
    return s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[\s:：*·ㆍ \-]/g, "");
  }

  // 칸 이름 → 항목. 가장 길게 맞는 단어를 고른다.
  function matchField(rawText) {
    const raw = rawText.trim();
    if (!raw || raw.length > 16) return null;
    const norm = normalize(raw);
    const normKeepParen = raw.toLowerCase().replace(/[\s:：*·ㆍ ]/g, "");
    if (!norm) return null;
    let best = null;
    for (const f of FIELDS) {
      for (const syn of f.syn) {
        const s = syn.toLowerCase().replace(/[\s\-]/g, "");
        let score = 0;
        if (norm === s || normKeepParen === s) score = 100 + s.length;
        else if (norm.includes(s) && norm.length <= 12) score = s.length;
        if (score && (!best || score > best.score)) best = { field: f, score, exact: score >= 100 };
      }
    }
    return best;
  }

  // ---------- 표 분석 ----------
  function tablesIn(doc) {
    return Array.from(doc.getElementsByTagNameNS(NS.hp, "tbl"));
  }

  function readTable(tbl) {
    const cells = [];
    const grid = new Map();
    for (const tr of kids(tbl, "tr")) {
      for (const tc of kids(tr, "tc")) {
        const addr = kid(tc, "cellAddr");
        const span = kid(tc, "cellSpan");
        const cell = {
          el: tc,
          row: +addr.getAttribute("rowAddr"),
          col: +addr.getAttribute("colAddr"),
          rowSpan: span ? +span.getAttribute("rowSpan") : 1,
          colSpan: span ? +span.getAttribute("colSpan") : 1,
          text: textOf(tc),
        };
        cells.push(cell);
        for (let r = 0; r < cell.rowSpan; r++)
          for (let c = 0; c < cell.colSpan; c++) grid.set(`${cell.row + r},${cell.col + c}`, cell);
      }
    }
    return { cells, at: (r, c) => grid.get(`${r},${c}`) || null };
  }

  const isBlank = (cell) => !!cell && PLACEHOLDER_RE.test(cell.text) && !matchField(cell.text);

  // 서명 줄의 앞부분에 오는 말 ("성명 :", "신청인", "강사" …)
  const SIGNER_RE = /(성\s*명|서\s*명|이\s*름|신청인|청구인|작성자|확인자|강\s*사|본\s*인)/;

  // 표 안에 있지 않은 문단들 (문서 안 모든 hp:p 중 몇 번째인지도 같이)
  function bodyParas(doc) {
    const all = Array.from(doc.getElementsByTagNameNS(NS.hp, "p"));
    const out = [];
    all.forEach((p, index) => {
      for (let a = p.parentNode; a; a = a.parentNode) if (a.localName === "tc") return;
      out.push({ p, index });
    });
    return out;
  }

  /**
   * 양식의 모든 표에서 "칸 이름 → 채울 칸" 짝을 찾는다.
   * 결과는 sectionPath + 표 번호 + 행/열로 저장해서, 나중에 원본을 다시 읽어도 같은 칸을 찾을 수 있다.
   */
  function findSlots(form) {
    const slots = [];
    form.sections.forEach((sec) => {
      const doc = parseXml(sec.xml);
      tablesIn(doc).forEach((tbl, tIdx) => {
        const t = readTable(tbl);
        for (const cell of t.cells) {
          const m = matchField(cell.text);
          const label = cell.text.trim();
          // 못 알아본 칸 이름도 목록에 올려서 사용자가 직접 고를 수 있게 한다
          if (!m && (!label || label.length > 16 || PLACEHOLDER_RE.test(label))) continue;
          const right = t.at(cell.row, cell.col + cell.colSpan);
          const below = t.at(cell.row + cell.rowSpan, cell.col);
          let target = null;
          if (right && right !== cell && isBlank(right)) target = right;
          else if (m && below && below !== cell && isBlank(below) && below.col === cell.col) target = below;

          if (m && m.field.isSign && !target && SEAL_RE.test(cell.text)) target = cell;
          if (!target) continue;
          slots.push({
            id: `${sec.path}#${tIdx}:${target.row},${target.col}`,
            section: sec.path,
            table: tIdx,
            row: target.row,
            col: target.col,
            labelText: cell.text.replace(/\s+/g, " ").trim(),
            targetText: target.text.trim(),
            fieldKey: m ? m.field.key : "",
            exact: !!(m && m.exact),
            known: !!m,
            selfTarget: target === cell,
          });
        }
      });

      // 표 밖 문단: "성명 :      (인)" 처럼 서명 자리가 있는 줄
      bodyParas(doc).forEach(({ p, index }) => {
        const text = textOf(p).replace(/\s+/g, " ").trim();
        const seal = text.match(SEAL_RE);
        if (!seal || text.length > 60 || !SIGNER_RE.test(text.slice(0, seal.index))) return;
        slots.push({
          id: `${sec.path}#p${index}`,
          section: sec.path,
          para: index,
          labelText: text,
          targetText: text,
          fieldKey: "sign",
          exact: true,
          known: true,
          selfTarget: true,
        });
      });
    });
    // 같은 칸이 두 번 잡히면 (오른쪽·아래 겹침) 정확도가 높은 쪽만 남긴다
    const byId = new Map();
    for (const s of slots) {
      const prev = byId.get(s.id);
      const rank = (x) => (x.exact ? 2 : x.known ? 1 : 0);
      if (!prev || rank(s) > rank(prev)) byId.set(s.id, s);
    }
    return Array.from(byId.values());
  }

  // ---------- 읽기 ----------
  function parseXml(str) {
    const doc = new DOMParser().parseFromString(str, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("양식 XML을 읽지 못했어요.");
    return doc;
  }

  function isOldHwp(bytes) {
    // 구형 .hwp 는 OLE 파일: D0 CF 11 E0
    return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  }

  async function load(arrayBuffer, fileName) {
    const bytes = new Uint8Array(arrayBuffer);
    if (isOldHwp(bytes)) {
      const e = new Error("구형 .hwp 파일이에요.");
      e.code = "OLD_HWP";
      throw e;
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (_) {
      throw new Error(".hwpx 파일이 아니거나 파일이 손상되었어요.");
    }
    const mime = zip.file("mimetype") ? (await zip.file("mimetype").async("string")).trim() : "";
    if (!zip.file("Contents/content.hpf") || (mime && !/hwp/.test(mime))) {
      throw new Error("한글(.hwpx) 문서가 아니에요.");
    }
    const hpf = await zip.file("Contents/content.hpf").async("string");
    const header = zip.file("Contents/header.xml") ? await zip.file("Contents/header.xml").async("string") : "";

    // manifest 의 순서대로 section 파일을 읽는다
    const items = Array.from(hpf.matchAll(/<opf:item\b[^>]*>/g)).map((m) => {
      const a = (n) => (m[0].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
      return { id: a("id"), href: a("href"), type: a("media-type") };
    });
    const sectionPaths = items.filter((i) => /Contents\/section\d+\.xml$/.test(i.href || "")).map((i) => i.href);
    if (!sectionPaths.length) zip.folder("Contents").forEach((p) => /^section\d+\.xml$/.test(p) && sectionPaths.push("Contents/" + p));
    const sections = [];
    for (const path of sectionPaths) sections.push({ path, xml: await zip.file(path).async("string") });

    // 미리보기용: 문단 정렬, 원래 들어 있는 그림
    const align = {};
    for (const m of header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[\s\S]*?<hh:align\b[^>]*horizontal="(\w+)"/g)) align[m[1]] = m[2];
    // 서명을 (인) 위에 겹칠 때 위치 계산용: 글자 크기, 본문 폭
    const charH = {};
    for (const m of header.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"[^>]*\bheight="(\d+)"/g)) charH[m[1]] = +m[2];
    let bodyWidth = 42520;
    const sec0 = sections[0] ? sections[0].xml : "";
    const pagePr = sec0.match(/<hp:pagePr\b[^>]*\bwidth="(\d+)"[^>]*>\s*<hp:margin\b[^>]*\bleft="(\d+)"[^>]*\bright="(\d+)"/);
    if (pagePr) bodyWidth = +pagePr[1] - +pagePr[2] - +pagePr[3];
    const images = {};
    for (const it of items) {
      if (it.href && it.href.startsWith("BinData/") && zip.file(it.href)) {
        const blob = await zip.file(it.href).async("blob");
        images[it.id] = URL.createObjectURL(new Blob([blob], { type: it.type || "image/png" }));
      }
    }
    return { name: fileName, zip, hpf, sections, align, charH, bodyWidth, images, itemIds: items.map((i) => i.id) };
  }

  // ---------- 채우기 ----------
  function newEl(doc, prefix, name) {
    return doc.createElementNS(NS[prefix], `${prefix}:${name}`);
  }

  function setCellText(doc, tc, text) {
    const sub = kid(tc, "subList");
    const paras = kids(sub, "p");
    const first = paras[0];
    paras.slice(1).forEach((p) => sub.removeChild(p));
    const runs = kids(first, "run");
    const charPr = runs[0] ? runs[0].getAttribute("charPrIDRef") : "0";
    // 원래 글자·줄 배치 정보는 지운다 (한글이 열 때 다시 계산)
    Array.from(first.children).forEach((c) => first.removeChild(c));

    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, i) => {
      const p = i === 0 ? first : first.cloneNode(false);
      if (i > 0) sub.appendChild(p);
      const run = newEl(doc, "hp", "run");
      run.setAttribute("charPrIDRef", charPr);
      const t = newEl(doc, "hp", "t");
      t.textContent = line;
      run.appendChild(t);
      p.appendChild(run);
    });
  }

  // 1mm = 7200/25.4 HWPUNIT
  const MM = 7200 / 25.4;

  /**
   * 서명 그림 XML.
   * float 가 없으면 글자처럼 줄에 들어가고, 있으면 글 앞에 떠서 (인) 위에 겹친다.
   * float: { x, y } = 문단 왼쪽 위에서 떨어진 거리 (HWPUNIT)
   */
  // 한글은 위치 값을 부호 없는 32비트로 적는다: 음수(위·왼쪽으로 옮기기)는 2^32 를 더해 적는다
  const u32 = (n) => (n < 0 ? 4294967296 + n : n);

  function picXml(binId, w, h, float) {
    const id = Math.floor(Math.random() * 2e9);
    if (float) float = { x: u32(float.x), y: u32(float.y) };
    const pos = float
      ? `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="${float.y}" horzOffset="${float.x}"/>`
      : `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`;
    return (
      `<hp:pic xmlns:hp="${NS.hp}" xmlns:hc="${NS.hc}" id="${id}" zOrder="${float ? 50 : 0}" numberingType="PICTURE" textWrap="${float ? "IN_FRONT_OF_TEXT" : "TOP_AND_BOTTOM"}" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id + 1}" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="0" height="0"/>` +
      `<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${w >> 1}" centerY="${h >> 1}" rotateimage="1"/>` +
      `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
      `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="0" dimheight="0"/><hp:effects/>` +
      `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
      pos +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>서명</hp:shapeComment></hp:pic>`
    );
  }

  function makePicRun(doc, charPr, binId, w, h, float) {
    const run = newEl(doc, "hp", "run");
    run.setAttribute("charPrIDRef", charPr);
    const pic = parseXml(picXml(binId, w, h, float)).documentElement;
    run.appendChild(doc.importNode(pic, true));
    run.appendChild(newEl(doc, "hp", "t"));
    return run;
  }

  function sigSize(sig, heightMm, maxWidthMm) {
    let h = Math.round(heightMm * MM);
    let w = Math.round(h * sig.ratio);
    const maxW = Math.round(maxWidthMm * MM);
    if (w > maxW) { w = maxW; h = Math.round(w / sig.ratio); }
    return { w, h };
  }

  // 글자 폭 어림: 한글·한자는 글자 크기만큼, 영문·숫자·공백·기호는 절반
  const textWidth = (s, em) => Array.from(s).reduce((sum, ch) => sum + (/[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch) ? em : em * 0.5), 0);

  /**
   * 문단 안에서 "(인)" 을 찾아
   *   1) name 을 넣고 (누름틀이 있으면 그 안에, 없으면 (인) 바로 앞에)
   *   2) 서명 그림을 (인) 위에 겹쳐 띄운다
   * 문단 폭 width 와 정렬로 (인) 의 가로 위치를 어림한다.
   * 찾으면 true.
   */
  function sealInPara(doc, p, ctx) {
    const { form, binId, sig, width } = ctx;
    let { name } = ctx;
    if (name && textOf(p).replace(/\s/g, "").includes(name.replace(/\s/g, ""))) name = "";

    // (인) 이 들어 있는 hp:t 찾기
    let sealRun = null, sealT = null, sealMatch = null;
    outer: for (const run of kids(p, "run"))
      for (const t of kids(run, "t")) {
        const m = t.textContent.match(SEAL_RE);
        if (m) { sealRun = run; sealT = t; sealMatch = m; break outer; }
      }
    if (!sealT) return false;
    const lineseg = kid(p, "linesegarray");
    if (lineseg) p.removeChild(lineseg);

    // run 을 [앞 글자] | [(인)…] 으로 나눈다
    const before = sealT.textContent.slice(0, sealMatch.index);
    const runAfter = sealRun.cloneNode(false);
    let moving = false;
    for (const c of Array.from(sealRun.children)) {
      if (c === sealT) { moving = true; continue; }
      if (moving) runAfter.appendChild(c);
    }
    const tSeal = newEl(doc, "hp", "t");
    tSeal.textContent = sealT.textContent.slice(sealMatch.index);
    runAfter.insertBefore(tSeal, runAfter.firstChild);
    sealT.textContent = before;
    p.insertBefore(runAfter, sealRun.nextSibling);

    // 이름 넣기: 누름틀(클릭하여 입력) 안이 있으면 그곳에
    if (name) {
      const begin = Array.from(p.getElementsByTagNameNS(NS.hp, "fieldBegin")).find((f) => f.getAttribute("type") === "CLICK_HERE");
      let placed = false;
      if (begin) {
        const beginCtrl = begin.parentNode;
        const endCtrl = Array.from(p.getElementsByTagNameNS(NS.hp, "fieldEnd")).find((f) => f.getAttribute("beginIDRef") === begin.getAttribute("id"));
        if (endCtrl && beginCtrl.parentNode === endCtrl.parentNode.parentNode) {
          // 누름틀 사이의 글자를 이름으로 바꾼다
          const run = beginCtrl.parentNode;
          let inside = false;
          for (const c of Array.from(run.children)) {
            if (c === beginCtrl) { inside = true; continue; }
            if (c === endCtrl.parentNode) break;
            if (inside && c.localName === "t") run.removeChild(c);
          }
          const t = newEl(doc, "hp", "t");
          t.textContent = name;
          run.insertBefore(t, endCtrl.parentNode);
          placed = true;
        }
      }
      if (!placed) sealT.textContent = before.replace(/\s+$/, "") + (before.trim() ? " " : "") + name + " ";
    }

    // (인) 의 가로 위치 어림
    let w0 = 0, sealW = 0, w1 = 0, stage = 0, sealEm = 1000;
    for (const run of kids(p, "run")) {
      const em = form.charH[run.getAttribute("charPrIDRef")] || 1000;
      for (const c of run.getElementsByTagNameNS(NS.hp, "t")) {
        let parentField = false;
        for (let a = c.parentNode; a && a !== p; a = a.parentNode) if (a.localName === "tbl") parentField = true;
        if (parentField) continue;
        if (c === tSeal) {
          const s = c.textContent.match(SEAL_RE)[0];
          sealW = textWidth(s, em);
          sealEm = em;
          w1 += textWidth(c.textContent.slice(s.length), em);
          stage = 1;
          continue;
        }
        if (stage === 0) w0 += textWidth(c.textContent, em);
        else w1 += textWidth(c.textContent, em);
      }
    }
    const align = (form.align[p.getAttribute("paraPrIDRef")] || "LEFT").toUpperCase();
    const total = w0 + sealW + w1;
    let center;
    if (align === "RIGHT") center = width - w1 - sealW / 2;
    else if (align === "CENTER") center = (width - total) / 2 + w0 + sealW / 2;
    else center = w0 + sealW / 2;

    if (!sig) return true; // 이름만 넣는 경우
    const { w, h } = sigSize(sig, 12, 34);
    const float = {
      x: Math.max(0, Math.round((ctx.offsetX || 0) + center - w / 2)),
      y: Math.round(sealEm * 0.55 - h / 2),
    };
    p.insertBefore(makePicRun(doc, sealRun.getAttribute("charPrIDRef"), binId, w, h, float), runAfter);
    return true;
  }

  /**
   * 칸 안 문단의 글자 시작점이 본문 왼쪽에서 얼마나 떨어져 있는지 (HWPUNIT).
   * 표 칸 안에서 띄운 그림의 가로 위치는 칸이 아니라 본문 단(column) 기준이라서 필요하다.
   */
  function cellOffsetX(form, tc) {
    const tr = tc.parentNode, tbl = tr.parentNode;
    const t = readTable(tbl);
    const addr = kid(tc, "cellAddr");
    const row = +addr.getAttribute("rowAddr"), col = +addr.getAttribute("colAddr");
    let x = 0;
    for (let c = 0; c < col; ) {
      const cell = t.at(row, c);
      if (!cell) break;
      const sz = kid(cell.el, "cellSz");
      x += sz ? +sz.getAttribute("width") : 0;
      c = cell.col + cell.colSpan;
    }
    const mg = kid(tc, "cellMargin");
    x += mg ? +mg.getAttribute("left") : 0;

    // 표 자체의 위치
    const pos = kid(tbl, "pos");
    const out = kid(tbl, "outMargin");
    const tblW = kid(tbl, "sz") ? +kid(tbl, "sz").getAttribute("width") : 0;
    let tblX = out ? +out.getAttribute("left") : 0;
    if (pos && pos.getAttribute("treatAsChar") === "0") {
      let off = +pos.getAttribute("horzOffset") || 0;
      if (off > 2147483647) off -= 4294967296;
      const h = (pos.getAttribute("horzAlign") || "LEFT").toUpperCase();
      if (h === "CENTER") tblX = (form.bodyWidth - tblW) / 2 + off;
      else if (h === "RIGHT") tblX = form.bodyWidth - tblW - off;
      else tblX += off;
    } else {
      let anchor = tbl.parentNode;
      while (anchor && anchor.localName !== "p") anchor = anchor.parentNode;
      const align = anchor ? (form.align[anchor.getAttribute("paraPrIDRef")] || "LEFT").toUpperCase() : "LEFT";
      if (align === "CENTER") tblX += (form.bodyWidth - tblW) / 2;
      else if (align === "RIGHT") tblX += form.bodyWidth - tblW;
    }
    return tblX + x;
  }

  function cellWidth(tc) {
    const sz = kid(tc, "cellSz");
    const mg = kid(tc, "cellMargin");
    const w = sz ? +sz.getAttribute("width") : 10000;
    return w - (mg ? +mg.getAttribute("left") + +mg.getAttribute("right") : 0);
  }

  /**
   * 표 칸에 서명 넣기
   * "(인)" 이 있는 칸 → [이름] (인) + (인) 위에 서명 그림을 겹친다
   * 빈 칸 → [이름] [서명 그림] (글자처럼)
   */
  function putSignature(doc, tc, ctx) {
    const sub = kid(tc, "subList");
    if (SEAL_RE.test(textOf(tc))) {
      const offsetX = cellOffsetX(ctx.form, tc);
      for (const p of kids(sub, "p")) if (sealInPara(doc, p, { ...ctx, width: cellWidth(tc), offsetX })) return;
    }
    let { name } = ctx;
    if (name && textOf(tc).replace(/\s/g, "").includes(name.replace(/\s/g, ""))) name = "";
    const { w, h } = sigSize(ctx.sig, 11, 38);
    setCellText(doc, tc, name ? name + " " : "");
    const p = kids(sub, "p")[0];
    const run = kids(p, "run")[0];
    const picRun = makePicRun(doc, run.getAttribute("charPrIDRef"), ctx.binId, w, h);
    if (name) p.insertBefore(picRun, run.nextSibling);
    else p.replaceChild(picRun, run);
  }

  function nextImageId(itemIds) {
    let n = 1;
    while (itemIds.includes("image" + n)) n++;
    return "image" + n;
  }

  /**
   * 채운 결과를 만든다.
   * values: { title, date, … }  /  assignments: [{ slot, fieldKey }]  /  sig: { bytes, ratio } | null
   * 돌려주는 값: { sections: [{path, xml}], binId, … } — 미리보기와 저장에 같이 쓴다
   */
  function fill(form, assignments, values, sig) {
    const binId = sig ? nextImageId(form.itemIds) : null;
    let usedSig = false;
    const filledIds = new Set();
    const signName = values.signWithName ? (values.name || "").trim() : "";
    const sections = form.sections.map((sec) => {
      const mine = assignments.filter((a) => a.slot.section === sec.path && a.fieldKey);
      if (!mine.length) return { path: sec.path, xml: sec.xml, changed: false };
      const doc = parseXml(sec.xml);
      const tables = tablesIn(doc).map(readTable);
      const allParas = Array.from(doc.getElementsByTagNameNS(NS.hp, "p"));
      for (const a of mine) {
        const field = FIELDS.find((f) => f.key === a.fieldKey);
        // 표 밖 문단 ("성명 :    (인)")
        if (a.slot.para != null) {
          const p = allParas[a.slot.para];
          if (!p) continue;
          if (field.isSign && sig) {
            if (sealInPara(doc, p, { form, binId, sig, name: signName, width: form.bodyWidth })) usedSig = true;
          } else if (field.key === "name" && values.name) {
            sealInPara(doc, p, { form, binId: null, sig: null, name: values.name.trim(), width: form.bodyWidth, nameOnly: true });
          } else continue;
          filledIds.add(a.slot.id);
          continue;
        }
        const t = tables[a.slot.table];
        const cell = t && t.at(a.slot.row, a.slot.col);
        if (!cell) continue;
        if (field.isSign) {
          if (!sig) continue;
          putSignature(doc, cell.el, { form, binId, sig, name: signName });
          usedSig = true;
        } else {
          if (a.slot.selfTarget) continue; // 칸 이름이 적힌 칸은 글자로 덮어쓰지 않는다
          const v = (values[a.fieldKey] || "").trim();
          if (!v) continue;
          setCellText(doc, cell.el, v);
        }
        cell.el.setAttribute("dirty", "1");
        filledIds.add(a.slot.id);
      }
      return { path: sec.path, xml: XML_DECL + new XMLSerializer().serializeToString(doc.documentElement), changed: true, doc };
    });
    return { sections, binId: usedSig ? binId : null, sig: usedSig ? sig : null, filledIds };
  }

  async function save(form, result) {
    const zip = form.zip;
    // 원본 zip 을 건드리지 않도록 새로 복사한다
    const out = new JSZip();
    const names = [];
    zip.forEach((p, f) => { if (!f.dir) names.push(p); });
    // mimetype 은 맨 앞, 압축하지 않음
    if (zip.file("mimetype")) out.file("mimetype", await zip.file("mimetype").async("uint8array"), { compression: "STORE" });
    for (const p of names) {
      if (p === "mimetype") continue;
      const changed = result.sections.find((s) => s.path === p && s.changed);
      if (changed) out.file(p, changed.xml);
      else if (p === "Contents/content.hpf" && result.binId) {
        const item = `<opf:item id="${result.binId}" href="BinData/${result.binId}.png" media-type="image/png" isEmbeded="1"/>`;
        out.file(p, form.hpf.replace("</opf:manifest>", item + "</opf:manifest>"));
      } else out.file(p, await zip.file(p).async("uint8array"));
    }
    if (result.binId) out.file(`BinData/${result.binId}.png`, result.sig.bytes);
    return out.generateAsync({ type: "blob", mimeType: "application/hwp+zip", compression: "DEFLATE" });
  }

  // ---------- 미리보기 (HTML) ----------
  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderPreview(form, result, slotsById) {
    const sigUrl = result && result.sig ? result.sig.url : null;
    const sections = result ? result.sections : form.sections;
    const filledIds = result ? result.filledIds : new Set();

    function renderRunKids(run, ctx) {
      let html = "";
      for (const c of run.children) {
        if (c.localName === "t") html += esc(c.textContent);
        else if (c.localName === "tbl") html += renderTable(c, ctx);
        else if (c.localName === "pic") {
          const img = c.getElementsByTagNameNS(NS.hc, "img")[0];
          const ref = img && img.getAttribute("binaryItemIDRef");
          const url = ref && ref === (result && result.binId) ? sigUrl : form.images[ref];
          if (url) html += `<img class="pv-pic${ref === (result && result.binId) ? " pv-sig" : ""}" src="${url}" alt="">`;
        }
      }
      return html;
    }
    function renderPara(p, ctx) {
      const a = (form.align[p.getAttribute("paraPrIDRef")] || "LEFT").toLowerCase();
      const al = a === "justify" || a === "distribute" ? "left" : a;
      let inner = "";
      for (const run of kids(p, "run")) inner += renderRunKids(run, ctx);
      return `<div class="pv-p" style="text-align:${al}">${inner || "&nbsp;"}</div>`;
    }
    function renderTable(tbl, ctx) {
      const tIdx = ctx.tables.indexOf(tbl);
      let html = '<table class="pv-table">';
      for (const tr of kids(tbl, "tr")) {
        html += "<tr>";
        for (const tc of kids(tr, "tc")) {
          const addr = kid(tc, "cellAddr");
          const span = kid(tc, "cellSpan");
          const sz = kid(tc, "cellSz");
          const id = `${ctx.path}#${tIdx}:${addr.getAttribute("rowAddr")},${addr.getAttribute("colAddr")}`;
          const cls = filledIds.has(id) ? "pv-filled" : slotsById && slotsById.has(id) ? "pv-slot" : "";
          const width = sz ? Math.round(+sz.getAttribute("width") / 100) : 0;
          let inner = "";
          for (const p of kids(kid(tc, "subList"), "p")) inner += renderPara(p, ctx);
          html += `<td class="${cls}" data-slot="${esc(id)}" colspan="${span ? span.getAttribute("colSpan") : 1}" rowspan="${span ? span.getAttribute("rowSpan") : 1}"${width ? ` style="width:${width}px"` : ""}>${inner}</td>`;
        }
        html += "</tr>";
      }
      return html + "</table>";
    }

    let html = "";
    for (const sec of sections) {
      const doc = sec.doc || parseXml(sec.xml);
      const ctx = { path: sec.path, tables: tablesIn(doc) };
      for (const p of kids(doc.documentElement, "p")) html += renderPara(p, ctx);
    }
    return html;
  }

  window.Hwpx = {
    FIELDS, load, findSlots, fill, save, renderPreview, matchField,
    // 회의록 보고서(minutes.js)에서 같이 쓰는 도우미
    util: { NS, XML_DECL, parseXml, kids, kid, textOf, tablesIn, setCellText, newEl },
  };
})();
