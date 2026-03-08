// ============================================================
// 🐱 Cat Translator v18.4.0 - ui.js
// ============================================================
import { catNotify, getThemeEmoji, getCompletionEmoji, getModelTheme, setTextareaValue } from './utils.js';
import { getStats, clearAllCache, exportSettings, importSettings } from './cache.js';
import { fetchTranslation, SYSTEM_SHIELD } from './translator.js';

export function setupSettingsPanel(settings, stContext, saveSettingsFn) {
    if ($('#cat-trans-container').length) return;
    const statsData = getStats();
    const dictIcon = (settings.dictionary && settings.dictionary.trim()) ? '📬' : '📭';

    const html = `
    <div id="cat-trans-container" class="inline-drawer">
        <div id="cat-drawer-header" class="inline-drawer-header interactable">
            <div class="inline-drawer-title"><span class="cat-theme-emoji">🐱</span><span>트랜스레이터 Beta v18.4.0</span></div>
            <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
        </div>
        <div id="cat-drawer-content" class="inline-drawer-content" style="display:none; padding:10px;">
            <div class="cat-setting-row"><label>연결 프로필</label><select id="ct-profile" class="text_pole"></select></div>
            <div id="ct-direct-settings" style="display:none;">
                <div class="cat-setting-row" style="position:relative;"><label>API Key</label><input type="password" id="ct-key" class="text_pole" value="${settings.customKey || ''}"><span id="ct-key-toggle" class="cat-paw-toggle">🐾</span></div>
                <div class="cat-setting-row"><label>모델</label><select id="ct-model" class="text_pole">
                    <optgroup label="🐱 고양이 (Flash)"><option value="gemini-1.5-flash">1.5 Flash</option><option value="gemini-2.0-flash">2.0 Flash</option></optgroup>
                    <optgroup label="🐯 호랑이 (Pro)"><option value="gemini-1.5-pro">1.5 Pro</option><option value="gemini-2.0-pro-exp-02-05">2.0 Pro Exp</option></optgroup>
                </select></div>
            </div>
            <div class="cat-setting-row"><label>자동 모드</label><select id="ct-auto-mode" class="text_pole"><option value="none">꺼짐</option><option value="input">입력만</option><option value="output">출력만</option><option value="both">둘 다</option></select></div>
            <div style="display:flex; gap:8px;">
                <div class="cat-setting-row" style="flex:1;"><label>토큰</label><input type="number" id="ct-max-tokens" class="text_pole" value="${settings.maxTokens || 8192}" placeholder="MAX 8192"></div>
                <div class="cat-setting-row" style="width:100px;"><label>문맥 범위</label><input type="number" id="ct-context-range" class="text_pole" value="${settings.contextRange || 1}" min="0" max="4" placeholder="MAX 4"></div>
            </div>
            <div class="cat-setting-row"><label>사전 (원문 = 번역어) <span id="ct-dict-reset" style="float:right; cursor:pointer;">${dictIcon}</span></label><textarea id="ct-dictionary" class="text_pole" rows="3">${settings.dictionary || ''}</textarea></div>
            <div id="ct-cache-stats" class="cat-stats-bar">🗂️ 캐시 히트율: ${statsData.hitRate}%</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button id="ct-clear-cache" class="menu_button cat-btn-secondary" style="flex:1;">🗑️ 캐시 삭제</button>
                <button id="ct-reset-settings" class="menu_button cat-btn-secondary" style="flex:1;">🔄 설정 초기화</button>
            </div>
        </div>
    </div>`;

    $('#extensions_settings').append(html);

    const triggerAutoSave = (silent = false) => {
        saveSettingsFn();
        if (!silent) catNotify(`${getCompletionEmoji()} 설정이 자동 저장되었습니다.`, "success");
    };

    $('#cat-drawer-header').on('click', () => { $('#cat-drawer-content').slideToggle(200); });
    
    $('#ct-clear-cache').on('click', async () => { 
        if (confirm("정말 번역 캐시를 전부 삭제할까요?")) { 
            await clearAllCache(); triggerAutoSave(true); catNotify("🗑️ 캐시 삭제 완료!", "success"); 
        } 
    });

    $('#ct-reset-settings').on('click', () => { 
        if (confirm("설정을 초기화하시겠습니까? (사전/API 키 유지)")) { 
            saveSettingsFn(true); catNotify("🔄 설정 초기화 완료!", "success");
            setTimeout(() => location.reload(), 500);
        } 
    });
}

export function injectInputButtons(settings, stContext, processMessageFn) {
    if ($('#cat-input-btn-group').length) return;
    const target = $('#send_but'); 
    if (!target.length) return; // ChatGPT 권장 null 체크

    const group = $('<div id="cat-input-btn-group" class="cat-input-btn-group"></div>');
    const bulkBtn = $(`<div id="cat-bulk-btn" class="cat-input-icon interactable" title="벌크 번역"><span>⚡</span></div>`);
    const transBtn = $(`<div id="cat-input-btn" class="cat-input-icon interactable"><span class="cat-emoji-icon">${getThemeEmoji()}</span></div>`);
    
    group.append(bulkBtn, transBtn);
    target.before(group);

    bulkBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); showBulkPopup(e, settings, stContext, processMessageFn); });
    transBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); processMessageFn(null, true); });
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
    const topPos = rect.top > 300 ? (rect.top - 240) : (rect.bottom + 10);
    popup.css({ position: 'fixed', top: topPos + 'px', left: Math.max(10, rect.left - 50) + 'px', zIndex: 2147483647 });
    $('body').append(popup);
    
    popup.find('.cat-bulk-option').on('click', async function() {
        const c = $(this).data('count'); popup.remove();
        let final = c;
        if (c === 'custom') {
            const input = prompt("몇 개를 번역할까요?", "5");
            if (!input || isNaN(input)) return;
            final = parseInt(input);
        }
        const allMes = $('.mes');
        let targets = (final === 'all') ? allMes : allMes.slice(Math.max(0, allMes.length - parseInt(final)));
        for (const el of targets.get()) {
            if ($(el).attr('data-cat-translated') === 'true') continue; // 중복 방지
            await processMessageFn($(el).attr('mesid'), false, null, true);
            await new Promise(r => setTimeout(r, 600)); 
        }
    });
    $(document).one('click', () => popup.remove());
}
