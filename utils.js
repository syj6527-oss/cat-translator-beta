// ============================================================
// 🐱 Cat Translator v18.3.1 - utils.js
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

// 🚨 토스트 속도 제어: 부드러운 전환 및 유지 시간(3.5초) 증가!
export function catNotify(message, type = 'success') {
    const existing = $('.cat-notification');
    if (existing.length > 0) {
        existing.removeClass('show');
        setTimeout(() => existing.remove(), 300); 
    }

    const emoji = getThemeEmoji();
    const colors = {
        success: '#2ecc71',
        warning: '#f39c12',
        error: '#e74c3c',
        progress: '#f39c12'
    };
    const bgColor = colors[type] || colors.success;
    const displayMsg = message.replace(/^(🐱|🐯)\s*/, `${emoji} `);
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${displayMsg}</div>`);
    
    $('body').append(notifyHtml);
    
    setTimeout(() => {
        requestAnimationFrame(() => notifyHtml.addClass('show'));
    }, 50);

    if (type !== 'progress') {
        setTimeout(() => {
            notifyHtml.removeClass('show');
            setTimeout(() => notifyHtml.remove(), 400);
        }, 3500);
    }
    return notifyHtml;
}

export function catNotifyProgress(message, onAbort) {
    const el = catNotify(message, 'progress');
    if (onAbort) {
        el.css({ cursor: 'pointer', pointerEvents: 'auto' });
        el.on('click', () => {
            onAbort();
            el.removeClass('show');
            setTimeout(() => el.remove(), 500);
        });
    }
    return el;
}

export function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/^(번역|Translation|Output|Input|Result):\s*/gi, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[^\S\r\n]{2,}/g, " ") 
        .trim();
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    if (lower.includes('pro') || lower.includes('프로')) return 'tiger';
    if (lower.includes('flash') || lower.includes('플래') || lower.includes('플레')) return 'cat';
    return 'cat';
}

export function detectLanguageDirection(text, settings) {
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    const jpCount = (text.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
    const cnCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
    const total = korCount + engCount + jpCount + cnCount;

    if (total === 0) return { isToEnglish: false, targetLang: settings.targetLang };

    const korRatio = korCount / total;
    const engRatio = engCount / total;

    if (korRatio >= 0.7) {
        return { isToEnglish: true, targetLang: 'English' };
    }
    if (engRatio >= 0.7) {
        return { isToEnglish: false, targetLang: 'Korean' };
    }

    return { isToEnglish: false, targetLang: settings.targetLang };
}

export function applyPreReplace(text, dictionary, isToEnglish) {
    return applyPreReplaceWithCount(text, dictionary, isToEnglish).swapped;
}

export function applyPreReplaceWithCount(text, dictionary, isToEnglish) {
    if (!dictionary || dictionary.trim() === "") return { swapped: text, matchCount: 0 };
    const lines = dictionary.split('\n').filter(l => l.includes('='));
    if (lines.length === 0) return { swapped: text, matchCount: 0 };

    let result = text;
    let matchCount = 0;
    lines.sort((a, b) => b.split('=')[0].length - a.split('=')[0].length);

    lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const orig = parts[0].trim();
            const trans = parts.slice(1).join('=').trim();
            const searchStr = isToEnglish ? trans : orig;
            const replaceStr = isToEnglish ? orig : trans;
            if (searchStr && replaceStr) {
                const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escaped, 'gi');
                const matches = result.match(regex);
                if (matches) {
                    matchCount += matches.length;
                    result = result.replace(regex, replaceStr);
                }
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
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    $(el).val(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
