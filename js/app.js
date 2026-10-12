/*
 * app.js — 양식 채우기 화면: 입력 → 칸 확인 → 미리보기 → 받기·Gmail
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VALUE_KEYS = ["title", "date", "time", "content", "name", "org", "phone", "email", "writeDate", "rrn", "bank", "account"];
  const PROFILE_KEYS = ["name", "org", "phone", "email", "bank", "account"]; // 주민등록번호는 따로 (기억하기를 켰을 때만)
  const LECTURE_KEYS = ["title", "date", "time", "content"];

  const state = {
    form: null,          // Hwpx.load 결과
    slots: [],           // 찾은 칸
    choice: new Map(),   // slot.id → fieldKey ("" = 넣지 않음)
    sig: null,           // { url, ratio, bytes } — 실제로 넣을 서명
    sigDraft: null,      // { orig, clean } — 배경 지우는 중인 서명
    result: null,
    selectedEmails: new Set(),
    mailEdited: { subject: false, body: false },
  };

  // ---------- 알림 ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  function debounce(fn, ms) {
    let id;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }

  // ---------- 날짜 ----------
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  function formatDate(d, withDay) {
    const s = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
    return withDay ? `${s}(${DAYS[d.getDay()]})` : s;
  }
  document.querySelectorAll(".picker").forEach((p) =>
    p.addEventListener("change", () => {
      if (!p.value) return;
      const [y, m, d] = p.value.split("-").map(Number);
      const target = $(p.dataset.target);
      target.value = formatDate(new Date(y, m - 1, d), p.dataset.target === "f-date");
      target.dispatchEvent(new Event("input", { bubbles: true }));
    })
  );

  // ---------- 입력값 ----------
  function values() {
    const v = {};
    for (const k of VALUE_KEYS) v[k] = $("f-" + k).value;
    return v;
  }

  // 양식에 은행명 칸이 없고 계좌번호 칸만 있으면 "은행명 계좌번호"로 한 칸에 넣는다
  function fillValues() {
    const v = values();
    v.signWithName = $("sig-with-name").checked;
    const chosen = new Set(state.choice.values());
    if (v.bank.trim() && v.account.trim() && chosen.has("account") && !chosen.has("bank")) v.account = `${v.bank.trim()} ${v.account.trim()}`;
    return v;
  }

  function restoreInputs() {
    const profile = Store.getProfile();
    const lecture = Store.getLecture();
    if (profile.remember === false) $("remember").checked = false;
    for (const k of PROFILE_KEYS) if (profile[k]) $("f-" + k).value = profile[k];
    for (const k of LECTURE_KEYS) if (lecture[k]) $("f-" + k).value = lecture[k];
    $("f-writeDate").value = formatDate(new Date(), false);
    const rrn = Store.getRrn();
    if (rrn) { $("f-rrn").value = rrn; $("remember-rrn").checked = true; }
  }

  const saveInputs = debounce(() => {
    if (!$("remember").checked) return;
    const v = values();
    const profile = { remember: true };
    PROFILE_KEYS.forEach((k) => (profile[k] = v[k]));
    const lecture = {};
    LECTURE_KEYS.forEach((k) => (lecture[k] = v[k]));
    Store.setProfile(profile);
    Store.setLecture(lecture);
    if ($("remember-rrn").checked) Store.setRrn(v.rrn);
    else Store.removeRrn();
  }, 400);

  $("remember").addEventListener("change", (e) => {
    if (e.target.checked) {
      saveInputs();
      if (state.sig) Store.setSignature({ url: state.sig.url, ratio: state.sig.ratio });
      toast("이 브라우저에 기억해 둘게요.");
    } else {
      Store.clearAll();
      Store.setProfile({ remember: false });
      $("remember-rrn").checked = false;
      toast("저장해 둔 정보와 서명을 지웠어요.");
    }
  });

  $("remember-rrn").addEventListener("change", (e) => {
    if (e.target.checked && !$("remember").checked) $("remember").checked = true;
    if (e.target.checked) { saveInputs(); toast("주민등록번호도 이 브라우저에 기억할게요. 공용 PC에서는 꺼 주세요."); }
    else { Store.removeRrn(); toast("저장해 둔 주민등록번호를 지웠어요."); }
  });

  // ---------- 주민등록번호·계좌번호 입력 ----------
  $("f-rrn").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 13);
    e.target.value = d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
    $("rrn-hint").hidden = true;
  });
  $("f-rrn").addEventListener("blur", (e) => {
    $("rrn-hint").hidden = !e.target.value || /^\d{6}-\d{7}$/.test(e.target.value);
  });
  $("rrn-reveal").addEventListener("click", (e) => {
    const shown = $("f-rrn").classList.toggle("masked") === false;
    e.currentTarget.textContent = shown ? "숨기기" : "보기";
    e.currentTarget.setAttribute("aria-pressed", String(shown));
  });
  $("f-account").addEventListener("input", (e) => {
    const clean = e.target.value.replace(/[^\d-]/g, "");
    if (clean !== e.target.value) e.target.value = clean;
  });

  document.querySelectorAll(".tool-steps input, .tool-steps textarea").forEach((el) => {
    if (el.closest(".mail") || el.type === "file" || el.type === "range" || el.type === "checkbox") return;
    el.addEventListener("input", () => { saveInputs(); refresh(); fillMailDefaults(); });
  });

  // ---------- ① 양식 ----------
  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function openForm(buffer, name) {
    $("hwp-notice").hidden = true;
    $("form-error").hidden = true;
    try {
      const form = await Hwpx.load(buffer, name);
      state.form = form;
      state.slots = Hwpx.findSlots(form);
      state.choice = new Map(state.slots.map((s) => [s.id, s.fieldKey]));
      $("drop").classList.add("has-file");
      $("form-name").textContent = name;
      $("download").disabled = false;
      updatePdfButton();
      if (!pdfReady) $("pdf-guide").open = true;
      renderSlots();
      refresh();
      const found = state.slots.filter((s) => s.fieldKey).length;
      toast(found ? `칸 ${found}개를 찾았어요. 4번에서 확인해 주세요.` : "자동으로 찾은 칸이 없어요. 4번에서 직접 골라 주세요.");
    } catch (err) {
      if (err.code === "OLD_HWP") {
        $("hwp-notice").hidden = false;
      } else {
        $("form-error").textContent = err.message || "양식을 열지 못했어요.";
        $("form-error").hidden = false;
      }
    }
  }

  function handleFormFile(file) {
    if (!file) return;
    if (!/\.(hwpx|hwp)$/i.test(file.name)) {
      $("form-error").textContent = "한글 양식 파일(.hwpx)만 올릴 수 있어요.";
      $("form-error").hidden = false;
      return;
    }
    file.arrayBuffer().then((buf) => openForm(buf, file.name));
  }

  $("form-file").addEventListener("change", (e) => handleFormFile(e.target.files[0]));
  $("use-sample-form").addEventListener("click", () =>
    openForm(base64ToBuffer(SAMPLE_DATA.formBase64), SAMPLE_DATA.formName)
  );

  function enableDrop(label, onFile) {
    ["dragenter", "dragover"].forEach((t) => label.addEventListener(t, (e) => { e.preventDefault(); label.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => label.addEventListener(t, () => label.classList.remove("over")));
    label.addEventListener("drop", (e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); });
  }
  enableDrop($("drop"), handleFormFile);

  // ---------- ③ 서명 ----------
  function useSignature(sig, persist) {
    state.sig = { url: sig.url, ratio: sig.ratio, bytes: Signature.dataUrlToBytes(sig.url) };
    if (persist && $("remember").checked) Store.setSignature({ url: sig.url, ratio: sig.ratio });
    $("sig-saved-img").src = sig.url;
    $("sig-saved").hidden = false;
    $("sig-new").hidden = true;
    $("sig-edit").hidden = true;
    state.sigDraft = null;
    refresh();
  }

  async function cleanDraft() {
    const d = state.sigDraft;
    if (!d) return;
    $("sig-error").hidden = true;
    try {
      d.clean = await Signature.removeBackground(d.orig, +$("sig-strength").value);
      $("sig-clean").src = d.clean.url;
    } catch (err) {
      $("sig-error").textContent = err.message;
      $("sig-error").hidden = false;
    }
  }

  async function startDraft(dataUrl) {
    state.sigDraft = { orig: dataUrl, clean: null };
    $("sig-orig").src = dataUrl;
    $("sig-strength").value = 50;
    $("sig-edit").hidden = false;
    await cleanDraft();
  }

  async function handleSigFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      $("sig-error").textContent = "사진 파일(JPG, PNG)만 올릴 수 있어요.";
      $("sig-error").hidden = false;
      return;
    }
    startDraft(await Signature.fileToDataUrl(file));
  }

  $("sig-file").addEventListener("change", (e) => handleSigFile(e.target.files[0]));
  enableDrop(document.querySelector(".drop-small"), handleSigFile);
  $("use-sample-sig").addEventListener("click", () => startDraft(`data:${SAMPLE_DATA.signatureMime || "image/png"};base64,${SAMPLE_DATA.signatureBase64}`));
  $("sig-strength").addEventListener("input", debounce(cleanDraft, 150));
  $("sig-with-name").addEventListener("change", () => refresh());
  $("sig-save").addEventListener("click", () => {
    if (!state.sigDraft || !state.sigDraft.clean) return;
    useSignature(state.sigDraft.clean, true);
    toast("서명을 넣을 준비가 됐어요.");
  });
  $("sig-change").addEventListener("click", () => {
    $("sig-new").hidden = false;
    $("sig-file").value = "";
  });
  // 이미지를 못 불러오면 src 를 지워서 이모티콘 자리 표시가 보이게 한다
  document.querySelectorAll(".sig-box img").forEach((img) =>
    img.addEventListener("error", () => img.removeAttribute("src"))
  );

  $("sig-delete").addEventListener("click", () => {
    state.sig = null;
    Store.removeSignature();
    $("sig-saved-img").removeAttribute("src");
    $("sig-saved").hidden = true;
    $("sig-new").hidden = false;
    $("sig-edit").hidden = true;
    refresh();
    toast("서명을 지웠어요.");
  });

  // ---------- ④ 칸 확인 ----------
  function renderSlots() {
    const list = $("slots");
    list.innerHTML = "";
    $("slots-empty").hidden = !!state.form;
    if (state.form && !state.slots.length) {
      $("slots-empty").hidden = false;
      $("slots-empty").textContent = "표 안에서 채울 칸을 찾지 못했어요. 표가 아닌 양식은 아직 지원하지 않아요.";
    }
    // 알아본 칸을 먼저, 못 알아본 칸은 뒤에
    const ordered = state.slots.slice().sort((a, b) => (b.known - a.known));
    for (const slot of ordered) {
      const li = document.createElement("li");
      const chosen = state.choice.get(slot.id);
      li.className = "slot" + (slot.known && !slot.exact ? " is-check" : "");
      const badge = !slot.known ? "" : slot.exact ? '<span class="badge badge-auto">자동</span>' : '<span class="badge badge-check">확인 필요</span>';
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `'${slot.labelText}' 칸에 넣을 항목`);
      sel.innerHTML =
        '<option value="">넣지 않음</option>' +
        Hwpx.FIELDS.map((f) => `<option value="${f.key}">${f.label}</option>`).join("");
      sel.value = chosen || "";
      sel.addEventListener("change", () => {
        state.choice.set(slot.id, sel.value);
        renderMissing();
        refresh();
      });
      const lab = document.createElement("span");
      lab.className = "slot-label";
      lab.title = slot.labelText;
      lab.textContent = slot.labelText;
      lab.insertAdjacentHTML("beforeend", badge + `<small>${slot.known ? "양식의 칸 이름" : "알아보지 못한 칸 · 필요하면 골라 주세요"}</small>`);
      const arrow = document.createElement("span");
      arrow.className = "slot-arrow";
      arrow.textContent = "→";
      li.append(lab, arrow, sel);
      li.addEventListener("mouseenter", () => highlightPreview(slot.id, true));
      li.addEventListener("mouseleave", () => highlightPreview(slot.id, false));
      list.appendChild(li);
    }
    renderMissing();
  }

  function renderMissing() {
    const used = new Set(state.choice.values());
    const missing = Hwpx.FIELDS.filter((f) => !used.has(f.key)).map((f) => f.label);
    const el = $("slots-missing");
    el.hidden = !state.form || !missing.length;
    el.textContent = `양식에서 찾지 못한 항목: ${missing.join(", ")}. 해당하는 칸이 위 목록에 있으면 직접 골라 주세요.`;
  }

  function highlightPreview(id, on) {
    const td = $("preview").querySelector(`td[data-slot="${CSS.escape(id)}"]`);
    if (td) td.style.boxShadow = on ? "inset 0 0 0 3px #2f5bd3" : "";
  }

  // ---------- 미리보기 ----------
  const refresh = debounce(() => {
    if (!state.form) return;
    const assignments = state.slots.map((slot) => ({ slot, fieldKey: state.choice.get(slot.id) }));
    try {
      state.result = Hwpx.fill(state.form, assignments, fillValues(), state.sig);
      const slotIds = new Set(state.slots.map((s) => s.id));
      const paper = $("preview");
      paper.innerHTML = '<svg class="clip"><use href="#clip"/></svg>' + Hwpx.renderPreview(state.form, state.result, slotIds);
    } catch (err) {
      console.error(err);
      $("form-error").textContent = "미리보기를 만드는 중에 문제가 생겼어요: " + err.message;
      $("form-error").hidden = false;
    }
  }, 120);

  // ---------- ⑤ 받기 ----------
  function outputName() {
    const base = state.form.name.replace(/\.(hwpx|hwp)$/i, "");
    return `${base}_작성완료.hwpx`;
  }

  async function buildHwpx() {
    const assignments = state.slots.map((slot) => ({ slot, fieldKey: state.choice.get(slot.id) }));
    const result = Hwpx.fill(state.form, assignments, fillValues(), state.sig);
    const blob = await Hwpx.save(state.form, result);
    const missingSig = assignments.some((x) => x.fieldKey === "sign") && !state.sig;
    return { blob, missingSig };
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  $("download").addEventListener("click", async () => {
    if (!state.form) return;
    const btn = $("download");
    btn.disabled = true;
    try {
      const { blob, missingSig } = await buildHwpx();
      saveBlob(blob, outputName());
      toast(missingSig ? "받았어요. 서명은 아직 넣지 않았어요 (3번에서 서명을 올려 주세요)." : "받았어요. 한글에서 열어 확인해 주세요.");
    } catch (err) {
      $("form-error").textContent = "파일을 만들지 못했어요: " + err.message;
      $("form-error").hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- PDF (변환 서버) ----------
  const PDF_SERVER = (window.APP_CONFIG && APP_CONFIG.pdfServer || "").replace(/\/$/, "");
  let pdfReady = false;
  let pdfEngine = ""; // "hangul" = 이 PC의 한글로 변환 (원본과 같은 모양), "libreoffice" = Docker 변환 서버

  function setPdfStatus(text) { $("pdf-status").textContent = text; }
  function updatePdfButton() { $("download-pdf").disabled = !(pdfReady && state.form); }

  async function checkPdfServer() {
    if (!PDF_SERVER) { setPdfStatus("PDF 변환 서버가 설정되지 않았어요. 한글에서 PDF로 저장해 주세요."); return; }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(PDF_SERVER + "/health", { signal: ctl.signal });
      clearTimeout(timer);
      pdfReady = r.ok;
      pdfEngine = pdfReady ? (await r.json().catch(() => ({}))).engine || "" : "";
    } catch (_) {
      pdfReady = false;
    }
    if (!pdfReady) setPdfStatus("PDF 변환 서버가 꺼져 있어요. 받은 .hwpx를 한글에서 PDF로 저장해 주세요.");
    else if (pdfEngine === "hangul") setPdfStatus("PDF로 받으면 한글 프로그램으로 PDF를 만들어요. 변환에 쓴 파일은 바로 지워요.");
    else setPdfStatus("PDF로 받으면 변환 서버가 서류를 PDF로 바꾼 뒤 바로 지워요.");
    $("pdf-guide").open = !pdfReady && !!state.form;
    updatePdfButton();
  }

  $("download-pdf").addEventListener("click", async () => {
    if (!state.form || !pdfReady) return;
    const btn = $("download-pdf");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "PDF로 바꾸는 중…";
    try {
      const { blob, missingSig } = await buildHwpx();
      const r = await fetch(PDF_SERVER + "/convert", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      if (!r.ok) {
        const msg = await r.json().then((j) => j.error).catch(() => "");
        throw new Error(msg || `변환 서버 오류 (${r.status})`);
      }
      saveBlob(await r.blob(), outputName().replace(/\.hwpx$/, ".pdf"));
      toast(missingSig ? "PDF를 받았어요. 서명은 아직 넣지 않았어요." : pdfEngine === "hangul" ? "PDF를 받았어요." : "PDF를 받았어요. 모양이 다르면 한글에서 직접 저장해 주세요.");
    } catch (err) {
      $("form-error").textContent = "PDF로 바꾸지 못했어요: " + err.message + " 받은 .hwpx를 한글에서 PDF로 저장해 주세요.";
      $("form-error").hidden = false;
      checkPdfServer();
    } finally {
      btn.textContent = label;
      updatePdfButton();
    }
  });

  // ---------- Gmail ----------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function renderChips() {
    const box = $("email-chips");
    box.innerHTML = "";
    for (const item of Store.getEmails()) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.setAttribute("role", "option");
      chip.tabIndex = 0;
      const selected = state.selectedEmails.has(item.address);
      chip.setAttribute("aria-selected", String(selected));
      chip.innerHTML = `<span></span><small></small><button type="button" class="x" aria-label="삭제">×</button>`;
      chip.children[0].textContent = item.name || item.address;
      chip.children[1].textContent = item.name ? item.address : "";
      const toggle = () => {
        if (state.selectedEmails.has(item.address)) state.selectedEmails.delete(item.address);
        else state.selectedEmails.add(item.address);
        renderChips();
      };
      chip.addEventListener("click", (e) => { if (!e.target.classList.contains("x")) toggle(); });
      chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      chip.querySelector(".x").addEventListener("click", () => {
        Store.setEmails(Store.getEmails().filter((x) => x.address !== item.address));
        state.selectedEmails.delete(item.address);
        renderChips();
      });
      box.appendChild(chip);
    }
    $("open-gmail").disabled = state.selectedEmails.size === 0;
  }

  $("add-email").addEventListener("submit", (e) => {
    e.preventDefault();
    const address = $("new-email").value.trim();
    const name = $("new-email-name").value.trim();
    if (!EMAIL_RE.test(address)) { toast("이메일 주소를 다시 확인해 주세요."); return; }
    const list = Store.getEmails().filter((x) => x.address !== address);
    list.push({ name, address });
    if (!Store.setEmails(list)) toast("이 브라우저에는 저장할 수 없어요. 이번에만 쓸게요.");
    state.selectedEmails.add(address);
    $("new-email").value = "";
    $("new-email-name").value = "";
    renderChips();
  });

  function fillMailDefaults() {
    const v = values();
    const title = v.title || "강의";
    if (!state.mailEdited.subject) $("mail-subject").value = `[강사료 서류] ${title}${v.name ? ` - ${v.name}` : ""}`;
    if (!state.mailEdited.body) {
      $("mail-body").value =
        `안녕하세요${v.name ? `, ${v.name}입니다` : ""}.\n` +
        `${v.date ? v.date + "에 " : ""}진행한 「${title}」 강의 관련 서류를 보내 드립니다.\n` +
        `첨부한 파일 확인 부탁드립니다.\n\n감사합니다.\n` +
        (v.name ? `${v.name} 드림${v.phone ? ` (${v.phone})` : ""}` : "");
    }
  }
  $("mail-subject").addEventListener("input", () => (state.mailEdited.subject = true));
  $("mail-body").addEventListener("input", () => (state.mailEdited.body = true));

  $("open-gmail").addEventListener("click", () => {
    const to = Array.from(state.selectedEmails).join(",");
    if (!to) return;
    const url =
      "https://mail.google.com/mail/?view=cm&fs=1" +
      "&to=" + encodeURIComponent(to) +
      "&su=" + encodeURIComponent($("mail-subject").value) +
      "&body=" + encodeURIComponent($("mail-body").value);
    window.open(url, "_blank", "noopener");
    toast("Gmail 창에서 받은 서류를 첨부해 주세요.");
  });

  // ---------- 모두 지우기 ----------
  $("clear-all").addEventListener("click", () => {
    if (!confirm("이 브라우저에 저장된 내 정보, 강의 정보, 서명, 이메일 주소를 모두 지울까요?")) return;
    Store.clearAll();
    location.reload();
  });

  // ---------- 시작 ----------
  restoreInputs();
  const savedSig = Store.getSignature();
  if (savedSig && savedSig.url) useSignature(savedSig, false);
  renderChips();
  fillMailDefaults();
  checkPdfServer();
})();
