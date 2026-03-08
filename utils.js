// ============================================================
// 🐱 Cat Translator v18.4.0 - utils.js
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
    $('.cat-notification').remove();
    const colors = { success: '#2ecc71', warning: '#f39c12', error: '#e74c3c', progress: '#f39c12' };
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${colors[type] || colors.success};">${message}</div>`);
    $('body').append(notifyHtml);
    requestAnimationFrame(() => notifyHtml.addClass('show'));
    if (type !== 'progress') {
        setTimeout(() => { notifyHtml.removeClass('show'); setTimeout(() => notifyHtml.remove(), 500); }, 2500);
    }
    return notifyHtml;
}

export function cleanResult(text) {
    if (!text) return "";
    // 코드블록 구조 보존을 위해 최소한의 라벨만 제거
    return text.replace(/^(번역|Translation|Output|Input|Result):\s*/gi, "").trim();
}

export function getCacheModelKey(settings) {
    if (settings.profile) return `profile:${settings.profile}`;
    return settings.directModel || 'default';
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    return (lower.includes('pro') || lower.includes('프로') || lower.includes('tiger') || lower.includes('호랑이')) ? 'tiger' : 'cat';
}

export function detectLanguageDirection(text, settings) {
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (korCount >= engCount) return { isToEnglish: true, targetLang: 'English' };
    return { isToEnglish: false, targetLang: settings.targetLang || 'Korean' };
}

export function setTextareaValue(el, value) {
    const ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (ns) ns.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
