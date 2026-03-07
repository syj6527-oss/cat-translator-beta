// =============================================
// 🐱 캣 트랜스레이터 v19.0 - cache.js
// IndexedDB 영구 캐시 관련 로직
// =============================================

export let db = null; // DB 인스턴스 (main.js에서 initDB() 호출 후 사용 가능)

// ── DB 초기화 ──────────────────────────────
// 앱 시작 시 1회 호출. "CatTranslatorCache" DB 없으면 새로 생성.
export const initDB = async () => {
    return new Promise((resolve) => {
        const request = indexedDB.open("CatTranslatorCache", 1);
        request.onupgradeneeded = (e) => {
            // "cache" 스토어가 없으면 생성 (키: id)
            if (!e.target.result.objectStoreNames.contains("cache"))
                e.target.result.createObjectStore("cache", { keyPath: "id" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror   = ()  => resolve(null); // DB 실패해도 앱은 계속 동작
    });
};

// ── 캐시 읽기 ──────────────────────────────
// id에 해당하는 캐시가 있으면 반환, 없으면 null 반환
export const dbGet = (id) => new Promise(r => {
    if (!db) return r(null);
    const req = db.transaction(["cache"], "readonly").objectStore("cache").get(id);
    req.onsuccess = () => r(req.result);
    req.onerror   = () => r(null);
});

// ── 캐시 저장 ──────────────────────────────
// { id, translation } 형태의 객체를 저장
export const dbPut = (data) => new Promise(r => {
    if (!db) return r(false);
    const req = db.transaction(["cache"], "readwrite").objectStore("cache").put(data);
    req.onsuccess = () => r(true);
    req.onerror   = () => r(false);
});

// ── 캐시 전체 삭제 ─────────────────────────
// 번역 기록 초기화 버튼에서 호출
export const dbClearAll = () => new Promise(r => {
    if (!db) return r(false);
    const req = db.transaction(["cache"], "readwrite").objectStore("cache").clear();
    req.onsuccess = () => r(true);
    req.onerror   = () => r(false);
});
