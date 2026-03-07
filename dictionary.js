// =============================================
// 🐱 캣 트랜스레이터 v19.0 - dictionary.js
// 사전 파싱 및 드래그 즉시 등록 로직
// =============================================

// ── 사전 파싱 ──────────────────────────────
// settings.dictionaryText의 "Ghost=고스트" 형식을 배열로 변환
// 반환값 예: [{ o: "Ghost", t: "고스트" }, ...]
export function parseDictionary(dictionaryText) {
    return dictionaryText
        .split('\n')
        .map(l => l.split('='))
        .filter(p => p.length === 2 && p[0].trim() !== '')
        .map(p => ({ o: p[0].trim(), t: p[1].trim() }));
}

// ── 사전 치환 적용 ─────────────────────────
// 번역 전 원문에서 사전 단어를 미리 치환 (대소문자 무시)
export function applyDictionary(text, dictionaryText) {
    let processed = text;
    parseDictionary(dictionaryText).forEach(d => {
        // 정규식 특수문자 이스케이프 처리
        const escaped = d.o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processed = processed.replace(new RegExp(escaped, 'gi'), d.t);
    });
    return processed;
}

// ── 🖱️ 드래그 → 사전 즉시 등록 ──────────────
// 텍스트 드래그 시 🐾 버튼 팝업 → 클릭하면 사전에 추가
// catNotify, saveSettings 는 main.js에서 주입받음 (순환 참조 방지)
export function setupQuickAdd(settings, catNotify, saveSettings) {
    $(document).on('mouseup touchend', function(e) {
        // 🐾 버튼 자기 자신 클릭은 무시
        if ($(e.target).closest('.cat-quick-paw').length) return;

        setTimeout(() => {
            const selection    = window.getSelection();
            const selectedText = selection.toString().trim();
            $('.cat-quick-paw').remove();

            // 1~50자 범위의 텍스트만 처리
            if (selectedText && selectedText.length > 0 && selectedText.length < 50) {
                const range = selection.getRangeAt(0);
                const rect  = range.getBoundingClientRect();

                // 🐾 팝업 버튼 생성 및 위치 설정
                const paw = $(`<div class="cat-quick-paw" title="사전에 추가">🐾</div>`);
                $('body').append(paw);
                paw.css({
                    top:  rect.top  + window.scrollY - 35,
                    left: rect.left + window.scrollX + (rect.width / 2) - 15
                });

                // 🐾 버튼 클릭 → 번역어 입력 → 사전에 저장
                paw.on('mousedown touchstart', function(ev) {
                    ev.preventDefault();
                    ev.stopPropagation();

                    const trans = prompt(`🐱 "${selectedText}" 의 번역어를 입력하세요:\n(예: 고스트)`);
                    if (trans) {
                        // 기존 사전 내용에 새 항목 추가
                        let cur = $('#ct-dict').val() || '';
                        if (cur && !cur.endsWith('\n')) cur += '\n';
                        cur += `${selectedText}=${trans}`;

                        $('#ct-dict').val(cur);
                        settings.dictionaryText = cur;
                        saveSettings(settings);
                        catNotify(`🐱 사전 등록: ${selectedText} = ${trans}`);
                    }
                    paw.remove();
                });
            }
        }, 100);
    });
}
