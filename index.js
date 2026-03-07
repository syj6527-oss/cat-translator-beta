// ============================================================
// 🐱 Cat Translator v18.2.0 "호랑이 각성" (UI/UX 튜닝판)
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { catNotify, getThemeEmoji, getCompletionEmoji, setTextareaValue, getModelTheme, detectLanguageDirection } from './utils.js';
import { initCache } from './cache.js';
import { fetchTranslation, gatherContextMessages } from './translator.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, injectMessageButtons, injectInputButtons, setupDragDictionary, setupMutationObserver, showHistoryPopup, applyTheme } from './ui.js';

const EXT_NAME = "cat-translator-beta";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', directModel: 'gemini-1.5-flash', customModelName: '', autoMode: 'none', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '' };
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

function saveSettings() {
    const collected = collectSettings(); Object.assign(settings, collected);
    extension_settings[EXT_NAME] = { ...settings }; stContext.saveSettingsDebounced();
    applyTheme(getModelTheme(settings.directModel)); updateCacheStats();
}

async function processMessage(id, isInput = false, abortSignal = null, silent = false) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    const startGlow = () => $(`.mes[mesid="${msgId}"]`).find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    const stopGlow = () => $(`.mes[mesid="${msgId}"]`).find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');

    // 자동번역 여부 판별
    const isAutoMode = (settings.autoMode !== 'none');
    const isAutoTriggered = isAutoMode && !abortSignal; // 벌크는 abortSignal 있음

    if ($(`.mes[mesid="${msgId}"]`).find('.cat-mes-trans-btn .cat-emoji-icon.cat-glow-anim').length > 0) return;
    startGlow();

    try {
        const mesBlock = $(`.mes[mesid="${msgId}"]`);
        const editArea = mesBlock.find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
        if (editArea.length > 0) { await handleEditAreaTranslation(editArea, msgId, abortSignal); return; }

        let textToTranslate = isInput ? (msg.extra?.original_mes || msg.mes) : msg.mes;
        const existingTranslation = !isInput ? msg.extra?.display_text : null;
        const isRetranslation = !!existingTranslation;

        // 번역 진행 토스트
        if (!silent && !isRetranslation) {
            const prefix = isAutoTriggered ? '자동 번역' : '번역';
            catNotify(`${getThemeEmoji()} ${prefix} 진행 중...`, "success");
        }

        if (isRetranslation) {
            const anchorEl = mesBlock.find('.cat-mes-trans-btn');
            const detected = detectDir(textToTranslate);
            const shown = await showHistoryPopup(textToTranslate, detected.targetLang, anchorEl, (selectedText, isNew) => {
                if (isNew) {
                    doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, true);
                } else if (selectedText) {
                    if (!msg.extra) msg.extra = {}; msg.extra.display_text = selectedText; stContext.updateMessageBlock(msgId, msg);
                }
            });
            if (shown) return; 
        }
        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, silent);
    } finally { stopGlow(); }
}

async function doTranslateMessage(msgId, msg, textToTranslate, isInput, prevTranslation, abortSignal, silent = false) {
    const forceLang = null; // 스마트 언어 감지로 위임
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);

    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: isInput ? (msg.extra?.original_mes ? msg.mes : null) : prevTranslation, contextMessages: contextMsgs, abortSignal, silent });

    if (result && result.text && result.text.trim() && result.text !== textToTranslate) {
        if (!msg.extra) msg.extra = {};
        if (isInput) { if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate; msg.mes = result.text; } else { msg.extra.display_text = result.text; }
        stContext.updateMessageBlock(msgId, msg);
        if (!silent) {
            const preview = result.text.substring(0, 25) + (result.text.length > 25 ? '...' : '');
            catNotify(`${getCompletionEmoji()} 번역 완료! '${preview}'`, "success");
        }
    }
}

async function handleEditAreaTranslation(editArea, msgId, abortSignal) {
    let currentText = editArea.val().trim(); if (!currentText) return;
    const lastTranslated = editArea.data('cat-last-translated'); const originalText = editArea.data('cat-original-text'); const lastTargetLang = editArea.data('cat-last-target-lang');
    const isRetry = (lastTranslated && currentText === lastTranslated);
    const textToTranslate = isRetry ? originalText : currentText; const forceLang = isRetry ? lastTargetLang : null; const prevTrans = isRetry ? currentText : null;
    catNotify(isRetry ? `${getThemeEmoji()} 다른 표현으로 재번역 중...` : `${getThemeEmoji()} 스마트 번역 중...`, "success");
    const contextRange = parseInt(settings.contextRange) || 1; const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);
    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: prevTrans, contextMessages: contextMsgs, abortSignal });
    if (result && result.text !== currentText) { editArea.data('cat-original-text', textToTranslate); editArea.data('cat-last-translated', result.text); editArea.data('cat-last-target-lang', result.lang); setTextareaValue(editArea[0], result.text); catNotify(isRetry ? `${getCompletionEmoji()} 재번역 덮어쓰기 완료!` : `${getCompletionEmoji()} 번역 덮어쓰기 완료!`, "success"); }
}

function revertMessage(id) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    const editArea = $(`.mes[mesid="${msgId}"]`).find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
    if (editArea.length > 0) { const originalText = editArea.data('cat-original-text'); if (originalText) { setTextareaValue(editArea[0], originalText); editArea.removeData('cat-original-text').removeData('cat-last-translated').removeData('cat-last-target-lang'); catNotify(`${getThemeEmoji()} 원본 텍스트로 복구 완료!`, "success"); } else { catNotify("⚠️ 복구할 원본이 없습니다.", "warning"); } return; }
    if (msg.extra?.display_text) delete msg.extra.display_text;
    if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; }
    stContext.updateMessageBlock(msgId, msg); catNotify(`${getThemeEmoji()} 원문 복구 완료!`, "success");
}
function detectDir(text) { return detectLanguageDirection(text, settings); }

jQuery(async () => {
    try { await initCache(); console.log('[CAT] 🐱 IndexedDB 캐시 초기화 완료'); } catch (e) { console.warn('[CAT] IndexedDB 초기화 실패, 메모리 캐시로 대체:', e); }
    setupSettingsPanel(settings, stContext, saveSettings); setupDragDictionary(settings, saveSettings); setupMutationObserver(processMessage, revertMessage, settings, stContext);
    stContext.eventSource.on(stContext.event_types.CHARACTER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'input') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, false), 500); });
    stContext.eventSource.on(stContext.event_types.USER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'output') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, true), 500); });
    const bodyObserver = new MutationObserver(() => { applyTheme(getModelTheme(settings.directModel)); }); bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    console.log('[CAT] 🐯 Cat Translator Beta V2 로드 완료!');
});
