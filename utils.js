// ============================================================
// 🐱 Translator v1.0.3 - utils.js
// 유틸리티: 알림, 정규식 세탁기, HTML/CSS 방어, 언어 감지
// ============================================================

export function getThemeEmoji() {
    const theme = document.body.getAttribute('data-cat-theme');
    return theme === 'tiger' ? '🐯' : '🐱';
}

export function getCompletionEmoji() {
    const theme = document.body.getAttribute('data-cat-theme');
    return theme === 'tiger' ? '🍖' : '🐟';
}

export function catNotify(message, type = 'success') {
    // 같은 내용 중복 알림 방지
    const existing = $('.cat-notification');
    let isDuplicate = false;
    existing.each(function() { if ($(this).text() === message) isDuplicate = true; });
    if (isDuplicate) return existing.first();
    
    // 최대 3개까지만 스택, 오래된 것부터 제거
    if (existing.length >= 3) existing.first().removeClass('show').remove();
    
    const emoji = getThemeEmoji();
    const colors = { success: '#2ecc71', warning: '#f39c12', error: '#e74c3c', progress: '#f39c12', autosave: '#1e8449' };
    const bgColor = colors[type] || colors.success;
    const displayMsg = message.replace(/^(🐱|🐯)\s*/, `${emoji} `);
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${displayMsg}</div>`);
    $('body').append(notifyHtml);
    
    // 스택 위치 계산: 기존 알림들 아래에 쌓기
    const _recalcStack = () => {
        let topOffset = 20;
        $('.cat-notification.show').each(function() {
            $(this).css('top', topOffset + 'px');
            topOffset += $(this).outerHeight() + 8;
        });
    };
    
    requestAnimationFrame(() => { notifyHtml.addClass('show'); _recalcStack(); });

    if (type !== 'progress') {
        setTimeout(() => {
            notifyHtml.removeClass('show');
            setTimeout(() => { notifyHtml.remove(); _recalcStack(); }, 500);
        }, 2500);
    }
    return notifyHtml;
}

export function catNotifyProgress(message, onAbort) {
    const el = catNotify(message, 'progress');
    if (onAbort) {
        el.css({ cursor: 'pointer', pointerEvents: 'auto' });
        el.on('click', () => { onAbort(); el.removeClass('show'); setTimeout(() => el.remove(), 500); });
    }
    return el;
}

// 🚨 정밀 클리너: AI가 추가한 래핑만 제거, 원본 코드블록/YAML 보존!
export function cleanResult(text, originalText = null) {
    if (!text) return "";
    
    // AI가 앞에 붙이는 "번역:" 등 접두어 제거
    let cleaned = text.replace(/^(번역|Translation|Output|Input|Result):\s*/gi, "");
    
    // AI가 응답 전체를 코드블록으로 감싼 경우만 벗기기
    // 단, 내부에 코드블록이 있으면(원본 코드블록) 건드리지 않음
    const wholeCodeBlockMatch = cleaned.match(/^```[a-z]*\n([\s\S]*?)\n```\s*$/i);
    if (wholeCodeBlockMatch) {
        const inner = wholeCodeBlockMatch[1];
        // 내부에 ``` 가 없으면 = AI가 래핑한 것 → 벗기기
        // 내부에 ``` 가 있으면 = 원본 코드블록 포함 → 건드리지 않음
        if (!inner.includes('```')) {
            cleaned = inner;
        }
    }
    
    // 🚨 AI 생성모드 감지: 번역이 아닌 RP 이어쓰기/시스템 프롬프트 번역 방지
    if (originalText) {
        const ratio = cleaned.length / originalText.length;
        // 비율 3배 초과 + 시스템 프롬프트 패턴 감지 → 오염된 결과
        const systemPatterns = /\[ABSOLUTE DIRECTIVE|\[SYSTEM|\[OOC|\[IMPORTANT|DO NOT narrate|DO NOT summarize|DO NOT break|Write the full simulation|as an unbroken narrative|maintaining their established voice/i;
        if (ratio > 3 && systemPatterns.test(cleaned)) {
            console.warn('[CAT] 🚨 AI 생성모드 감지: 시스템 프롬프트 오염. 결과 폐기.');
            return "";
        }
        // 비율 4배 초과 (시스템 패턴 없어도) → 이어쓰기 의심, 원문 길이 기준 잘라내기
        if (ratio > 4) {
            console.warn(`[CAT] ⚠️ 번역 결과 비정상 길이 (${ratio.toFixed(1)}배). 원문 기준 잘라냄.`);
            const cutPoint = originalText.length * 3;
            cleaned = cleaned.substring(0, cutPoint);
            // 문장 중간 잘림 방지: 마지막 온전한 문장까지만
            const lastSentence = cleaned.match(/.*[.!?。！？」』\])\n]/s);
            if (lastSentence) cleaned = lastSentence[0];
        }
    }
    
    // 줄바꿈 정리 (원본 구조 보존하면서)
    cleaned = cleaned
        .replace(/\r\n/g, "\n")        // \r\n → \n 통일
        .replace(/\n{4,}/g, "\n\n\n"); // 빈줄 4개 이상만 정리 (3개까지는 유지)
    
    return cleaned.trim();
}

export function getCacheModelKey(settings) {
    let key;
    if (settings.profile) key = `profile:${settings.profile}`;
    else key = settings.directModel || 'default';
    if (settings.dialogueBilingual && settings.dialogueBilingual !== 'off') {
        key += `::bilingual:${settings.dialogueBilingual}`;
    }
    return key;
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    if (lower.includes('pro') || lower.includes('프로') || lower.includes('호랑이') || lower.includes('tiger')) return 'tiger';
    if (lower.includes('flash') || lower.includes('플래') || lower.includes('플레') || lower.includes('고양이') || lower.includes('cat')) return 'cat';
    if (lower.includes('vertex')) {
        if (lower.includes('pro')) return 'tiger';
        return 'cat';
    }
    return 'cat';
}

export function detectLanguageDirection(text, settings) {
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    const jpCount = (text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
    const cnCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
    const total = korCount + engCount + jpCount + cnCount;

    if (total === 0) return { isToEnglish: false, targetLang: settings.targetLang };
    const korRatio = korCount / total; const engRatio = engCount / total;
    const jpRatio = jpCount / total; const cnRatio = cnCount / total;
    const bidir = settings.bidirectional || 'off';

    // 양방향 꺼짐 → 무조건 목표 언어로만
    if (bidir === 'off') {
        return { isToEnglish: false, targetLang: settings.targetLang };
    }

    // 한↔영
    if (bidir === 'ko-en') {
        if (korRatio >= 0.7) return { isToEnglish: true, targetLang: 'English' };
        if (engRatio >= 0.7) return { isToEnglish: false, targetLang: 'Korean' };
    }

    // 한↔일
    if (bidir === 'ko-ja') {
        if (korRatio >= 0.7) return { isToEnglish: false, targetLang: 'Japanese' };
        if (jpRatio >= 0.5) return { isToEnglish: false, targetLang: 'Korean' };
    }

    // 한↔중
    if (bidir === 'ko-zh') {
        if (korRatio >= 0.7) return { isToEnglish: false, targetLang: 'Chinese' };
        if (cnRatio >= 0.5) return { isToEnglish: false, targetLang: 'Korean' };
    }

    return { isToEnglish: false, targetLang: settings.targetLang };
}

export function applyPreReplace(text, dictionary, isToEnglish) { return applyPreReplaceWithCount(text, dictionary, isToEnglish).swapped; }
export function applyPreReplaceWithCount(text, dictionary, isToEnglish) {
    if (!dictionary || dictionary.trim() === "") return { swapped: text, matchCount: 0 };
    const lines = dictionary.split('\n').filter(l => l.includes('='));
    if (lines.length === 0) return { swapped: text, matchCount: 0 };

    let result = text; let matchCount = 0;
    lines.sort((a, b) => b.split('=')[0].length - a.split('=')[0].length);

    lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const orig = parts[0].trim(); const trans = parts.slice(1).join('=').trim();
            const searchStr = isToEnglish ? trans : orig; const replaceStr = isToEnglish ? orig : trans;
            if (searchStr && replaceStr) {
                const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escaped, 'gi'); const matches = result.match(regex);
                if (matches) { matchCount += matches.length; result = result.replace(regex, replaceStr); }
            }
        }
    });
    return { swapped: result, matchCount };
}

export function normalizeText(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z가-힣0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '').trim();
}

export function setTextareaValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, value); else el.value = value;
    $(el).val(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}
