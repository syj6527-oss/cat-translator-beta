// ============================================================
// 🐱 Cat Translator v18.4.5 - utils.js
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
    setTimeout(() => { notifyHtml.removeClass('show'); setTimeout(() => notifyHtml.remove(), 500); }, 2500);
}

export function catNotifyProgress(message, onAbort) {
    const el = catNotify(message, 'progress');
    if (onAbort) {
        el.css({ cursor: 'pointer', pointerEvents: 'auto' });
        el.on('click', () => { onAbort(); el.removeClass('show'); setTimeout(() => el.remove(), 500); });
    }
    return el;
}

// 🚨 코드박스 및 상태창 실종 버그 완전 해결!
export function cleanResult(text) {
    if (!text) return "";
    let cleaned = text.replace(/^(번역|Translation|Output|Input|Result):\s*/gi, "");
    
    // 🚨 이전 AI가 넣었던 ".replace(/```[\s\S]*?```/g, "")" (코드박스 삭제 코드)를 영구 제거했습니다.
    // 마크다운 형식과 줄바꿈을 그대로 유지하여 상태창 레이아웃을 보존합니다.
    return cleaned.trim();
}

export function getCacheModelKey(settings) {
    if (settings.profile) return `profile:${settings.profile}`;
    return settings.directModel || 'default';
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    return (lower.includes('pro') || lower.includes('tiger')) ? 'tiger' : 'cat';
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
