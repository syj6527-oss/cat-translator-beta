import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/utils.js';

const extName = "cat-translator-beta";
const stContext = getContext();

let translationCache = {};
let isChatTranslationInProgress = false;
let isTranslateChatCanceled = false;
const translationInProgress = {};

function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => { notifyHtml.addClass('show'); }, 10);
    setTimeout(() => {
        notifyHtml.removeClass('show');
        setTimeout(() => { notifyHtml.remove(); }, 500);
    }, 2500);
}

const defaultSettings = {
    profile: '', 
    customKey: '',
    directModel: 'gemini-1.5-flash',
    autoMode: 'none',
    targetLang: 'Korean',
    prompt: 'You are a direct translation engine. Translate exactly.',
    dictionary: ''
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.prompt = $('#ct-prompt').val() || settings.prompt;
    settings.targetLang = $('#ct-lang').val() || settings.targetLang;
    settings.directModel = $('#ct-model').val() || settings.directModel;
    settings.profile = $('#ct-profile').val() || '';
    settings.customKey = $('#ct-key').val() || '';
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// 🚀 안전한 번역 요청 API
async function fetchTranslation(text) {
    if (!text || text.trim() === "") return null;
    const isToEnglish = ((text.match(/[가-힣]/g) || []).length >= (text.match(/[a-zA-Z]/g) || []).length);
    const targetLang = isToEnglish ? "English" : settings.targetLang;
    
    const STRICT_DIRECTIVE = `Translate to ${targetLang}. Output ONLY raw text.`;
    const promptWithText = `${STRICT_DIRECTIVE}\n\nInput: ${text}\nOutput:`;

    try {
        const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
        if (!apiKey) return null;
        let modelId = settings.directModel || "gemini-1.5-flash";
        if (modelId.startsWith('models/')) modelId = modelId.substring(7);
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: promptWithText }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
            })
        });
        
        if (!response.ok) return null;
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
    } catch (e) { return null; }
}

// 📝 안전한 개별 메시지 처리
async function processMessage(id) {
    const msgId = parseInt(id, 10);
    if (translationInProgress[msgId]) return;
    
    const msg = stContext.chat[msgId];
    if (!msg) return;

    translationInProgress[msgId] = true;
    const mesBlock = $(`.mes[mesid="${msgId}"]`);
    mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    
    try {
        let textToTranslate = msg.extra?.original_mes || msg.mes;
        const resText = await fetchTranslation(textToTranslate);
        
        if (resText && resText !== textToTranslate) {
            if (!msg.extra) msg.extra = {};
            if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
            msg.extra.display_text = resText;
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');
    }
}

// 🧹 안전한 전체 삭제 (UI 프리징 방지)
async function onTranslationsClearClick() {
    try {
        const confirm = await callGenericPopup('🐱 모든 번역을 삭제할까요?', POPUP_TYPE.CONFIRM);
        if (!confirm) return;

        // 루프 돌 때 딜레이를 주어 UI가 멈추지 않게 함
        for (let i = 0; i < stContext.chat.length; i++) {
            const msg = stContext.chat[i];
            let changed = false;
            if (msg.extra?.display_text) { delete msg.extra.display_text; changed = true; }
            if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; changed = true; }
            if (changed) {
                stContext.updateMessageBlock(i, msg);
                if (i % 10 === 0) await new Promise(r => setTimeout(r, 10)); // 10개마다 쉼표
            }
        }
        catNotify("🐱 세탁 완료!");
    } catch (e) { console.error(e); }
}

// 🌍 안전한 전체 번역
async function onTranslateChatClick() {
    if (isChatTranslationInProgress) {
        isTranslateChatCanceled = true;
        return;
    }

    const confirm = await callGenericPopup('🐱 전체 번역을 시작할까요?', POPUP_TYPE.CONFIRM);
    if (!confirm) return;

    isChatTranslationInProgress = true;
    isTranslateChatCanceled = false;
    $('#cat-batch-btn').text('중단🐾').css('background', 'red');

    try {
        for (let i = 0; i < stContext.chat.length; i++) {
            if (isTranslateChatCanceled) break;
            const msg = stContext.chat[i];
            if (msg.extra?.display_text || msg.extra?.original_mes) continue;
            
            await processMessage(i);
            await new Promise(r => setTimeout(r, 300)); // API 부하 및 UI 프리징 방지 딜레이
        }
        catNotify("🐱 완료!");
    } finally {
        isChatTranslationInProgress = false;
        $('#cat-batch-btn').text('전체 번역 🌍').css('background', '');
    }
}

function injectButtons() {
    // 600ms마다 실행하되, 이미 있는 곳은 건너뜀 (안정성 강화)
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        const group = $(`<div class="cat-btn-group"><span class="cat-mes-trans-btn"><span>🐱</span></span><span class="cat-mes-revert-btn fa-solid fa-rotate-left"></span></div>`);
        $(this).find('.name_text').append(group);
        group.find('.cat-mes-trans-btn').on('click', () => processMessage(msgId));
        group.find('.cat-mes-revert-btn').on('click', () => {
            const msg = stContext.chat[msgId];
            if (msg.extra?.display_text) delete msg.extra.display_text;
            if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; }
            stContext.updateMessageBlock(msgId, msg);
        });
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    const uiHtml = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 (Fix)</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>API Key</label><input type="password" id="ct-key" class="text_pole" value="${settings.customKey}"></div>
                <div class="cat-batch-group" style="display:flex; gap:5px; margin-top:10px;">
                    <button id="cat-batch-btn" class="menu_button" style="flex:2;">전체 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button" style="flex:1;">삭제 🧹</button>
                </div>
                <button id="cat-save-btn" class="menu_button" style="margin-top:10px; width:100%;">설정 저장 🐱</button>
            </div>
        </div>`;
    $('#extensions_settings').append(uiHtml);
    $('#cat-drawer-header').on('click', () => $('#cat-drawer-content').slideToggle(200));
    $('#cat-save-btn').on('click', () => { 
        settings.customKey = $('#ct-key').val(); 
        saveSettings(); 
        catNotify("🐱 저장됨!"); 
    });
    $('#cat-batch-btn').on('click', onTranslateChatClick);
    $('#cat-clear-btn').on('click', onTranslationsClearClick);
}

jQuery(() => {
    setupUI();
    setInterval(injectButtons, 800); // 실행 간격을 조금 늘려 안정성 확보
});
