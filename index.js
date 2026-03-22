// ============================================================
// 🐱 Translator v1.0.3
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { catNotify, getThemeEmoji, getCompletionEmoji, setTextareaValue, getModelTheme, detectLanguageDirection, getCacheModelKey } from './utils.js';
import { initCache } from './cache.js';
import { fetchTranslation, gatherContextMessages } from './translator.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, injectMessageButtons, injectInputButtons, setupDragDictionary, setupMutationObserver, showHistoryPopup, applyTheme, setSuppressAutoSave, clearPendingAutoSave } from './ui.js';

const EXT_NAME = "cat-translator";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', vertexKey: '', vertexProject: '', vertexRegion: 'global', directModel: 'gemini-1.5-flash', customModelName: '', autoMode: 'none', bidirectional: 'off', dialogueBilingual: 'off', iconVisibility: 'all', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '', promptPresets: {}, charPresetMap: {} };
// 베타 → 정식 설정 마이그레이션 (기존 사용자 설정 보존)
if (!extension_settings[EXT_NAME] && extension_settings["cat-translator-beta"]) {
    extension_settings[EXT_NAME] = { ...extension_settings["cat-translator-beta"] };
}
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

// 🚨 전역 기준값 영구 보존: extension_settings에 별도 키로 저장
// 프리셋이 적용된 상태에서 새로고침해도 baseline이 오염되지 않음
const BASELINE_VERSION = 2;  // 🚨 baseline 구조 변경 시 올려서 강제 리셋
const _savedBaseline = extension_settings[EXT_NAME]?._baseline;
const _baselineValid = _savedBaseline && _savedBaseline._v === BASELINE_VERSION;
const _globalBaseline = _baselineValid
    ? { userPrompt: _savedBaseline.userPrompt ?? '', temperature: _savedBaseline.temperature ?? 0.3, style: _savedBaseline.style ?? 'normal', _v: BASELINE_VERSION }
    : { userPrompt: defaultSettings.userPrompt || '', temperature: defaultSettings.temperature ?? 0.3, style: defaultSettings.style || 'normal', _v: BASELINE_VERSION };
let _isPresetLoading = false;
if (!_baselineValid) {
    console.warn('[CAT] ⚠️ baseline 리셋: 구버전/미존재. "설정 저장 및 적용" 버튼으로 기본 설정을 확정해주세요!');
}
console.log('[CAT] 🏠 전역 baseline 초기화:', { style: _globalBaseline.style, temp: _globalBaseline.temperature, prompt: _globalBaseline.userPrompt.substring(0, 30) || '(없음)', source: _baselineValid ? '영구저장 복원' : 'defaultSettings (리셋)' });

// 🚨 프로필/모델 상태에 따른 올바른 테마 판별
function getCurrentTheme() {
    if (settings.profile) {
        const pn = ($('#ct-profile option:selected').text() || '').toLowerCase();
        if (pn.includes('pro') || pn.includes('프로') || pn.includes('호랑이') || pn.includes('tiger')) return 'tiger';
        if (pn.includes('flash') || pn.includes('플래') || pn.includes('플레') || pn.includes('고양이') || pn.includes('cat')) return 'cat';
        return 'cat';
    }
    return getModelTheme(settings.directModel);
}

function saveSettings(updateBaseline = false) {
    const collected = collectSettings(); Object.assign(settings, collected);
    // 🚨 baseline 갱신 조건: 수동 저장 + 프리셋 비활성 상태에서만
    if (updateBaseline) {
        const currentChar = (SillyTavern?.getContext?.()?.name2) || stContext.name2 || '';
        const hasCharPreset = !!(currentChar && settings.charPresetMap?.[currentChar]);
        const hasSelectedPreset = !!$('#ct-prompt-preset').val();
        if (hasCharPreset || hasSelectedPreset) {
            // 🚨 프리셋 활성 중 → baseline 보호, 프리셋만 저장
            console.log(`[CAT] 🔒 baseline 보호: 프리셋 활성 상태에서 저장 → baseline 유지`);
            catNotify(`${getThemeEmoji()} 캐릭터 설정 저장됨 (기본 설정은 변경되지 않음)`, "success");
        } else {
            // 🚨 프리셋 없음 → 진짜 전역 기본값 갱신
            _globalBaseline.userPrompt = settings.userPrompt || '';
            _globalBaseline.temperature = settings.temperature ?? 0.3;
            _globalBaseline.style = settings.style || 'normal';
            _globalBaseline._v = BASELINE_VERSION;
            console.log('[CAT] 🏠 baseline 갱신 (수동 저장):', { style: _globalBaseline.style, temp: _globalBaseline.temperature, prompt: _globalBaseline.userPrompt.substring(0, 30) || '(없음)' });
        }
    }
    // 🚨 baseline을 extension_settings에 영구 저장 (새로고침 후에도 복원)
    extension_settings[EXT_NAME] = { ...settings, _baseline: { ..._globalBaseline } };
    stContext.saveSettingsDebounced();
    applyTheme(getCurrentTheme()); updateCacheStats();
}

async function processMessage(id, isInput = false, abortSignal = null, silent = false, isAutoEvent = false) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    
    const mesBlock = $(`.mes[mesid="${msgId}"]`);

    // 🚨 스와이프 감지: 자동 번역 가드보다 먼저 실행해야 stale display_text를 삭제함
    if (msg.extra?.original_mes && msg.extra?.cat_swipe_id !== undefined &&
        msg.swipe_id !== undefined && msg.swipe_id !== msg.extra.cat_swipe_id) {
        // 스와이프 변경 → stale 데이터 전부 삭제
        delete msg.extra.original_mes;
        delete msg.extra.display_text;
        delete msg.extra.cat_swipe_id;
        mesBlock.removeAttr('data-cat-translated');
        stContext.updateMessageBlock(msgId, msg);
        console.log(`[CAT] 🔄 스와이프 감지 #${msgId}: 번역 캐시 초기화`);
    }

    if (isAutoEvent && mesBlock.attr('data-cat-translated') === 'true') return;
    if (isAutoEvent && msg.extra?.display_text) return;
    // 🚨 display_text 안전장치: 번역된 상태인데 display_text 누락 시 보정
    if (msg.extra?.original_mes && !msg.extra?.display_text) { msg.extra.display_text = msg.mes; }
    // 🚨 Legacy 감지: 구버전에서 msg.mes가 번역문으로 덮어쓰여진 경우 자동 복원
    if (msg.extra?.original_mes && msg.extra?.display_text && msg.mes === msg.extra.display_text && msg.mes !== msg.extra.original_mes) {
        msg.mes = msg.extra.original_mes;
        console.log(`[CAT] 🔧 Legacy 메시지 #${msgId} 자동 복원: msg.mes → 원문`);
    }

    const startGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    const stopGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');

    const isAutoMode = (settings.autoMode !== 'none');
    const isAutoTriggered = isAutoMode && !abortSignal;

    if (mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon.cat-glow-anim').length > 0) return;
    startGlow();
    let historyShown = false;

    try {
        const editArea = mesBlock.find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible').first();
        if (editArea.length > 0) { await handleEditAreaTranslation(editArea, msgId, abortSignal); return; }

        // 🚨 원본 결정: original_mes + display_text + 스와이프 일치 여부로 판정
        let textToTranslate;
        const hasTranslation = msg.extra?.original_mes && msg.extra?.display_text &&
            (msg.extra?.cat_swipe_id === undefined || msg.extra.cat_swipe_id === msg.swipe_id);
        
        if (hasTranslation) {
            textToTranslate = msg.extra.original_mes;
        } else {
            textToTranslate = msg.mes;
        }

        const existingTranslation = hasTranslation ? msg.extra.display_text : null;
        const isRetranslation = hasTranslation;

        if (!silent && !isRetranslation) {
            const prefix = isAutoTriggered ? '자동 번역' : '번역';
            catNotify(`${getThemeEmoji()} ${prefix} 진행 중...`, "success");
        }

        if (isRetranslation) {
            const anchorEl = mesBlock.find('.cat-mes-trans-btn');
            const detected = detectDir(textToTranslate);
            const modelKey = getCacheModelKey(settings);
            const shown = await showHistoryPopup(textToTranslate, detected.targetLang, anchorEl, async (selectedText, isNew) => {
                if (isNew) {
                    startGlow();
                    try {
                        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, true);
                    } finally { stopGlow(); }
                } else if (selectedText) {
                    if (!msg.extra) msg.extra = {}; msg.extra.display_text = selectedText;
                    if (isInput) { msg.mes = selectedText; }
                    stContext.updateMessageBlock(msgId, msg);
                }
            }, modelKey);
            if (shown) { historyShown = true; return; }
        }
        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, silent);
    } finally { if (!historyShown) stopGlow(); }
}

async function doTranslateMessage(msgId, msg, textToTranslate, isInput, prevTranslation, abortSignal, silent = false) {
    const source = msg.extra?.original_mes || textToTranslate;
    const detected = detectLanguageDirection(source, settings);
    const forceLang = detected.targetLang;
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);

    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: isInput ? (msg.extra?.original_mes ? msg.mes : null) : prevTranslation, contextMessages: contextMsgs, abortSignal, silent });

    if (result && result.text && result.text.trim() && result.text !== textToTranslate) {
        if (!msg.extra) msg.extra = {};
        if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
        msg.extra.display_text = result.text;
        if (msg.swipe_id !== undefined) msg.extra.cat_swipe_id = msg.swipe_id;
        // 🚨 입력 메시지: msg.mes = 번역문(영어) → AI 컨텍스트에 영어 전달
        // 🚨 출력 메시지: msg.mes = 원문 유지 → 컨텍스트 오염 방지
        if (isInput) { msg.mes = result.text; }
        
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
    
    // 🚨 DOM에서 긁혀온 오염물 제거 (hidden comment + 코드박스 잔해)
    currentText = currentText.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!currentText) return;
    
    const msg = stContext.chat[msgId];
    
    // 🚨 직전 아웃풋 딸려오기 차단: msg 기준으로 비정상 길이 감지
    if (msg) {
        const knownText = msg.extra?.display_text || msg.extra?.original_mes || msg.mes;
        if (knownText && currentText.length > knownText.length * 1.5) {
            const knownPrefix = knownText.substring(0, Math.min(50, knownText.length));
            if (currentText.startsWith(knownPrefix)) {
                currentText = knownText;
            }
        }
    }
    
    // 🚨 textarea 오염 방지: 이전 콘텐츠가 현재 메시지에 섞여 들어온 경우
    if (msg && msg.mes && currentText.includes(msg.mes) && currentText !== msg.mes) {
        currentText = msg.mes;
    }
    
    // 🚨 핵심: 재번역 vs 새 번역 판별
    let sourceText = currentText;
    let isReTranslation = false;
    
    if (msg?.extra?.original_mes) {
        if (currentText === msg.extra.display_text || 
            currentText === msg.extra.original_mes) {
            // 수정 안 함 → original_mes에서 재번역
            sourceText = msg.extra.original_mes;
            isReTranslation = true;
        } else {
            // 🚨 사용자가 새 텍스트 입력 → 옛날 original_mes 삭제 (강제 초기화!)
            delete msg.extra.original_mes;
            delete msg.extra.display_text;
            delete msg.extra.cat_swipe_id;
        }
    }
    
    const prevTrans = isReTranslation ? (msg.extra?.display_text || null) : null;
    catNotify(isReTranslation ? `${getThemeEmoji()} 다른 표현으로 재번역 중...` : `${getThemeEmoji()} 스마트 번역 중...`, "success");
    
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);
    const bilingualInputLangMap = { 'ko-en': 'English', 'ko-ja': 'Japanese', 'ko-zh': 'Chinese' };
    const inputTargetLang = (settings.dialogueBilingual && settings.dialogueBilingual !== 'off') ? (bilingualInputLangMap[settings.dialogueBilingual] || settings.targetLang) : settings.targetLang;
    const inputSettings = { ...settings, dialogueBilingual: 'off', targetLang: inputTargetLang };
    const result = await fetchTranslation(sourceText, inputSettings, stContext, { forceLang: null, prevTranslation: prevTrans, contextMessages: contextMsgs, abortSignal });
    
    if (result && result.text !== currentText) {
        // editArea jQuery 데이터 저장 (세션 내)
        editArea.data('cat-original-text', sourceText);
        editArea.data('cat-last-translated', result.text);
        editArea.data('cat-last-target-lang', result.lang);
        
        // 🚨 msg.extra 영구 저장 — 무조건 덮어쓰기! (if 가드 없음)
        if (!msg.extra) msg.extra = {};
        msg.extra.original_mes = sourceText;
        msg.extra.display_text = result.text;
        if (msg.swipe_id !== undefined) msg.extra.cat_swipe_id = msg.swipe_id;
        
        setTextareaValue(editArea[0], result.text);
        catNotify(isReTranslation ? `${getCompletionEmoji()} 재번역 덮어쓰기 완료!` : `${getCompletionEmoji()} 번역 덮어쓰기 완료!`, "success");
    }
}

function revertMessage(id) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    const editArea = $(`.mes[mesid="${msgId}"]`).find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
    if (editArea.length > 0) { const originalText = editArea.data('cat-original-text'); if (originalText) { setTextareaValue(editArea[0], originalText); editArea.removeData('cat-original-text').removeData('cat-last-translated').removeData('cat-last-target-lang'); catNotify(`${getThemeEmoji()} 원본 텍스트로 복구 완료!`, "success"); } else { catNotify("⚠️ 복구할 원본이 없습니다.", "warning"); } return; }
    if (msg.extra?.display_text) delete msg.extra.display_text;
    if (msg.extra?.original_mes) {
        // 🚨 입력 메시지는 msg.mes가 번역문이므로 원문 복원 필요
        // 출력 메시지는 msg.mes가 이미 원문이므로 덮어써도 동일
        msg.mes = msg.extra.original_mes;
        delete msg.extra.original_mes;
    }
    if (msg.extra?.cat_swipe_id !== undefined) delete msg.extra.cat_swipe_id;
    
    $(`.mes[mesid="${msgId}"]`).removeAttr('data-cat-translated');
    
    stContext.updateMessageBlock(msgId, msg); catNotify(`${getThemeEmoji()} 원문 복구 완료!`, "success");
}
function detectDir(text) { return detectLanguageDirection(text, settings); }

jQuery(async () => {
    try { await initCache(); console.log('[CAT] 🐱 IndexedDB 캐시 초기화 완료'); } catch (e) { console.warn('[CAT] IndexedDB 초기화 실패, 메모리 캐시로 대체:', e); }
    setupSettingsPanel(settings, stContext, saveSettings); setupDragDictionary(settings, saveSettings); setupMutationObserver(processMessage, revertMessage, settings, stContext);
    // 🚨 첫 마이그레이션 / baseline 리셋 안내
    if (!_baselineValid) {
        setTimeout(() => catNotify(`${getThemeEmoji()} 기본 설정을 확인 후 "설정 저장 및 적용" 버튼을 눌러주세요!`, "warning"), 2000);
    }
    stContext.eventSource.on(stContext.event_types.CHARACTER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'input') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, false, null, false, true), 500); });
    stContext.eventSource.on(stContext.event_types.USER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'output') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, true, null, false, true), 500); });
    const bodyObserver = new MutationObserver(() => { applyTheme(getCurrentTheme()); }); bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // 🚨 캐릭터 전환 시 번역 프롬프트 자동 로드
    stContext.eventSource.on(stContext.event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            // 🚨 전환 시점의 최신 캐릭터 이름 사용
            const charName = (SillyTavern?.getContext?.()?.name2) || stContext.name2 || '';
            if (!charName || charName === 'SillyTavern System') return;
            console.log(`[CAT] 📋 캐릭터 전환: "${charName}", 매핑: ${settings.charPresetMap?.[charName] || '없음'}`);
            
            // 🚨 프리셋 로드 전: 대기 중인 autoSave 취소 + 억제 ON
            clearPendingAutoSave();
            setSuppressAutoSave(true);
            _isPresetLoading = true;
            
            const presetName = settings.charPresetMap?.[charName];
            if (presetName && settings.promptPresets?.[presetName]) {
                const preset = settings.promptPresets[presetName];
                settings.userPrompt = preset.prompt || '';
                settings.temperature = preset.temperature ?? 0.3;
                settings.style = preset.style || 'normal';
                $('#ct-user-prompt').val(settings.userPrompt);
                $('#ct-style').val(settings.style);
                $('#ct-temperature').val(settings.temperature);
                $('#ct-prompt-preset').val(presetName);
                // 🚨 직접 저장 (autoSave 디바운스 충돌 방지) + baseline 영구 보존
                extension_settings[EXT_NAME] = { ...settings, _baseline: { ..._globalBaseline } };
                stContext.saveSettingsDebounced();
                catNotify(`${getThemeEmoji()} ${charName} → 프롬프트 "${presetName}" 자동 로드!`, "success");
                console.log(`[CAT] 🔗 프리셋 적용: "${presetName}" →`, { style: settings.style, temp: settings.temperature, prompt: settings.userPrompt.substring(0, 30) });
            } else {
                // 🚨 FIX: 매핑 없는 캐릭터 → 전역 baseline으로 복원 (하드코딩 기본값 X)
                settings.userPrompt = _globalBaseline.userPrompt;
                settings.temperature = _globalBaseline.temperature;
                settings.style = _globalBaseline.style;
                $('#ct-user-prompt').val(settings.userPrompt);
                $('#ct-style').val(settings.style);
                $('#ct-temperature').val(settings.temperature);
                $('#ct-prompt-preset').val('');
                // 🚨 직접 저장 + baseline 영구 보존
                extension_settings[EXT_NAME] = { ...settings, _baseline: { ..._globalBaseline } };
                stContext.saveSettingsDebounced();
                console.log(`[CAT] 🏠 baseline 복원 (프리셋 없음):`, { style: _globalBaseline.style, temp: _globalBaseline.temperature, prompt: _globalBaseline.userPrompt.substring(0, 30) || '(없음)' });
            }
            
            // 🚨 프리셋 로드 완료: 억제 OFF
            _isPresetLoading = false;
            setSuppressAutoSave(false);
        }, 500);
    });
    console.log('[CAT] 🐱 Translator v1.0.3 로드 완료!');
});

