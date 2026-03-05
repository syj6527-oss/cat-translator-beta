console.log("CAT TRANSLATOR LOADED");

import { extension_settings, getContext } from '../../../extensions.js';
import { secret_state, SECRET_KEYS } from '../../../secrets.js';
import { callGenericPopup, POPUP_TYPE } from '../../../utils.js';

const extName = "cat-translator-beta";
const stContext = getContext();

// 🚦 상태 관리 변수
let isChatTranslationInProgress = false;
let isTranslateChatCanceled = false;
const translationInProgress = {};
let translationCache = {};

// 💊 알약 알림창 (모바일 대응 하단 배치)
function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => { notifyHtml.addClass('show'); }, 50);
    setTimeout(() => {
        notifyHtml.removeClass('show');
        setTimeout(() => { notifyHtml.remove(); }, 500);
    }, 3000);
}

const defaultSettings = {
    customKey: '',
    directModel: 'gemini-1.5-flash',
    targetLang: 'Korean',
    temperature: 0.2, // 창의성 조절 파라미터
    maxTokens: 2048   // 출력 길이 제한 파라미터
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.customKey = $('#ct-key').val() || '';
    settings.directModel = $('#ct-model').val() || 'gemini-1.5-flash';
    settings.targetLang = $('#ct-lang').val() || 'Korean';
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// 🧺 세탁기 함수 (보내주신 정규식과 trim 로직 반영!)
function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/```[a-z]*\n?/gi, "") // 코드 블록 기호 제거
        .replace(/```/g, "")
        .replace(/^(번역|Translation|Output):\s*/gi, "")
        .replace(/^\s*/gi, "") // 앞쪽 공백 제거 정규식
        .trim();               // 양쪽 공백 최종 제거
}

// 🚀 스마트 번역 API (파라미터 및 안전 설정 적용)
async function fetchTranslation(text) {
    if (!text || text.trim() === "") return null;
    const isToEnglish = ((text.match(/[가-힣]/g) || []).length >= (text.match(/[a-zA-Z]/g) || []).length);
    const targetLang = isToEnglish ? "English" : settings.targetLang;
    
    // 💰 토큰 아낌 캐시 확인
    const cacheKey = `${targetLang}_${text.trim()}`;
    if (translationCache[cacheKey]) {
        catNotify("🐱 캐시 사용: 토큰을 아꼈습니다!");
        return translationCache[cacheKey];
    }

    try {
        const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
        if (!apiKey) throw new Error("API Key Missing");
        
        let modelId = settings.directModel;
        if (modelId.startsWith('models/')) modelId = modelId.substring(7);
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: `Translate to ${targetLang}. Output ONLY raw text.\n\n${text}` }] }],
                generationConfig: { 
                    temperature: settings.temperature, // 파라미터 적용
                    maxOutputTokens: settings.maxTokens  // 파라미터 적용
                },
                // 🛡️ API 오류 방지를 위한 안전 설정 (BLOCK_NONE으로 검열 완화)
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "HTTP " + response.status);
        }
        const data = await response.json();
        const result = cleanResult(data.candidates?.[0]?.content?.parts?.[0]?.text) || text;
        
        if (result !== text) translationCache[cacheKey] = result;
        return result;
    } catch (e) {
        console.error("🐱 API Error:", e);
        return null;
    }
}

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
        if (resText) {
            if (!msg.extra) msg.extra = {};
            msg.extra.original_mes = textToTranslate;
            msg.extra.display_text = resText;
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');
    }
}

// 🧹 전체 삭제 (아이디어 이식)
async function onClearAll() {
    const confirm = await callGenericPopup('🐱 모든 번역을 지울까냥?', POPUP_TYPE.CONFIRM);
    if (!confirm) return;
    for (let i = 0; i < stContext.chat.length; i++) {
        const m = stContext.chat[i];
        if (m.extra?.display_text) {
            delete m.extra.display_text;
            stContext.updateMessageBlock(i, m);
            if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
        }
    }
    translationCache = {};
    catNotify("🐱 원본 복구 완료!");
}

// 🌍 전체 번역 (중단 로직 포함)
async function onBatchTranslate() {
    if (isChatTranslationInProgress) {
        isTranslateChatCanceled = true;
        return;
    }
    const confirm = await callGenericPopup('🐱 전체 번역을 시작할까냥?', POPUP_TYPE.CONFIRM);
    if (!confirm) return;

    isChatTranslationInProgress = true;
    isTranslateChatCanceled = false;
    $('#cat-batch-btn').text('중단🐾').addClass('cat-btn-abort');

    try {
        for (let i = 0; i < stContext.chat.length; i++) {
            if (isTranslateChatCanceled) break;
            const msg = stContext.chat[i];
            if (msg.extra?.display_text || msg.extra?.original_mes) continue;
            await processMessage(i);
            await new Promise(r => setTimeout(r, 400));
        }
        catNotify(isTranslateChatCanceled ? "🐱 중단됨!" : "🐱 전체 번역 완료!");
    } finally {
        isChatTranslationInProgress = false;
        $('#cat-batch-btn').text('전체 번역 🌍').removeClass('cat-btn-abort');
    }
}

function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        const group = $(`<div class="cat-btn-group"><span class="cat-mes-trans-btn" title="번역"><span class="cat-emoji-icon">🐱</span></span><span class="cat-mes-revert-btn fa-solid fa-rotate-left" title="복구"></span></div>`);
        $(this).find('.name_text').first().append(group);
        group.find('.cat-mes-trans-btn').on('click', (e) => { e.stopPropagation(); processMessage(msgId); });
        group.find('.cat-mes-revert-btn').on('click', (e) => {
            e.stopPropagation();
            const msg = stContext.chat[msgId];
            if (msg.extra?.display_text) delete msg.extra.display_text;
            stContext.updateMessageBlock(msgId, msg);
        });
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    const uiHtml = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 (v18.7)</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>API Key</label>
                    <div class="cat-key-wrapper">
                        <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}">
                        <span id="ct-key-paw" class="ct-key-toggle-paw">🐾</span>
                    </div>
                </div>
                <div class="cat-batch-group" style="display:flex; gap:5px; margin-top:10px;">
                    <button id="cat-batch-btn" class="menu_button" style="flex:2;">전체 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button" style="flex:1;">삭제 🧹</button>
                </div>
                <button id="cat-save-btn" class="menu_button" style="margin-top:10px; width:100%;">설정 저장 🐱</button>
                <div style="font-size: 0.7em; opacity: 0.3; text-align: center; margin-top: 5px;">v18.7.0-beta 커뮤니티 스타 에디션</div>
            </div>
        </div>`;
    $('#extensions_settings').append(uiHtml);
    $('#cat-drawer-header').on('click', () => $('#cat-drawer-content').slideToggle(200));
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("🐱 설정 저장!"); });
    $('#cat-batch-btn').on('click', onBatchTranslate);
    $('#cat-clear-btn').on('click', onClearAll);
    $('#ct-key-paw').on('click', function() {
        const input = $('#ct-key');
        input.attr('type', input.attr('type') === 'password' ? 'text' : 'password');
    });
}

jQuery(() => {
    setupUI();
    injectButtons();
    // 모바일 감시 엔진 장착
    const observer = new MutationObserver(() => injectButtons());
    const chatBody = document.getElementById('chat');
    if (chatBody) observer.observe(chatBody, { childList: true, subtree: true });
});
