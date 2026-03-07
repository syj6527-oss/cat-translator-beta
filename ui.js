// ============================================================
// 🐱 Cat Translator v18.1.0 - ui.js
// UI: 설정 패널, 버튼 주입, 드래그 사전, 벌크 번역, 히스토리
// ============================================================

import {
    catNotify, catNotifyProgress, getThemeEmoji, getModelTheme, setTextareaValue
} from './utils.js';
import {
    getStats, clearAllCache, exportSettings, importSettings, getHistory, togglePin
} from './cache.js';
import { fetchTranslation, gatherContextMessages, SYSTEM_SHIELD, STYLE_PRESETS } from './translator.js';

let bulkAbortController = null;
let isTranslatingInput = false;

// ─── 설정 패널 생성 ─────────────────────────────────
export function setupSettingsPanel(settings, stContext, saveSettingsFn) {
    if ($('#cat-trans-container').length) return;

    let profileOptions = '<option value="">⚡ 직접 연결 모드</option>';
    (stContext.extensionSettings?.connectionManager?.profiles || []).forEach(p => {
        profileOptions += `<option value="${p.id}">${p.name}</option>`;
    });

    const languages = ['Korean', 'English', 'Chinese', 'Japanese', 'German', 'Russian', 'French'];
    const langOptions = languages.map(l => `<option value="${l}">${l}</option>`).join('');

    const styleOptions = Object.entries(STYLE_PRESETS)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    const statsData = getStats();

    const html = `
    <div id="cat-trans-container" class="inline-drawer">
        <div id="cat-drawer-header" class="inline-drawer-header interactable" tabindex="0">
            <div class="inline-drawer-title">
                <span class="cat-theme-emoji">🐱</span>
                <span>트랜스레이터 Beta v18.1.0</span>
            </div>
            <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
        </div>
        <div id="cat-drawer-content" class="inline-drawer-content" style="display:none; padding:10px;">

            <div class="cat-setting-row">
                <label>연결 프로필</label>
                <select id="ct-profile" class="text_pole">${profileOptions}</select>
            </div>

            <div id="ct-direct-settings" style="display:${settings.profile === '' ? 'block' : 'none'};">
                <div class="cat-setting-row" style="position:relative;">
                    <label>API Key</label>
                    <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}" style="padding-right:36px;">
                    <span id="ct-key-toggle" class="cat-paw-toggle" title="키 보기/숨기기">🐾</span>
                </div>
                <div class="cat-setting-row">
                    <label>모델</label>
                    <select id="ct-model" class="text_pole">
                        <optgroup label="🐱 고양이 라인 (Flash)">
                            <option value="gemini-1.5-flash">1.5 Flash</option>
                            <option value="gemini-2.0-flash">2.0 Flash</option>
                        </optgroup>
                        <optgroup label="🐯 호랑이 라인 (Pro)">
                            <option value="gemini-1.5-pro">1.5 Pro</option>
                            <option value="gemini-2.0-pro-exp-02-05">2.0 Pro Exp</option>
                        </optgroup>
                        <option value="custom">✏️ 직접 입력...</option>
                    </select>
                    <input type="text" id="ct-model-custom" class="text_pole" placeholder="모델명 직접 입력" style="display:none; margin-top:4px;">
                </div>
            </div>

            <div class="cat-setting-row">
                <label>자동 모드 (입출력 자동 언어 감지 적용됨)</label>
                <select id="ct-auto-mode" class="text_pole">
                    <option value="none">꺼짐</option>
                    <option value="input">입력만</option>
                    <option value="output">출력만</option>
                    <option value="both">둘 다</option>
                </select>
            </div>
            <div class="cat-setting-row">
                <label>목표 언어 (AI 기본)</label>
                <select id="ct-lang" class="text_pole">${langOptions}</select>
            </div>

            <div style="display:flex; gap:8px;">
                <div class="cat-setting-row" style="flex:1;">
                    <label>스타일</label>
                    <select id="ct-style" class="text_pole">${styleOptions}</select>
                </div>
                <div class="cat-setting-row" style="width:80px;">
                    <label>온도</label>
                    <input type="number" id="ct-temperature" class="text_pole" value="${settings.temperature || 0.3}" min="0" max="1" step="0.1">
                </div>
            </div>

            <div style="display:flex; gap:8px;">
                <div class="cat-setting-row" style="flex:1;">
                    <label>Max Tokens</label>
                    <input type="number" id="ct-max-tokens" class="text_pole" value="${settings.maxTokens || 8192}" min="256" max="65536" step="256">
                </div>
                <div class="cat-setting-row" style="width:80px;">
                    <label>문맥 범위</label>
                    <input type="number" id="ct-context-range" class="text_pole" value="${settings.contextRange || 1}" min="0" max="3" step="1">
                </div>
            </div>

            <div class="cat-setting-row">
                <label>시스템 보호막 (🔒 고정)</label>
                <textarea id="ct-shield" class="text_pole cat-readonly-area" rows="3" readonly>${SYSTEM_SHIELD}</textarea>
            </div>
            <div class="cat-setting-row">
                <label>추가 지시사항 (사용자 정의)</label>
                <textarea id="ct-user-prompt" class="text_pole" rows="3" placeholder="번역 스타일, 상황극 설정 등 자유롭게 입력">${settings.userPrompt || ''}</textarea>
            </div>

            <div class="cat-setting-row">
                <label>사전 (원문 = 번역어) 
                    <button id="ct-dict-reset" class="menu_button" style="float:right; cursor:pointer; font-size:0.9em; background:rgba(231,76,60,0.15)!important; border:1px solid #e74c3c!important; color:#e74c3c!important; padding:4px 10px; border-radius:6px; font-weight:bold;">🗑️ 사전 초기화</button>
                </label>
                <textarea id="ct-dictionary" class="text_pole" rows="3" placeholder="Ghost=고스트&#10;Soap=소프">${settings.dictionary || ''}</textarea>
            </div>

            <div id="ct-cache-stats" class="cat-stats-bar">
                캐시 히트율: ${statsData.hitRate}% | 절약 토큰: ~${statsData.tokensSaved.toLocaleString()}
            </div>
            <button id="ct-clear-cache" class="menu_button cat-btn-secondary" style="margin-top:4px; width:100%;">🗑️ 캐시 전체 삭제</button>

            <div style="display:flex; gap:8px; margin-top:8px;">
                <button id="ct-export" class="menu_button cat-btn-secondary" style="flex:1;">📤 내보내기</button>
                <button id="ct-import-btn" class="menu_button cat-btn-secondary" style="flex:1;">📥 가져오기</button>
                <input type="file" id="ct-import-file" accept=".json" style="display:none;">
            </div>

            <button id="cat-save-btn" class="menu_button cat-save-button" style="margin-top:10px; width:100%;">
                설정 저장 및 적용 <span class="cat-theme-emoji">🐱</span>
            </button>
        </div>
    </div>`;

    $('#extensions_settings').append(html);

    $('#cat-drawer-header').on('click', (e) => {
        e.stopPropagation();
        $('#cat-drawer-content').slideToggle(200);
        $('#cat-drawer-toggle').toggleClass('fa-chevron-down fa-chevron-up');
    });

    $('#ct-key-toggle').on('click', () => {
        const input = $('#ct-key');
        const isPassword = input.attr('type') === 'password';
        input.attr('type', isPassword ? 'text' : 'password');
    });

    $('#ct-model').val(settings.directModel).on('change', function () {
        const val = $(this).val();
        $('#ct-model-custom').toggle(val === 'custom');
        if (val !== 'custom') {
            applyTheme(getModelTheme(val));
        }
    });
    $('#ct-model-custom').val(settings.customModelName || '').on('input', function () {
        applyTheme(getModelTheme($(this).val()));
    });

    $('#ct-profile').val(settings.profile).on('change', function () {
        settings.profile = $(this).val();
        $('#ct-direct-settings').toggle(settings.profile === '');
        const profileName = $(this).find('option:selected').text().toLowerCase();
        if (profileName.includes('pro') || profileName.includes('프로')) {
            applyTheme('tiger');
        } else if (profileName.includes('flash') || profileName.includes('플래') || profileName.includes('플레')) {
            applyTheme('cat');
        } else if (settings.profile === '') {
            applyTheme(getModelTheme(settings.directModel));
        }
    });

    $('#ct-style').val(settings.style || 'normal').on('change', function () {
        const preset = STYLE_PRESETS[$(this).val()];
        if (preset) {
            $('#ct-temperature').val(preset.temperature);
        }
    });

    $('#ct-auto-mode').val(settings.autoMode);
    $('#ct-lang').val(settings.targetLang);
    $('#ct-temperature').val(settings.temperature || 0.3);

    $('#ct-dictionary').on('input', function () {
        settings.dictionary = $(this).val();
    });
    $('#ct-dict-reset').on('click', async () => {
        $('#ct-dictionary').val('');
        settings.dictionary = '';
        saveSettingsFn();
        await clearAllCache();
        updateCacheStats();
        catNotify(`${getThemeEmoji()} 사전 초기화 + 캐시 클리어 완료!`, "success");
    });
    $('#ct-user-prompt').on('input', function () {
        settings.userPrompt = $(this).val();
    });
    $('#ct-context-range').on('change', function () {
        let val = parseInt($(this).val()) || 0;
        val = Math.min(3, Math.max(0, val));
        $(this).val(val);
    });

    $('#cat-save-btn').on('click', () => {
        saveSettingsFn();
        catNotify(`${getThemeEmoji()} 저장 완료! 테마가 동기화되었습니다.`, "success");
    });

    $('#ct-clear-cache').on('click', async () => {
        await clearAllCache();
        updateCacheStats();
        catNotify(`${getThemeEmoji()} 캐시 전체 삭제 완료!`, "success");
    });

    $('#ct-export').on('click', () => {
        saveSettingsFn();
        exportSettings(settings);
        catNotify(`${getThemeEmoji()} 설정 내보내기 완료!`, "success");
    });

    $('#ct-import-btn').on('click', () => $('#ct-import-file').click());
    $('#ct-import-file').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        try {
            const imported = await importSettings(file);
            Object.assign(settings, imported);
            saveSettingsFn();
            catNotify(`${getThemeEmoji()} 설정 가져오기 완료! 새로고침하면 적용됩니다.`, "success");
        } catch (e) {
            catNotify(`${getThemeEmoji()} 오류: ${e.message}`, "error");
        }
        this.value = '';
    });

    applyTheme(getModelTheme(settings.directModel));
}

export function collectSettings() {
    const modelVal = $('#ct-model').val();
    return {
        profile: $('#ct-profile').val() || '',
        customKey: $('#ct-key').val() || '',
        directModel: modelVal === 'custom' ? ($('#ct-model-custom').val() || 'gemini-2.0-flash') : (modelVal || 'gemini-1.5-flash'),
        customModelName: $('#ct-model-custom').val() || '',
        autoMode: $('#ct-auto-mode').val() || 'none',
        targetLang: $('#ct-lang').val() || 'Korean',
        style: $('#ct-style').val() || 'normal',
        temperature: parseFloat($('#ct-temperature').val()) || 0.3,
        maxTokens: parseInt($('#ct-max-tokens').val()) || 8192,
        contextRange: Math.min(3, Math.max(0, parseInt($('#ct-context-range').val()) || 1)),
        userPrompt: $('#ct-user-prompt').val() || '',
        dictionary: $('#ct-dictionary').val() || ''
    };
}

export function updateCacheStats() {
    const s = getStats();
    $('#ct-cache-stats').text(`캐시 히트율: ${s.hitRate}% | 절약 토큰: ~${s.tokensSaved.toLocaleString()}`);
}

let _lastAppliedTheme = null;
export function applyTheme(theme) {
    document.body.setAttribute('data-cat-theme', theme);
    const emoji = theme === 'tiger' ? '🐯' : '🐱';
    $('.cat-theme-emoji').text(emoji);
    $('.cat-mes-trans-btn .cat-emoji-icon').text(emoji);
    $('#cat-input-btn .cat-emoji-icon').text(emoji);
    if (_lastAppliedTheme !== null && _lastAppliedTheme !== theme) {
        if (theme === 'tiger') {
            catNotify('🐯 어흥! 호랑이 모드 활성화!', 'success');
        } else {
            catNotify('🐱 야옹~ 고양이 모드 활성화!', 'success');
        }
    }
    _lastAppliedTheme = theme;
}

export function injectInputButtons(settings, stContext, processMessageFn) {
    if ($('#cat-input-wrap').length > 0) {
        const icon = $('#cat-input-btn .cat-emoji-icon');
        if (isTranslatingInput) icon.addClass('cat-glow-anim');
        else icon.removeClass('cat-glow-anim');
        return;
    }

    const target = $('#send_but');
    if (target.length === 0) return;

    const emoji = getThemeEmoji();
    const btnWrap = $(`<div id="cat-input-wrap"></div>`);
    const transBtn = $(`<div id="cat-input-btn" title="번역" class="cat-input-icon interactable"><span class="cat-emoji-icon">${emoji}</span></div>`);
    const revertBtn = $(`<div id="cat-input-revert" title="되돌리기" class="cat-input-icon interactable"><i class="fa-solid fa-rotate-left"></i></div>`);
    const bulkBtn = $(`<div id="cat-bulk-btn" title="전체 번역" class="cat-input-icon interactable"><span class="cat-emoji-icon">⚡</span></div>`);

    btnWrap.append(transBtn).append(revertBtn).append(bulkBtn);
    target.before(btnWrap);

    transBtn.on('click', async (e) => {
        e.preventDefault();
        const sendArea = $('#send_textarea');
        const currentText = sendArea.val().trim();
        if (isTranslatingInput || !currentText) return;

        isTranslatingInput = true;
        transBtn.find('.cat-emoji-icon').addClass('cat-glow-anim');

        try {
            const lastTranslated = sendArea.data('cat-last-translated');
            const originalText = sendArea.data('cat-original-text');
            const lastTargetLang = sendArea.data('cat-last-target-lang');

            const isRetry = (lastTranslated && currentText === lastTranslated);
            const textToTranslate = isRetry ? originalText : currentText;
            const forceLang = null; // 🚨 마스터 요청: 하드코딩 해제 (입력창도 언어 자동 감지)
            const prevTrans = isRetry ? currentText : null;

            catNotify(isRetry ? `${getThemeEmoji()} 입력창 재번역 중...` : `${getThemeEmoji()} 스마트 번역 중...`, "success");

            const contextRange = parseInt(settings.contextRange) || 1;
            const lastMsgId = stContext.chat.length - 1;
            const contextMsgs = gatherContextMessages(lastMsgId + 1, stContext, contextRange);

            const result = await fetchTranslation(textToTranslate, settings, stContext, {
                forceLang,
                prevTranslation: prevTrans,
                contextMessages: contextMsgs
            });

            if (result && result.text !== currentText) {
                sendArea.data('cat-original-text', textToTranslate);
                sendArea.data('cat-last-translated', result.text);
                sendArea.data('cat-last-target-lang', result.lang);
                setTextareaValue(sendArea[0], result.text);
            }
        } finally {
            isTranslatingInput = false;
            transBtn.find('.cat-emoji-icon').removeClass('cat-glow-anim');
        }
    });

    revertBtn.on('click', (e) => {
        e.preventDefault();
        const sendArea = $('#send_textarea');
        const originalText = sendArea.data('cat-original-text');
        if (originalText) {
            setTextareaValue(sendArea[0], originalText);
            sendArea.removeData('cat-original-text').removeData('cat-last-translated');
            catNotify(`${getThemeEmoji()} 원문 복구 완료!`, "success");
        }
    });

    bulkBtn.on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showBulkPopup(e, settings, stContext, processMessageFn);
    });
}

// 🚨 마스터 요청: 시스템 메시지(상태창, 노트 등)에도 번역 버튼 주입!
export function injectMessageButtons(processMessageFn, revertMessageFn) {
    $('.mes:not(:has(.cat-btn-group))').each(function () {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        const emoji = getThemeEmoji();

        const group = $(`
            <div class="cat-btn-group">
                <span class="cat-mes-trans-btn interactable" title="번역" data-mesid="${msgId}"><span class="cat-emoji-icon">${emoji}</span></span>
                <span class="cat-mes-revert-btn interactable" title="복구" data-mesid="${msgId}"><i class="fa-solid fa-rotate-left"></i></span>
            </div>`);

        let target = $(this).find('.name_text');
        if (target.length > 0) {
            target.append(group);
        } else {
            // 이름이 없는 시스템 메시지(검은 박스 등)를 위한 비상 위치 지정
            let sysWrap = $('<div style="text-align:right; margin-bottom:4px;"></div>');
            sysWrap.append(group);
            $(this).find('.mes_text').first().prepend(sysWrap);
        }
    });

    if (!window._catMesBtnDelegated) {
        window._catMesBtnDelegated = true;
        $(document).on('click', '.cat-mes-trans-btn', function (e) {
            e.stopPropagation();
            const msgId = $(this).data('mesid') || $(this).closest('.mes').attr('mesid');
            const isUser = $(this).closest('.mes').hasClass('mes_user');
            if (msgId !== undefined) processMessageFn(msgId, isUser);
        });
        $(document).on('click', '.cat-mes-revert-btn', function (e) {
            e.stopPropagation();
            const msgId = $(this).data('mesid') || $(this).closest('.mes').attr('mesid');
            if (msgId !== undefined) revertMessageFn(msgId);
        });
    }
}

function showBulkPopup(event, settings, stContext, processMessageFn) {
    $('.cat-bulk-popup').remove();
    const popup = $(`
        <div class="cat-bulk-popup">
            <div class="cat-bulk-option" data-count="all">전체</div>
            <div class="cat-bulk-option" data-count="10">최근 10</div>
            <div class="cat-bulk-option" data-count="30">최근 30</div>
            <div class="cat-bulk-option" data-count="50">최근 50</div>
        </div>
    `);
    const btn = $('#cat-bulk-btn');
    const rect = btn[0].getBoundingClientRect();
    popup.css({
        position: 'fixed',
        bottom: (window.innerHeight - rect.top + 8) + 'px',
        right: (window.innerWidth - rect.right) + 'px',
        zIndex: 99999
    });
    $('body').append(popup);

    popup.find('.cat-bulk-option').on('click', async function () {
        const count = $(this).data('count');
        popup.remove();
        await executeBulkTranslation(count, settings, stContext, processMessageFn);
    });

    setTimeout(() => { $(document).one('click', () => popup.remove()); }, 50);
}

async function executeBulkTranslation(count, settings, stContext, processMessageFn) {
    const allMes = $('.mes');
    let targets = [];

    if (count === 'all') {
        allMes.each(function () { targets.push($(this)); });
    } else {
        const num = parseInt(count);
        const start = Math.max(0, allMes.length - num);
        allMes.slice(start).each(function () { targets.push($(this)); });
    }

    targets = targets.filter(el => {
        const msgId = parseInt(el.attr('mesid'), 10);
        const msg = stContext.chat[msgId];
        return msg && !msg.extra?.display_text;
    });

    if (targets.length === 0) {
        catNotify(`${getThemeEmoji()} 번역할 메시지가 없습니다.`, "warning");
        return;
    }

    bulkAbortController = new AbortController();
    const total = targets.length;
    let completed = 0;

    $('#cat-bulk-btn').html('<span class="cat-emoji-icon" style="filter:grayscale(1);">⚡</span>');
    const abortHandler = () => { if (bulkAbortController) bulkAbortController.abort(); };
    $('#cat-bulk-btn').off('click').on('click', (e) => { e.preventDefault(); abortHandler(); });

    const progressEl = catNotifyProgress(`${getThemeEmoji()} 벌크 번역 중... (0/${total}) [클릭시 중단]`, abortHandler);

    for (const el of targets) {
        if (bulkAbortController.signal.aborted) break;

        const msgId = el.attr('mesid');
        const isUser = el.hasClass('mes_user');
        await processMessageFn(msgId, isUser, bulkAbortController.signal, true);

        completed++;
        if (progressEl.length) progressEl.text(`${getThemeEmoji()} 벌크 번역 중... (${completed}/${total}) [클릭시 중단]`);

        if (!bulkAbortController.signal.aborted) await new Promise(r => setTimeout(r, 700));
    }

    progressEl.remove();
    const emoji = getThemeEmoji();
    $('#cat-bulk-btn').html('<span class="cat-emoji-icon">⚡</span>');
    $('#cat-bulk-btn').off('click').on('click', (e) => {
        e.preventDefault(); e.stopPropagation(); showBulkPopup(e, settings, stContext, processMessageFn);
    });

    if (bulkAbortController.signal.aborted) catNotify(`🔴 번역 중단됨 (${completed}개 완료)`, "error");
    else catNotify(`${emoji} 벌크 번역 완료! (${completed}개)`, "success");
    
    bulkAbortController = null;
}

export async function showHistoryPopup(originalText, targetLang, anchorEl, onSelect) {
    $('.cat-history-popup').remove();
    const history = await getHistory(originalText, targetLang);

    if (history.length < 3) return false;

    const sorted = [...history].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.time - a.time;
    }).slice(0, 5);

    let items = sorted.map((h, i) => {
        const pinClass = h.pinned ? 'cat-pinned' : '';
        const pinIcon = h.pinned ? '📌' : '📍';
        const truncated = h.text.length > 50 ? h.text.substring(0, 50) + '...' : h.text;
        return `<div class="cat-history-item ${pinClass}" data-idx="${i}">
            <span class="cat-history-text" data-text="${encodeURIComponent(h.text)}">${truncated}</span>
            <span class="cat-history-pin" data-text="${encodeURIComponent(h.text)}">${pinIcon}</span>
        </div>`;
    }).join('');

    items += `<div class="cat-history-item cat-history-new">🔄 새로 번역</div>`;

    const popup = $(`<div class="cat-history-popup">${items}</div>`);
    const rect = anchorEl[0].getBoundingClientRect();
    popup.css({ position: 'fixed', top: (rect.bottom + 4) + 'px', left: rect.left + 'px', zIndex: 99999 });
    $('body').append(popup);

    popup.find('.cat-history-text').on('click', function () {
        const text = decodeURIComponent($(this).data('text'));
        onSelect(text, false);
        popup.remove();
    });

    popup.find('.cat-history-pin').on('click', async function (e) {
        e.stopPropagation();
        const text = decodeURIComponent($(this).data('text'));
        await togglePin(originalText, targetLang, text);
        popup.remove();
        showHistoryPopup(originalText, targetLang, anchorEl, onSelect);
    });

    let newTransBusy = false;
    popup.find('.cat-history-new').on('click', () => {
        if (newTransBusy) return;
        newTransBusy = true;
        onSelect(null, true);
        popup.remove();
    });

    setTimeout(() => { $(document).one('click', () => popup.remove()); }, 50);
    return true;
}

export function setupDragDictionary(settings, saveSettingsFn) {
    let pawIcon = null;
    let _dragDebounce = null;
    const handleSelection = () => {
        clearTimeout(_dragDebounce);
        _dragDebounce = setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection?.toString()?.trim();
            $('.cat-drag-paw').remove();

            if (!selectedText || selectedText.length === 0 || selectedText.length > 100) return;
            const anchorNode = selection.anchorNode;
            if (!anchorNode || !$(anchorNode).closest('#chat').length) return;

            let range;
            try { range = selection.getRangeAt(0); } catch (e) { return; }
            const rect = range.getBoundingClientRect();
            if (rect.width === 0) return;

            pawIcon = $(`<div class="cat-drag-paw" title="사전 등록">🐾</div>`);
            const isMobile = window.innerWidth < 768;
            const topOffset = isMobile ? rect.bottom + 12 : rect.bottom + 4;
            pawIcon.css({
                position: 'fixed',
                top: Math.min(topOffset, window.innerHeight - 50) + 'px',
                left: Math.max(8, rect.left + rect.width / 2 - 14) + 'px',
                zIndex: 99999
            });
            $('body').append(pawIcon);

            pawIcon.on('click', (ev) => {
                ev.stopPropagation();
                showDragDictPopup(selectedText, rect, settings, saveSettingsFn);
                pawIcon.remove();
            });

            setTimeout(() => pawIcon?.remove(), 8000);
        }, 200);
    };

    document.addEventListener('selectionchange', handleSelection);
    $(document).on('mouseup touchend', '#chat', handleSelection);
    $(document).on('mousedown', (e) => {
        if (!$(e.target).closest('.cat-drag-paw, .cat-drag-popup').length) {
            $('.cat-drag-paw, .cat-drag-popup').remove();
        }
    });
}

function showDragDictPopup(selectedText, rect, settings, saveSettingsFn) {
    $('.cat-drag-popup').remove();
    const popup = $(`
        <div class="cat-drag-popup">
            <div class="cat-drag-header">"${selectedText.length > 20 ? selectedText.substring(0, 20) + '...' : selectedText}" →</div>
            <input type="text" class="cat-drag-input text_pole" placeholder="번역어 입력">
            <div class="cat-drag-actions">
                <button class="cat-drag-register menu_button">등록</button>
                <button class="cat-drag-cancel menu_button">취소</button>
            </div>
        </div>
    `);

    const isMobile = window.innerWidth < 768;
    if (isMobile) {
        popup.css({ position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999, width: 'calc(100vw - 32px)', maxWidth: '320px' });
    } else {
        popup.css({ position: 'fixed', top: (rect.bottom + 8) + 'px', left: Math.max(8, rect.left - 20) + 'px', zIndex: 99999 });
    }

    $('body').append(popup);
    popup.find('.cat-drag-input').focus();

    const doRegister = () => {
        const transWord = popup.find('.cat-drag-input').val().trim();
        if (!transWord) return;
        const newEntry = `${selectedText}=${transWord}`;
        const current = settings.dictionary || '';
        settings.dictionary = current ? `${current}\n${newEntry}` : newEntry;
        $('#ct-dictionary').val(settings.dictionary);
        saveSettingsFn();
        catNotify(`🐾 사전 등록 완료! ${selectedText} → ${transWord}`, "success");
        popup.remove();
    };

    popup.find('.cat-drag-register').on('click', doRegister);
    popup.find('.cat-drag-input').on('keydown', (e) => {
        if (e.key === 'Enter') doRegister();
        if (e.key === 'Escape') popup.remove();
    });
    popup.find('.cat-drag-cancel').on('click', () => popup.remove());
}

export function setupMutationObserver(processMessageFn, revertMessageFn, settings, stContext) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        setTimeout(() => setupMutationObserver(processMessageFn, revertMessageFn, settings, stContext), 500);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        let needsButtonInjection = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                needsButtonInjection = true;
                break;
            }
        }
        if (needsButtonInjection) {
            injectMessageButtons(processMessageFn, revertMessageFn);
            injectInputButtons(settings, stContext, processMessageFn);
        }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });

    injectMessageButtons(processMessageFn, revertMessageFn);
    injectInputButtons(settings, stContext, processMessageFn);
    setInterval(() => injectInputButtons(settings, stContext, processMessageFn), 2000);
}
