import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/utils.js';

const extName = "cat-translator-beta";
const stContext = getContext();

let translationCache = {};
let isTranslatingInput = false;

// 🚦 가져온 아이디어: 전체 번역 및 중단 상태 관리
let isChatTranslationInProgress = false;
let isTranslateChatCanceled = false;
const translationInProgress = {};

// 💊 알약 알림창 (베타 표기)
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

const defaultPrompt = 'You are a direct translation engine. Translate the input into {{language}} exactly. Output ONLY the raw translation without any explanations.';

const defaultSettings = {
    profile: '', 
    customKey: '',
    directModel: 'gemini-1.5-flash',
    autoMode: 'none',
    targetLang: 'Korean',
    prompt: defaultPrompt,
    dictionary: ''
};

// ⚙️ 설정 로드 및 초기화
let settings = Object.assign({}, defaultSettings, extension_settings[extName]);
if (!settings.prompt || settings.prompt.trim() === "") settings.prompt = defaultPrompt;

function saveSettings() {
    settings.prompt = $('#ct-prompt').val() || settings.prompt;
    settings.targetLang = $('#ct-lang').val() || settings.targetLang;
    settings.directModel = $('#ct-model').val() || settings.directModel;
    settings.autoMode = $('#ct-auto-mode').val() || settings.autoMode;
    settings.profile = $('#ct-profile').val() || '';
    settings.customKey = $('#ct-key').val() || '';
    settings.dictionary = $('#ct-dictionary').val() || '';
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
    translationCache = {}; 
}

// 🧺 회색 박스 제거 세탁기
function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/```[a-z]*\n?/gi, "")
        .replace(/```/g, "")
        .replace(/^(번역|Translation|Output|English|Korean):\s*/gi, "")
        .trim();
}

// 🚀 스마트 번역 API (404 완치 로직 포함)
async function fetchTranslation(text, forceLang = null, prevTranslation = null) {
    if (!text || text.trim() === "") return null;
    
    let isToEnglish = forceLang ? (forceLang === "English") : ((text.match(/[가-힣]/g) || []).length >= (text.match(/[a-zA-Z]/g) || []).length);
    const targetLang = isToEnglish ? "English" : settings.targetLang;
    const cacheKey = `${targetLang}_${text.trim()}`;

    // 💰 토큰 아낌 알림
    if (!prevTranslation && translationCache[cacheKey]) {
        return { text: translationCache[cacheKey], lang: targetLang, cached: true };
    }

    const STRICT_DIRECTIVE = `[CRITICAL] Translate the input into ${targetLang} exactly. Output ONLY the raw translation. NO explanations. NO markdown code blocks.`;
    let promptWithText = `${STRICT_DIRECTIVE}\n\nInput: ${text}\nOutput:`;

    try {
        let result = "";
        if (settings.profile && stContext.ConnectionManagerRequestService) {
            const response = await stContext.ConnectionManagerRequestService.sendRequest(settings.profile, [{ role: "user", content: promptWithText }], 8192);
            result = typeof response === 'string' ? response : (response.content || "");
        } else {
            const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
            if (!apiKey) throw new Error("API Key Missing");
            
            let modelId = settings.directModel || "gemini-1.5-flash";
            if (modelId.startsWith('models/')) modelId = modelId.substring(7);
            
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: promptWithText }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            result = data.candidates?.[0]?.content?.parts?.find(p => !p.thought)?.text?.trim() || "";
        }
        
        const translatedText = cleanResult(result) || text;
        if (translatedText !== text) translationCache[cacheKey] = translatedText;
        return { text: translatedText, lang: targetLang, cached: false };
    } catch (e) {
        console.error("🐱 번역 실패:", e);
        return null;
    }
}

// 📝 메시지 처리 로직
async function processMessage(id, isInput = false) {
    const msgId = parseInt(id, 10);
    if (translationInProgress[msgId]) return;
    
    const msg = stContext.chat[msgId];
    if (!msg) return;

    translationInProgress[msgId] = true;
    const btnIcon = $(`.mes[mesid="${msgId}"]`).find('.cat-mes-trans-btn .cat-emoji-icon');
    btnIcon.addClass('cat-glow-anim');
    
    try {
        let textToTranslate = isInput ? (msg.extra?.original_mes || msg.mes) : msg.mes;
        const res = await fetchTranslation(textToTranslate);
        
        if (res) {
            if (res.cached) catNotify("🐱 캐시 사용: 토큰 절약 완료!");
            if (isInput) {
                if (!msg.extra) msg.extra = {};
                if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
                msg.mes = res.text;
            } else {
                if (!msg.extra) msg.extra = {};
                msg.extra.display_text = res.text;
            }
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        btnIcon.removeClass('cat-glow-anim');
    }
}

// 🌍 가져온 아이디어: 전체 채팅 번역
async function onTranslateChatClick() {
    if (isChatTranslationInProgress) {
        isTranslateChatCanceled = true;
        toastr.info('채팅 번역을 중단합니다냥.');
        return;
    }

    const confirm = await callGenericPopup(
        '🐱 전체 채팅을 번역하시겠습니까냥? (토큰 주의!)',
        POPUP_TYPE.CONFIRM
    );
    if (!confirm) return;

    isChatTranslationInProgress = true;
    isTranslateChatCanceled = false;
    $('#cat-batch-btn').text('번역 중단하기 🐾').addClass('cat-btn-abort');

    try {
        for (let i = 0; i < stContext.chat.length; i++) {
            if (isTranslateChatCanceled) break;
            const msg = stContext.chat[i];
            // 이미 번역된 건 건너뛰기
            if (msg.extra?.display_text || msg.extra?.original_mes) continue;
            
            catNotify(`🐱 전체 번역 중... (${i+1}/${stContext.chat.length})`);
            await processMessage(i);
            // API 과부하 방지 딜레이
            await new Promise(r => setTimeout(r, 300));
        }
        catNotify(isTranslateChatCanceled ? "🐱 번역이 중단되었습니다." : "🐱 모든 메시지 번역 완료!");
    } finally {
        isChatTranslationInProgress = false;
        $('#cat-batch-btn').text('전체 채팅 번역 🌍').removeClass('cat-btn-abort');
    }
}

// 🧹 가져온 아이디어: 모든 번역 삭제
async function onTranslationsClearClick() {
    const confirm = await callGenericPopup(
        '🐱 번역된 내용을 모두 삭제하고 원본으로 되돌리시겠습니까냥?',
        POPUP_TYPE.CONFIRM
    );
    if (!confirm) return;

    stContext.chat.forEach((msg, idx) => {
        let changed = false;
        if (msg.extra?.display_text) { delete msg.extra.display_text; changed = true; }
        if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; changed = true; }
        if (changed) stContext.updateMessageBlock(idx, msg);
    });
    translationCache = {};
    catNotify("🐱 모든 번역 기록을 세탁했습니다냥!");
}

function revertMessage(id) {
    const msgId = parseInt(id, 10);
    const msg = stContext.chat[msgId];
    if (!msg) return;
    if (msg.extra?.display_text) delete msg.extra.display_text;
    if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; }
    stContext.updateMessageBlock(msgId, msg);
}

function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        const group = $(`<div class="cat-btn-group"><span class="cat-mes-trans-btn" title="번역"><span class="cat-emoji-icon">🐱</span></span><span class="cat-mes-revert-btn fa-solid fa-rotate-left" title="복구"></span></div>`);
        $(this).find('.name_text').append(group);
        group.find('.cat-mes-trans-btn').on('click', () => processMessage(msgId));
        group.find('.cat-mes-revert-btn').on('click', () => revertMessage(msgId));
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    let pOpt = ''; (stContext.extensionSettings?.connectionManager?.profiles || []).forEach(p => { pOpt += `<option value="${p.id}">${p.name}</option>`; });
    const uiHtml = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 (Beta)</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>연결 프로필</label><select id="ct-profile" class="text_pole">${pOpt}</select></div>
                <div id="direct-mode-settings" style="display: ${settings.profile === '' ? 'block' : 'none'};">
                    <div class="cat-setting-row"><label>API Key</label>
                        <div class="cat-key-wrapper">
                            <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}">
                            <span id="ct-key-paw" class="ct-key-toggle-paw">🐾</span>
                        </div>
                    </div>
                </div>
                
                <div class="cat-batch-group" style="margin-top:10px; display:flex; gap:5px;">
                    <button id="cat-batch-btn" class="menu_button cat-native-font" style="flex:2;">전체 채팅 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button cat-native-font" style="flex:1; background-color:rgba(231, 76, 60, 0.2); border-color:#e74c3c;">삭제 🧹</button>
                </div>

                <button id="cat-save-btn" class="menu_button" style="margin-top: 10px; width:100%;">설정 저장 🐱</button>
                <div style="font-size: 0.7em; opacity: 0.3; text-align: center; margin-top: 5px;">v18.5.0-beta 집사 모드</div>
            </div>
        </div>`;
    $('#extensions_settings').append(uiHtml);
    $('#cat-drawer-header').on('click', () => { $('#cat-drawer-content').slideToggle(200); $('#cat-drawer-toggle').toggleClass('fa-chevron-down fa-chevron-up'); });
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("🐱 설정 저장 완료!"); });
    $('#cat-batch-btn').on('click', onTranslateChatClick);
    $('#cat-clear-btn').on('click', onTranslationsClearClick);
    $('#ct-key-paw').on('click', function() {
        const input = $('#ct-key');
        input.attr('type', input.attr('type') === 'password' ? 'text' : 'password');
    });
}

jQuery(() => {
    setupUI();
    setInterval(injectButtons, 500);
});
