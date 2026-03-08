// ============================================================
// 🐱 Cat Translator v18.4.0 - ui.js (디자인 & 벌크 통합본)
// ============================================================
import { catNotify, catNotifyProgress, getThemeEmoji, getCompletionEmoji, getModelTheme, setTextareaValue } from './utils.js';
import { getStats, clearAllCache, exportSettings, importSettings, getHistory, togglePin } from './cache.js';
import { fetchTranslation, gatherContextMessages, SYSTEM_SHIELD, STYLE_PRESETS } from './translator.js';

let bulkAbortController = null;
let isTranslatingInput = false;

export function setupSettingsPanel(settings, stContext, saveSettingsFn) {
    if ($('#cat-trans-container').length) return;

    let profileOptions = '<option value="">⚡ 직접 연결 모드</option>';
    (stContext.extensionSettings?.connectionManager?.profiles || []).forEach(p => { profileOptions += `<option value="${p.id}">${p.name}</option>`; });

    const languages = ['Korean', 'English', 'Chinese', 'Japanese', 'German', 'Russian', 'French'];
    const langOptions = languages.map(l => `<option value="${l}">${l}</option>`).join('');
    const styleOptions = Object.entries(STYLE_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const statsData = getStats();
    const dictIcon = (settings.dictionary && settings.dictionary.trim()) ? '📬' : '📭';

    const html = `
    <div id="cat-trans-container" class="inline-drawer">
        <div id="cat-drawer-header" class="inline-drawer-header interactable" tabindex="0">
            <div class="inline-drawer-title"><span class="cat-theme-emoji">🐱</span><span>트랜스레이터 Beta v18.4.0</span></div>
            <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
        </div>
        <div id="cat-drawer-content" class="inline-drawer-content" style="display:none; padding:10px;">
            <div class="cat-setting-row"><label>연결 프로필</label><select id="ct-profile" class="text_pole">${profileOptions}</select></div>
            <div id="ct-direct-settings" style="display:${settings.profile === '' ? 'block' : 'none'};">
                <div class="cat-setting-row" style="position:relative;"><label>API Key</label><input type="password" id="ct-key" class="text_pole" value="${settings.customKey || ''}" style="padding-right:36px;"><span id="ct-key-toggle" class="cat-paw-toggle">🐾</span></div>
                <div class="cat-setting-row"><label>모델</label><select id="ct-model" class="text_pole">
                    <optgroup label="🐱 고양이 라인 (Flash)"><option value="gemini-1.5-flash">1.5 Flash</option><option value="gemini-2.0-flash">2.0 Flash</option></optgroup>
                    <optgroup label="🐯 호랑이 라인 (Pro)"><option value="gemini-1.5-pro">1.5 Pro</option><option value="gemini-2.0-pro-exp-02-05">2.0 Pro Exp</option></optgroup>
                    <option value="custom">✏️ 직접 입력...</option>
                </select></div>
            </div>
            <div class="cat-setting-row"><label>자동 모드</label><select id="ct-auto-mode" class="text_pole"><option value="none">꺼짐</option><option value="input">입력만</option><option value="output">출력만</option><option value="both">둘 다</option></select></div>
            <div class="cat-setting-row"><label>목표 언어</label><select id="ct-lang" class="text_pole">${langOptions}</select></div>
            <div style="display:flex; gap:8px;">
                <div class="cat-setting-row" style="flex:1;"><label>스타일</label><select id="ct-style" class="text_pole">${styleOptions}</select></div>
                <div class="cat-setting-row" style="width:80px;"><label>온도</label><input type="number" id="ct-temperature" class="text_pole" value="${settings.temperature || 0.3}" min="0" max="1" step="0.1"></div>
            </div>
            <div style="display:flex; gap:8px;">
                <div class="cat-setting-row" style="flex:1;"><label>토큰</label><input type="number" id="ct-max-tokens" class="text_pole" value="${settings.maxTokens || 8192}" placeholder="MAX 8192"></div>
                <div class="cat-setting-row" style="width:100px;"><label>문맥 범위</label><input type="number" id="ct-context-range" class="text_pole" value="${settings.contextRange || 1}" min="0" max="4" placeholder="MAX 4"></div>
            </div>
            <div class="cat-setting-row"><label>시스템 보호막 (🔒 고정)</label><textarea class="text_pole cat-readonly-area" rows="3" readonly>${SYSTEM_SHIELD}</textarea></div>
            <div class="cat-setting-row"><label>추가 지시사항</label><textarea id="ct-user-prompt" class="text_pole" rows="3">${settings.userPrompt || ''}</textarea></div>
            <div class="cat-setting-row"><label>사전 <span id="ct-dict-reset" style="float:right; cursor:pointer;">${dictIcon}</span></label><textarea id="ct-dictionary" class="text_pole" rows="3">${settings.dictionary || ''}</textarea></div>
            <div id="ct-cache-stats" class="cat-stats-bar">🗂️ 캐시 히트율: ${statsData.hitRate}% | 절약 토큰: ~${statsData.tokensSaved.toLocaleString()}</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button id="ct-clear-cache" class="menu_button cat-btn-secondary" style="flex:1;">🗑️ 캐시 삭제</button>
                <button id="ct-reset-settings" class="menu_button cat-btn-secondary" style="flex:1;">🔄 설정 초기화</button>
            </div>
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button id="ct-export" class="menu_button cat-btn-secondary" style="flex:1;">📤 내보내기</button><button id="ct-import-btn" class="menu_button cat-btn-secondary" style="flex:1;">📥 가져오기</button>
                <input type="file" id="ct-import-file" style="display:none;">
            </div>
        </div>
    </div>`;

    $('#extensions_settings').append(html);

    const triggerAutoSave = (silent = false) => {
        saveSettingsFn();
        if (!silent) catNotify(`${getCompletionEmoji()} 설정이 자동 저장되었습니다.`, "success");
    };

    $('#cat-drawer-header').on('click', () => { $('#cat-drawer-content').slideToggle(200); $('#cat-drawer-toggle').toggleClass('fa-chevron-down fa-chevron-up'); });
    $('#ct-key-toggle').on('click', () => { const i = $('#ct-key'); i.attr('type', i.attr('type') === 'password' ? 'text' : 'password'); });
    
    $('#ct-profile, #ct-model').on('change', function() {
        const pn = $(this).find('option:selected').text().toLowerCase();
        applyTheme((pn.includes('pro') || pn.includes('tiger')) ? 'tiger' : 'cat', true);
        triggerAutoSave(true);
    });

    $('#ct-auto-mode, #ct-lang, #ct-style, #ct-temperature').on('change', () => triggerAutoSave(false));
    $('#ct-max-tokens, #ct-context-range, #ct-user-prompt, #ct-dictionary, #ct-key').on('blur', () => triggerAutoSave(false));

    $('#ct-clear-cache').on('click', async () => { if (confirm("정말 번역 캐시를 전부 삭제할까요?")) { await clearAllCache(); updateCacheStats(); catNotify("🗑️ 캐시 삭제 완료!", "success"); } });
    $('#ct-reset-settings').on('click', () => { if (confirm("설정을 초기화할까요?\n(사전과 API 키는 유지됩니다)")) { saveSettingsFn(); location.reload(); } });
    $('#ct-export').on('click', () => exportSettings(settings));
    $('#ct-import-btn').on('click', () => $('#ct-import-file').click());
}

export function applyTheme(theme, notify = false) {
    document.body.setAttribute('data-cat-theme', theme);
    const emoji = theme === 'tiger' ? '🐯' : '🐱';
    $('.cat-theme-emoji, .cat-mes-trans-btn .cat-emoji-icon, #cat-input-btn .cat-emoji-icon').text(emoji);
    if (notify) catNotify(theme === 'tiger' ? '🐯 어흥! 호랑이 모드 활성화!' : '🐱 야옹~ 고양이 모드 활성화!', 'success');
}

export function injectInputButtons(settings, stContext, processMessageFn) {
    if ($('#cat-input-btn-group').length) return;
    const target = $('#send_but'); if (!target.length) return;
    
    const group = $('<div id="cat-input-btn-group" class="cat-input-btn-group"></div>');
    const transBtn = $(`<div id="cat-input-btn" class="cat-input-icon interactable"><span class="cat-emoji-icon">${getThemeEmoji()}</span></div>`);
    const revertBtn = $(`<div id="cat-input-revert" class="cat-input-icon interactable"><i class="fa-solid fa-rotate-left"></i></div>`);
    const bulkBtn = $(`<div id="cat-bulk-btn" class="cat-input-icon interactable"><span>⚡</span></div>`);
    
    group.append(transBtn, revertBtn, bulkBtn);
    target.before(group);

    transBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); processMessageFn(null, true); });
    revertBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); const sa = $('#send_textarea'); const ot = sa.data('cat-original-text'); if(ot) setTextareaValue(sa[0], ot); });
    bulkBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); showBulkPopup(e, settings, stContext, processMessageFn); });
}

function showBulkPopup(event, settings, stContext, processMessageFn) {
    $('.cat-bulk-popup').remove();
    const popup = $(`<div class="cat-bulk-popup">
        <div class="cat-bulk-option" data-count="all">📋 전체 번역</div>
        <div class="cat-bulk-option" data-count="20">🦁 최근 20개</div>
        <div class="cat-bulk-option" data-count="15">🐯 최근 15개</div>
        <div class="cat-bulk-option" data-count="10">🐱 최근 10개</div>
        <div class="cat-bulk-option" data-count="5">🐭 최근 5개</div>
        <div class="cat-bulk-option" data-count="custom">✏️ 직접 입력...</div>
    </div>`);
    const rect = event.currentTarget.getBoundingClientRect();
    popup.css({ position: 'fixed', bottom: (window.innerHeight - rect.top + 8) + 'px', left: Math.max(4, rect.left - 40) + 'px', zIndex: 2147483647 });
    $('body').append(popup);
    
    popup.find('.cat-bulk-option').on('click', async function() {
        const c = $(this).data('count'); popup.remove();
        let final = c; if (c === 'custom') { const i = prompt("몇 개 번역할까요?", "5"); if (!i) return; final = parseInt(i); }
        
        const allMes = $('.mes'); let targets = [];
        if (final === 'all') allMes.each(function() { targets.push($(this)); });
        else allMes.slice(Math.max(0, allMes.length - parseInt(final))).each(function() { targets.push($(this)); });
        
        for (const el of targets) {
            if (el.attr('data-cat-translated') === 'true') continue;
            await processMessageFn(el.attr('mesid'), false, null, true);
            await new Promise(r => setTimeout(r, 600));
        }
    });
    $(document).one('click', () => popup.remove());
}

export function setupMutationObserver(p, r, settings, stContext) {
    const chat = document.getElementById('chat'); if (!chat) return;
    const observer = new MutationObserver(() => { injectMessageButtons(p, r); injectInputButtons(settings, stContext, p); });
    observer.observe(chat, { childList: true, subtree: true });
    injectMessageButtons(p, r); injectInputButtons(settings, stContext, p);
}

export function injectMessageButtons(p, r) {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const id = $(this).attr('mesid'); if (!id) return;
        const group = $(`<div class="cat-btn-group"><span class="cat-mes-trans-btn" data-mesid="${id}"><span class="cat-emoji-icon">${getThemeEmoji()}</span></span><span class="cat-mes-revert-btn" data-mesid="${id}"><i class="fa-solid fa-rotate-left"></i></span></div>`);
        $(this).find('.name_text').append(group);
    });
    if (!window._catBtnBound) {
        window._catBtnBound = true;
        $(document).on('click', '.cat-mes-trans-btn', function(e) { e.stopPropagation(); p($(this).data('mesid'), false); });
        $(document).on('click', '.cat-mes-revert-btn', function(e) { e.stopPropagation(); r($(this).data('mesid')); });
    }
}

