/*
 * storage.js — 비회원 저장소. 이 브라우저(localStorage)에만 저장한다.
 * 2단계에서 회원 계정(Supabase) 저장소를 같은 모양으로 붙인다.
 */
(function () {
  "use strict";

  const PREFIX = "docclean.";

  function get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false; // 시크릿 창이거나 저장 공간이 꽉 찬 경우
    }
  }

  function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (_) {}
  }

  window.Store = {
    getProfile: () => get("profile", {}),
    setProfile: (p) => set("profile", p),
    getSignature: () => get("signature", null), // { url, ratio }
    setSignature: (s) => set("signature", s),
    removeSignature: () => remove("signature"),
    getEmails: () => get("emails", []), // [{ name, address }]
    setEmails: (list) => set("emails", list),
    getLecture: () => get("lecture", {}),
    setLecture: (l) => set("lecture", l),
    // 주민등록번호는 따로 둔다: 사용자가 '기억하기'를 켰을 때만 저장
    getRrn: () => get("rrn", ""),
    setRrn: (v) => set("rrn", v),
    removeRrn: () => remove("rrn"),
    clearAll: () => ["profile", "signature", "emails", "lecture", "rrn"].forEach(remove),
  };
})();
