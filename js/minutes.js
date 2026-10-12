/*
 * minutes.js — 회의록을 보고서 형식으로 정리한다 (AI 없이 규칙으로, 브라우저 안에서만).
 *
 *   쭉 쓴 회의 내용 → 문장 나누기 → 회의 정보(일시·장소·참석자) 찾기
 *   → 문장마다 논의 / 결정 / 할 일 / 이슈 로 나누기 → 할 일의 담당자·기한 찾기
 *   → "~했어요" 같은 말투를 "~함" 같은 보고서 문구로 바꾸기
 */
(function () {
  "use strict";

  // ---------- 한글 글자 도우미 (받침 붙이기·떼기) ----------
  const BASE = 0xac00;
  const isSyl = (ch) => !!ch && ch.charCodeAt(0) >= BASE && ch.charCodeAt(0) <= 0xd7a3;
  const finalOf = (ch) => (isSyl(ch) ? (ch.charCodeAt(0) - BASE) % 28 : 0);
  const hasFinal = (ch) => finalOf(ch) !== 0;
  const withFinal = (ch, idx) => (isSyl(ch) ? String.fromCharCode(ch.charCodeAt(0) - finalOf(ch) + idx) : ch);
  const RIEUL = 8, MIEUM = 16;
  const last = (s) => s.slice(-1);

  // ---------- 말투 → 보고서 문구 ----------
  const WORDS = [
    [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ""],
    [/(ㅋ+|ㅎ+|ㅠ+|ㅜ+|\^\^|;{2,}|~+)/g, ""],
    [/^(근데요?|그런데|근데)\s*/, "다만 "],
    [/\s(근데|그런데)\s/g, " 다만 "],
    [/^(그래서|그러니까|그니까)\s*/, "이에 따라 "],
    [/^(일단|우선은)\s*/, "우선 "],
    [/(^|\s)(엄청나게|엄청|진짜|정말|완전|너무|되게|무척|굉장히|겁나)\s/g, "$1매우 "],
    [/(^|\s)(좀|조금)\s/g, "$1다소 "],
    [/(^|\s)(그냥|걍|막|뭐|음+|어+)\s/g, "$1"],
    [/얘기(를\s*)?(했|하|해)/g, "논의$2"],
    [/얘기가/g, "의견이"],
    [/얘기는/g, "의견은"],
    [/얘기/g, "논의"],
    [/애들/g, "학생들"],
    [/빨리/g, "조속히"],
    [/한테/g, "에게"],
    [/(^|\s)다들\s/g, "$1모두 "],
    [/([가-힣])이랑\s/g, "$1과 "],
    [/([가-힣])랑\s/g, (m, ch) => ch + (hasFinal(ch) ? "과 " : "와 ")],
    [/\s{2,}/g, " "],
  ];

  // 문장 끝 바꾸기 (위에서부터 처음 맞는 하나만)
  const ENDINGS = [
    [/안\s*(돼요|됩니다|된다|됨|되요)$/, "불가함"],
    [/(으)?면\s*좋겠(어요|습니다|다|음|네요)$/, "는 것이 바람직함"],
    [/\s*(해|하여)\s*주(세요|십시오|시기 바랍니다|셨으면 해요|면 좋겠어요)$/, " 요청함"],
    [/(해야|하여야)\s*(할 것 같아요|할 것 같습니다|할 것 같다|할 것 같음|할 듯해요|할 듯|하지 않을까요|할까요)$/, "할 필요가 있는 것으로 보임"],
    [/(해야|하여야)\s*(해요|합니다|한다|함|해|됨|돼요|됩니다|겠어요|겠습니다|겠음)$/, "할 필요가 있음"],
    [/기로\s*(결정|결정함|결정했어요|결정했습니다|결정했음|결정됨|결정됐어요)$/, "기로 결정함"],
    [/기로\s*(합의|합의함|합의했어요|합의했습니다|합의했음)$/, "기로 합의함"],
    [/기로\s*(했어요|했습니다|했다|했음|했고요|했죠|함|해요|합니다|정했어요|정했습니다|정했음|정함)$/, "기로 함"],
    [/(할게요|할께요|하겠습니다|하겠어요|하겠음|할 거예요|할 겁니다|할 거임|할 예정이에요|할 예정입니다|할 예정|하려고 해요|하려고 합니다)$/, "할 예정임"],
    [/(했어요|했습니다|했다|했음|했네요|했죠|했고요|했는데요|했거든요)$/, "함"],
    [/(되었어요|됐어요|되었습니다|됐습니다|됐다|됐음|되었다|됐네요)$/, "됨"],
    [/(돼요|됩니다|된다|되네요|되죠|되요)$/, "됨"],
    [/(것 같아요|것 같습니다|것 같다|것 같음|것 같네요|듯해요|듯합니다|듯함|듯)$/, "것으로 보임"],
    [/(해요|합니다|한다|하네요|하죠|하고요|하거든요|하는데요|하다)$/, "함"],
    [/(이에요|예요|입니다|이다|이죠|이네요|이고요|이거든요|인데요)$/, "임"],
    [/(있어요|있습니다|있다|있네요|있죠|있고요|있거든요|있는데요)$/, "있음"],
    [/(없어요|없습니다|없다|없네요|없죠|없고요|없거든요|없는데요)$/, "없음"],
    [/(았|었|였)(어요|습니다|다|네요|죠|고요|거든요|는데요)$/, "$1음"],
  ];

  function formalize(input) {
    let s = String(input).trim();
    for (const [re, to] of WORDS) s = s.replace(re, to);
    s = s.replace(/[\s.!?…,]+$/, "").trim();
    for (const [re, to] of ENDINGS) {
      if (re.test(s)) return tidy(s.replace(re, to));
    }
    // 받침을 봐야 하는 끝맺음
    let m;
    if ((m = s.match(/([가-힣])(게요|께요)$/)) && finalOf(m[1]) === RIEUL) return tidy(s.slice(0, -2) + " 예정임"); // 보낼게요 → 보낼 예정임
    if ((m = s.match(/([가-힣])겠(습니다|어요|음)$/))) {
      const stem = s.slice(0, m.index) + m[1];
      return tidy(hasFinal(m[1]) ? stem + "을 예정임" : stem.slice(0, -1) + withFinal(m[1], RIEUL) + " 예정임");
    }
    if ((m = s.match(/([가-힣])(아요|어요)$/)) && hasFinal(m[1])) return tidy(s.slice(0, m.index) + m[1] + "음"); // 많아요 → 많음
    if ((m = s.match(/([가-힣])다$/)) && m.index > 0) {
      const ch = m[1];
      return tidy(s.slice(0, m.index) + (hasFinal(ch) ? ch + "음" : withFinal(ch, MIEUM))); // 많다 → 많음, 크다 → 큼
    }
    return tidy(s.replace(/요$/, ""));
  }
  const tidy = (s) => s.replace(/\s{2,}/g, " ").trim();

  // ---------- 날짜 ----------
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const dayIdx = (w) => DAYS.indexOf(w);
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  function fmtDate(d, withYear) {
    const md = `${d.getMonth() + 1}. ${d.getDate()}.(${DAYS[d.getDay()]})`;
    return withYear ? `${d.getFullYear()}. ${md}` : md;
  }
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function ymd(base, y, mo, d) {
    let date = new Date(y || base.getFullYear(), mo - 1, d);
    if (!y && date < addDays(base, -60)) date = new Date(base.getFullYear() + 1, mo - 1, d);
    return isNaN(date) ? null : date;
  }

  // 문장 속 날짜 표현을 모두 찾는다 → [{date, index, length}]
  const DATE_PATTERNS = [
    [/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?\.?(\s*\([월화수목금토일]\))?/g, (m, b) => ymd(b, +m[1], +m[2], +m[3])],
    [/(\d{1,2})\s*월\s*(\d{1,2})\s*일(\s*\([월화수목금토일]\))?/g, (m, b) => ymd(b, 0, +m[1], +m[2])],
    [/(?<![\d.])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?![\d.])(\s*\([월화수목금토일]\))?/g, (m, b) => ymd(b, 0, +m[1], +m[2])],
    [/(이번|금|이)\s*주\s*([월화수목금토일])요일/g, (m, b) => addDays(mondayOf(b), (dayIdx(m[2]) + 6) % 7)],
    [/(다음|담|차)\s*주\s*([월화수목금토일])요일/g, (m, b) => addDays(mondayOf(b), 7 + (dayIdx(m[2]) + 6) % 7)],
    [/(이번|금)\s*주(?=\s*(까지|중|내))/g, (m, b) => addDays(mondayOf(b), 4)],
    [/(다음|담)\s*주(?=\s*(까지|중|내))/g, (m, b) => addDays(mondayOf(b), 11)],
    [/(이번\s*달\s*말|월말)/g, (m, b) => new Date(b.getFullYear(), b.getMonth() + 1, 0)],
    [/다음\s*달\s*말/g, (m, b) => new Date(b.getFullYear(), b.getMonth() + 2, 0)],
    [/모레/g, (m, b) => addDays(b, 2)],
    [/내일/g, (m, b) => addDays(b, 1)],
    [/오늘/g, (m, b) => b],
  ];

  function findDates(s, base) {
    const found = [];
    for (const [re, fn] of DATE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const overlaps = found.some((f) => m.index < f.index + f.length && f.index < m.index + m[0].length);
        const date = fn(m, base);
        if (!overlaps && date) found.push({ date, index: m.index, length: m[0].length });
      }
    }
    return found.sort((a, b) => a.index - b.index);
  }

  // 기한 = "~까지 / ~전까지 / ~중 / 마감" 이 붙은 날짜
  function findDue(s, base) {
    for (const f of findDates(s, base)) {
      const after = s.slice(f.index + f.length);
      const before = s.slice(0, f.index);
      const tail = after.match(/^\s*(까지는|까지|전까지|중으로|중에|중|내로|내|마감)/);
      if (tail || /(기한|마감|due)\s*[:：]?\s*$/i.test(before)) {
        const lead = before.match(/(기한|마감)\s*[:：]?\s*$/);
        const start = lead ? f.index - lead[0].length : f.index;
        return { date: f.date, start, end: f.index + f.length + (tail ? tail[0].length : 0) };
      }
    }
    return null;
  }

  // ---------- 담당자 ----------
  const ROLE = "(?:팀장|과장|대리|부장|차장|실장|주임|사원|매니저|강사|선생님|교수|대표|본부장|센터장|담당자|PD|PM)";
  const SUBJECT_AFTER = /^(님)?\s*(이|가|께서|은|는|이랑|랑|에서)?(\s|$)/;
  const OBJECT_AFTER = /^(님)?\s*(에게|한테|께|과|와)/;

  function parseAttendees(text) {
    return text
      .split(/[,，、·\/]|\s및\s|\s+외\s/)
      .map((s) => s.replace(/님$/, "").replace(/\s*\(.*?\)\s*/g, "").trim())
      .filter((s) => s && s.length <= 15);
  }

  function findOwner(s, attendees) {
    const assigned = s.match(/담당(?:자)?\s*[:：]\s*([가-힣A-Za-z]{2,10}(?:\s?[가-힣]{1,4})?)/);
    if (assigned) return { name: assigned[1].trim(), text: assigned[0] };
    const at = s.match(/@([가-힣A-Za-z]{2,10})/);
    if (at) return { name: at[1], text: at[0] };

    let best = null;
    for (const person of attendees) {
      const core = person.split(/\s+/)[0];
      const re = new RegExp(person.replace(/\s+/g, "\\s*") + "|" + core, "g");
      let m;
      while ((m = re.exec(s))) {
        const after = s.slice(m.index + m[0].length);
        if (OBJECT_AFTER.test(after)) continue;
        const subj = after.match(SUBJECT_AFTER);
        const score = subj && subj[2] ? 2 : 1;
        if (!best || score > best.score) best = { name: person, index: m.index, length: m[0].length + (subj ? subj[0].trimEnd().length : 0), score };
      }
    }
    if (!best) {
      const re = new RegExp(`([가-힣]{1,4}\\s?${ROLE})(?=(님)?\\s*(이|가|께서|은|는)(\\s|$))`);
      const m = s.match(re);
      if (m) {
        const after = s.slice(m.index + m[0].length).match(SUBJECT_AFTER);
        best = { name: m[1], index: m.index, length: m[0].length + (after ? after[0].trimEnd().length : 0) };
      }
    }
    return best ? { name: best.name, text: s.substr(best.index, best.length) } : null;
  }

  // ---------- 할 일 이름 만들기 ("최종본 공유해 주시기로 함" → "최종본 공유") ----------
  const VERB_NOUN = {
    보내: "발송", 늘리: "확대", 줄이: "축소", 바꾸: "변경", 고치: "수정", 만들: "작성", 쓰: "작성",
    올리: "게시", 알리: "안내", 챙기: "준비", 정하: "결정", 찾: "확인", 받: "수령", 나누: "배부",
    돌리: "배포", 맞추: "조정", 넣: "반영", 빼: "제외", 옮기: "이전", 열: "개최", 잡: "확정",
    주: "전달", 드리: "전달", 묻: "문의", 물어보: "문의", 알아보: "조사", 살펴보: "검토", 뽑: "선정",
  };
  function verbToNoun(stem) {
    if (VERB_NOUN[stem]) return VERB_NOUN[stem];
    const ch = last(stem);
    if (finalOf(ch) === RIEUL) {
      const plain = stem.slice(0, -1) + withFinal(ch, 0);
      if (VERB_NOUN[plain]) return VERB_NOUN[plain];
    }
    return stem + "기";
  }

  function taskName(sentence, owner, due) {
    let s = sentence;
    // 기한·담당자 표현을 뒤에서부터 지운다
    const cuts = [];
    if (due) cuts.push([due.start, due.end]);
    if (owner) {
      const i = s.indexOf(owner.text);
      if (i >= 0) cuts.push([i, i + owner.text.length]);
    }
    cuts.sort((a, b) => b[0] - a[0]).forEach(([a, b]) => (s = s.slice(0, a) + " " + s.slice(b)));
    s = formalize(s);
    let m;
    if ((m = s.match(/(\S+?)(해|하)?\s*(주시|드리|주)?기로 (결정함|합의함|함)$/))) s = s.slice(0, m.index) + (m[2] ? m[1] : verbToNoun(m[1]));
    else if ((m = s.match(/(\S+?)(할)? 예정임$/))) s = s.slice(0, m.index) + (m[2] ? m[1] : verbToNoun(m[1]));
    else if ((m = s.match(/(\S+?)할 필요가 있(는 것으로 보임|음)$/))) s = s.slice(0, m.index) + m[1];
    else if ((m = s.match(/\s?요청함$/))) s = s.slice(0, m.index) + " 요청";
    else if ((m = s.match(/(\S+?)(함|됨)$/))) s = s.slice(0, m.index) + m[1];
    // 개조식: 조사 은/는/을/를 정리
    s = s.replace(/([가-힣]{2,})(은|는|을|를)(?=\s)/g, "$1");
    return tidy(s.replace(/^(다만|우선|이에 따라)\s/, ""));
  }

  // ---------- 문장 나누기 ----------
  const BULLET = /^\s*([-–•*·▶▷○●□■◆◇>]+|\d+[.)]|[가-하][.)])\s*/;
  const META = [
    ["title", /^(회의명|회의\s*제목|제목|주제|안건)\s*[:：]\s*(.+)$/],
    ["date", /^(일시|날짜|일자|회의일|회의\s*일시)\s*[:：]\s*(.+)$/],
    ["place", /^(장소|회의실|위치)\s*[:：]\s*(.+)$/],
    ["attendees", /^(참석자?|참여자?|참가자?|참석\s*인원)\s*[:：]\s*(.+)$/],
    ["writer", /^(작성자?|기록자?|서기)\s*[:：]\s*(.+)$/],
  ];
  const MEETING_WORD = /(회의|미팅|회의록|워크숍|간담회|협의회|보고회|세미나)/;

  function splitSentences(text) {
    const out = [];
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.replace(BULLET, "").trim();
      if (!line) continue;
      line.split(/(?<=[.!?])\s+(?=\S)/).forEach((p) => p.trim() && out.push(p.trim()));
    }
    return out;
  }

  // ---------- 분석 ----------
  const RE_DECIDE = /(결정|확정|합의|승인|채택|정했|정함|기로\s*(했|함|하|정|결정|합의))/;
  const RE_TASK_VERB = /(기로|할게|할께|겠|해야|하여야|해\s*주|해주|부탁|요청|제출|보내|보낼|공유|준비|작성|전달|확인|검토|발송|진행|예약|정리|안내|게시|업로드|올리|올릴)/;
  const RE_ISSUE = /(문제|이슈|우려|어려움|어렵|지연|부족|불편|고장|리스크|위험|꺼지|오류|버그|불만|민원|건의)/;

  /**
   * text → { meta: {title, date, place, attendees[], writer}, items: [{raw, type, text, owner, due}] }
   * type: "discuss" | "decide" | "task" | "issue"
   */
  function analyze(text, today = new Date()) {
    const meta = { title: "", date: null, dateText: "", place: "", attendees: [], writer: "" };
    const sentences = splitSentences(text);
    const body = [];

    sentences.forEach((s, i) => {
      for (const [key, re] of META) {
        const m = s.match(re);
        if (!m) continue;
        if (key === "attendees") meta.attendees = parseAttendees(m[2]);
        else if (key === "date") {
          meta.dateText = m[2].trim();
          const d = findDates(m[2], today)[0];
          if (d) meta.date = d.date;
        } else meta[key] = m[2].trim();
        return;
      }
      // 첫 줄이 짧고 "회의"가 들어 있으면 회의명(+날짜)으로 본다
      if (i === 0 && s.length <= 40 && MEETING_WORD.test(s) && !/(요|다|함|음)\.?$/.test(s)) {
        const d = findDates(s, today)[0];
        if (d) {
          meta.date = meta.date || d.date;
          s = (s.slice(0, d.index) + s.slice(d.index + d.length)).trim();
        }
        meta.title = meta.title || s.replace(/^[\[(]|[\])]$/g, "").replace(/\s*회의록$/, " 회의").trim();
        return;
      }
      body.push(s);
    });

    const base = meta.date || today;
    const items = body.map((raw) => {
      const owner = findOwner(raw, meta.attendees);
      const due = findDue(raw, base);
      let type = "discuss";
      if (owner || (due && RE_TASK_VERB.test(raw))) type = "task";
      else if (RE_DECIDE.test(raw)) type = "decide";
      else if (RE_ISSUE.test(raw)) type = "issue";
      return {
        raw,
        type,
        text: formalize(raw),
        task: taskName(raw, owner, due),
        owner: owner ? owner.name : "",
        due: due ? fmtDate(due.date) : "",
        dueIso: due ? isoDate(due.date) : "",
      };
    });
    return { meta, items };
  }

  // ---------- 보고서 모양 ----------
  const SECTIONS = [
    ["discuss", "주요 논의 내용"],
    ["decide", "결정 사항"],
    ["task", "향후 조치 계획"],
    ["issue", "건의 및 이슈"],
  ];

  function reportTitle(title) {
    const t = (title || "").trim();
    if (!t) return "회의 결과 보고";
    return MEETING_WORD.test(t) ? `${t} 결과 보고` : `${t} 회의 결과 보고`;
  }

  // 복사용 글 (개조식)
  function toText(report) {
    const lines = [reportTitle(report.title), ""];
    if (report.written) lines.push(report.written, "");
    lines.push("1. 회의 개요");
    lines.push(`  ○ 일시: ${report.date || "-"}`);
    lines.push(`  ○ 장소: ${report.place || "-"}`);
    lines.push(`  ○ 참석자: ${report.attendees || "-"}`);
    SECTIONS.forEach(([key, label], i) => {
      lines.push("", `${i + 2}. ${label}`);
      const list = report.items.filter((it) => it.type === key);
      if (!list.length) lines.push("  ○ 해당 없음");
      else if (key === "task")
        list.forEach((it, n) => lines.push(`  ${n + 1}) ${it.task}${it.owner ? ` / 담당: ${it.owner}` : ""}${it.due ? ` / 기한: ${it.due}` : ""}`));
      else list.forEach((it) => lines.push(`  ○ ${it.text}`));
    });
    return lines.join("\n");
  }

  window.Minutes = { analyze, formalize, taskName, reportTitle, toText, SECTIONS, fmtDate, isoDate, findDates };
})();
