// ============================================================
// 🐱 Cat Translator v18.3.7 - index.js (로직 완전 복구본)
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { catNotify, getThemeEmoji, getCompletionEmoji, setTextareaValue, getModelTheme, detectLanguageDirection, getCacheModelKey } from './utils.js';
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

// 🚨 핵심 번역 실행 로직 (절대 누락 금지)
async function processMessage(id, isInput = false, abortSignal = null, silent = false, isAutoEvent = false) {
    const msgId = id === null ? stContext.chat.length - 1 : parseInt(id, 10); 
    const msg = stContext.chat[msgId]; if (!msg) return;
    
    const mesBlock = $(`.mes[mesid="${msgId}"]`);
    // 중복 번역 방지 마커 확인
    if (isAutoEvent && (mesBlock.attr('data-cat-translated') === 'true' || msg.extra?.display_text)) return;

    const startGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    const stopGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');

    if (mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon.cat-glow-anim').length > 0) return;
    startGlow();

    try {
        const editArea = mesBlock.find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
        if (editArea.length > 0) { await handleEditAreaTranslation(editArea, msgId, abortSignal); return; }

        let textToTranslate = msg.extra?.original_mes || msg.mes;
        const existingTranslation = msg.extra?.display_text || null;
        const isRetranslation = !!existingTranslation;

        if (!silent && !isRetranslation) {
            catNotify(`${getThemeEmoji()} 번역 진행 중...`, "success");
        }

        if (isRetranslation) {
            const anchorEl = mesBlock.find('.cat-mes-trans-btn');
            const detected = detectDir(textToTranslate);
            const modelKey = getCacheModelKey(settings);
            const shown = await showHistoryPopup(textToTranslate, detected.targetLang, anchorEl, (selectedText, isNew) => {
                if (isNew) doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, true);
                else if (selectedText) { if (!msg.extra) msg.extra = {}; msg.extra.display_text = selectedText; msg.mes = selectedText; stContext.updateMessageBlock(msgId, msg); }
            }, modelKey);
            if (shown) return; 
        }
        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, silent);
    } finally { stopGlow(); }
}

async function doTranslateMessage(msgId, msg, textToTranslate, isInput, prevTranslation, abortSignal, silent = false) {
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);
    const result = await fetchTranslation(textToTranslate, settings, stContext, { prevTranslation, contextMessages: contextMsgs, abortSignal, silent });

    if (result && result.text && result.text !== textToTranslate) {
        if (!msg.extra) msg.extra = {};
        if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
        msg.extra.display_text = result.text;
        msg.mes = result.text;
        
        // 중복 번역 방지 마커 부착
        $(`.mes[mesid="${msgId}"]`).attr('data-cat-translated', 'true'); 
        stContext.updateMessageBlock(msgId, msg);
        if (!silent) catNotify(`${getCompletionEmoji()} 번역 완료!`, "success");
    }
}

async function handleEditAreaTranslation(editArea, msgId, abortSignal) {
    let currentText = editArea.val().trim(); if (!currentText) return;
    const result = await fetchTranslation(currentText, settings, stContext, { abortSignal });
    if (result && result.text !== currentText) {
        editArea.data('cat-original-text', currentText);
        setTextareaValue(editArea[0], result.text);
        catNotify(`${getCompletionEmoji()} 덮어쓰기 완료!`, "success");
    }
}

function revertMessage(id) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.display_text; delete msg.extra.original_mes; }
    $(`.mes[mesid="${msgId}"]`).removeAttr('data-cat-translated');
    stContext.updateMessageBlock(msgId, msg); catNotify(`${getThemeEmoji()} 복구 완료!`, "success");
}

function detectDir(text) { return detectLanguageDirection(text, settings); }

// 🚨 초기 로드 시 모든 모듈 연결
jQuery(async () => {
    try { 
        await initCache(); 
        applyTheme(getModelTheme(settings.directModel));
        setupSettingsPanel(settings, stContext, saveSettings); 
        setupDragDictionary(settings, saveSettings); 
        setupMutationObserver(processMessage, revertMessage, settings, stContext);
        
        // 자동 번역 이벤트 등록
        stContext.eventSource.on(stContext.event_types.CHARACTER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'input') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, false, null, false, true), 500); });
        stContext.eventSource.on(stContext.event_types.USER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'output') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, true, null, false, true), 500); });
        
        console.log('[CAT] 🐯 Cat Translator v18.3.7 통합 소생 완료!');
    } catch (e) { console.error('[CAT] 로드 실패:', e); }
});
