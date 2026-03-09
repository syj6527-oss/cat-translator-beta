// ============================================================
// 🐱 Translator v1.0.1
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { catNotify, getThemeEmoji, getCompletionEmoji, setTextareaValue, getModelTheme, detectLanguageDirection, getCacheModelKey } from './utils.js';
import { initCache } from './cache.js';
import { fetchTranslation, gatherContextMessages } from './translator.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, injectMessageButtons, injectInputButtons, setupDragDictionary, setupMutationObserver, showHistoryPopup, applyTheme } from './ui.js';

const EXT_NAME = "cat-translator";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', vertexKey: '', vertexProject: '', vertexRegion: 'global', directModel: 'gemini-1.5-flash', customModelName: '', autoMode: 'none', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '' };
// 베타 → 정식 설정 마이그레이션 (기존 사용자 설정 보존)
if (!extension_settings[EXT_NAME] && extension_settings["cat-translator-beta"]) {
    extension_settings[EXT_NAME] = { ...extension_settings["cat-translator-beta"] };
}
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

function saveSettings() {
    const collected = collectSettings(); Object.assign(settings, collected);
    extension_settings[EXT_NAME] = { ...settings }; stContext.saveSettingsDebounced();
    applyTheme(getModelTheme(settings.directModel)); updateCacheStats();
}

async function processMessage(id, isInput = false, abortSignal = null, silent = false, isAutoEvent = false) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    
    const mesBlock = $(`.mes[mesid="${msgId}"]`);

    if (isAutoEvent && mesBlock.attr('data-cat-translated') === 'true') return;
    if (isAutoEvent && msg.extra?.display_text) return;

    const startGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    const stopGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');

    const isAutoMode = (settings.autoMode !== 'none');
    const isAutoTriggered = isAutoMode && !abortSignal;

    if (mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon.cat-glow-anim').length > 0) return;
    startGlow();

    try {
        const editArea = mesBlock.find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
        if (editArea.length > 0) { await handleEditAreaTranslation(editArea, msgId, abortSignal); return; }

        // 🚨 swipe_id + 텍스트 이중 감지: ST 타이밍 문제 완벽 대응
        let activeText = msg.mes;
        if (msg.swipes !== undefined && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) {
            activeText = msg.swipes[msg.swipe_id];
        }

        let textToTranslate;
        let isStale = false;

        if (msg.extra?.original_mes && msg.extra?.display_text) {
            // swipe_id 비교 (1순위: 스와이프 넘김 감지)
            if (msg.swipe_id !== undefined && msg.extra.cat_swipe_id !== undefined && msg.swipe_id !== msg.extra.cat_swipe_id) {
                isStale = true;
            // 텍스트 비교 (2순위: 수정/기타 변경 감지)
            } else if (activeText !== msg.extra.display_text && activeText !== msg.extra.original_mes) {
                isStale = true;
            }
        }

        if (isStale) {
            delete msg.extra.original_mes;
            delete msg.extra.display_text;
            delete msg.extra.cat_swipe_id;
            mesBlock.removeAttr('data-cat-translated');
        }

        const isShowingTranslation = !isStale && msg.extra?.display_text && activeText === msg.extra.display_text;

        if (isShowingTranslation) {
            textToTranslate = msg.extra.original_mes;
        } else {
            textToTranslate = activeText;
        }

        const existingTranslation = isShowingTranslation ? msg.extra.display_text : null;
        const isRetranslation = isShowingTranslation;

        if (!silent && !isRetranslation) {
            const prefix = isAutoTriggered ? '자동 번역' : '번역';
            catNotify(`${getThemeEmoji()} ${prefix} 진행 중...`, "success");
        }

        if (isRetranslation) {
            const anchorEl = mesBlock.find('.cat-mes-trans-btn');
            const detected = detectDir(textToTranslate);
            const modelKey = getCacheModelKey(settings);
            const shown = await showHistoryPopup(textToTranslate, detected.targetLang, anchorEl, (selectedText, isNew) => {
                if (isNew) {
                    doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, true);
                } else if (selectedText) {
                    if (!msg.extra) msg.extra = {}; msg.extra.display_text = selectedText; msg.mes = selectedText; stContext.updateMessageBlock(msgId, msg);
                }
            }, modelKey);
            if (shown) return; 
        }
        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, silent);
    } finally { stopGlow(); }
}

async function doTranslateMessage(msgId, msg, textToTranslate, isInput, prevTranslation, abortSignal, silent = false) {
    const forceLang = null;
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);

    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: isInput ? (msg.extra?.original_mes ? msg.mes : null) : prevTranslation, contextMessages: contextMsgs, abortSignal, silent });

    if (result && result.text && result.text.trim() && result.text !== textToTranslate) {
        if (!msg.extra) msg.extra = {};
        if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
        msg.extra.display_text = result.text;
        if (msg.swipe_id !== undefined) msg.extra.cat_swipe_id = msg.swipe_id;
        msg.mes = result.text;
        
        $(`.mes[mesid="${msgId}"]`).attr('data-cat-translated', 'true');

        stContext.updateMessageBlock(msgId, msg);
        if (!silent) {
            const preview = result.text.substring(0, 25) + (result.text.length > 25 ? '...' : '');
            catNotify(`${getCompletionEmoji()} 번역 완료! '${preview}'`, "success");
        }
    } else if (!silent && result === null) {
        catNotify(`${getThemeEmoji()} 번역 실패. 연필 아이콘으로 수정 모드에서 시도해보세요.`, "warning");
    }
}

async function handleEditAreaTranslation(editArea, msgId, abortSignal) {
    let currentText = editArea.val().trim(); if (!currentText) return;
    const lastTranslated = editArea.data('cat-last-translated'); const originalText = editArea.data('cat-original-text'); const lastTargetLang = editArea.data('cat-last-target-lang');
    
    // 🚨 stale 감지: 현재 텍스트가 이전 번역/원본 둘 다 아니면 새 세션 → 초기화
    if (originalText && lastTranslated && currentText !== lastTranslated && currentText !== originalText) {
        editArea.removeData('cat-original-text').removeData('cat-last-translated').removeData('cat-last-target-lang');
        // 강제 데이터 덮어쓰기로 좀비 데이터 완벽 사살
        editArea.data('cat-original-text', '');
        editArea.data('cat-last-translated', '');
        editArea.data('cat-last-target-lang', '');
    }
    
    const freshOriginal = editArea.data('cat-original-text');
    const freshLastTranslated = editArea.data('cat-last-translated');
    const freshLastTargetLang = editArea.data('cat-last-target-lang');
    const isRetry = (freshLastTranslated && freshOriginal && currentText === freshLastTranslated);
    const textToTranslate = isRetry ? freshOriginal : currentText; const forceLang = isRetry ? freshLastTargetLang : null; const prevTrans = isRetry ? currentText : null;
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
    if (msg.extra?.cat_swipe_id !== undefined) delete msg.extra.cat_swipe_id;
    
    $(`.mes[mesid="${msgId}"]`).removeAttr('data-cat-translated');
    
    stContext.updateMessageBlock(msgId, msg); catNotify(`${getThemeEmoji()} 원문 복구 완료!`, "success");
}
function detectDir(text) { return detectLanguageDirection(text, settings); }

jQuery(async () => {
    try { await initCache(); console.log('[CAT] 🐱 IndexedDB 캐시 초기화 완료'); } catch (e) { console.warn('[CAT] IndexedDB 초기화 실패, 메모리 캐시로 대체:', e); }
    setupSettingsPanel(settings, stContext, saveSettings); setupDragDictionary(settings, saveSettings); setupMutationObserver(processMessage, revertMessage, settings, stContext);
    stContext.eventSource.on(stContext.event_types.CHARACTER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'input') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, false, null, false, true), 500); });
    stContext.eventSource.on(stContext.event_types.USER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'output') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, true, null, false, true), 500); });
    const bodyObserver = new MutationObserver(() => { applyTheme(getModelTheme(settings.directModel)); }); bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    console.log('[CAT] 🐱 Translator v1.0.1 로드 완료!');
});

