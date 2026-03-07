import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/utils.js';

const extName = "cat-translator-pro";
const stContext = getContext();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cat-trans-default';

// 🚦 상태 관리
let isBatchInProgress = false;
let isBatchCanceled = false;
const translationInProgress = {};
let db = null;

// 💾 IndexedDB 초기화 (영구 로컬 캐시)
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("CatTranslatorDB", 1);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains("cache")) {
                database.createObjectStore("cache", { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains("dict")) {
                database.createObjectStore("dict", { keyPath: "original" });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
};

// 📦 DB 작업 헬퍼
const dbGet = (storeName, id) => {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
};

const dbPut = (storeName, data) => {
    return new Promise((resolve) => {
        if (!db) return resolve(false);
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
    });
};

const dbGetAll = (storeName) => {
    return new Promise((resolve) => {
        if (!db) return resolve([]);
        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
};

const dbDelete = (storeName, id) => {
    if (!db) return;
    const transaction = db.transaction([storeName], "readwrite");
    transaction.objectStore(storeName).delete(id);
};

const defaultSettings = {
    customKey: '',
    targetLang: 'Korean',
    temperature: 0.1,
    maxTokens: 0, // 0이면 자동 최대
    viewMode: 'translated', // original, translated, bilingual
    qualityMode: 'flash', // flash, pro
    customPrompt: ''
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.customKey = $('#ct-key').val();
    settings.targetLang = $('#ct-lang').val();
    settings.temperature = parseFloat($('#ct-temp').val());
    settings.maxTokens = parseInt($('#ct-tokens').val());
    settings.qualityMode = $('#ct-quality').val();
    settings.viewMode = $('#ct-view').val();
    settings.customPrompt = $('#ct-prompt').val();
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// 💊 알약 알림
function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => notifyHtml.addClass('show'), 50);
    setTimeout(() => {
        notifyHtml.removeClass('show');
        setTimeout(() => notifyHtml.remove(), 500);
    }, 3000);
}

// 🧼 텍스트 정밀 세정 & 패턴 보호막
const PROTECT_PATTERN = /(<[^>]+>|\*[^*]+\*|\[[^\]]+\]|`[^`]+`|```[\s\S]*?```)/g;

function protectAndTranslate(text, translateFn) {
    const placeholders = [];
    let index = 0;
    const protectedText = text.replace(PROTECT_PATTERN, (match) => {
        const id = `[[CAT_PRO_${index++}]]`;
        placeholders.push({ id, original: match });
        return id;
    });
    return { protectedText, placeholders };
}

function restorePatterns(text, placeholders) {
    let restoredText = text;
    placeholders.forEach(p => {
        restoredText = restoredText.replace(p.id, p.original);
    });
    return restoredText;
}

function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/```[a-z]*\n?/gi, "")
        .replace(/```/g, "")
        .replace(/^(번역|Translation|Output):\s*/gi, "")
        .replace(/^\s*/gi, "") // 냥헴 정규식
        .trim();               // 냥헴 트림
}

// 🔄 한-영 스마트 스위치
function getTargetLanguage(text) {
    const koCount = (text.match(/[가-힣]/g) || []).length;
    const enCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (koCount > enCount) return "English";
    return settings.targetLang;
}

// 🚀 API 호출 (지수 백오프 적용)
async function callGemini(prompt, retryCount = 0) {
    const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
    if (!apiKey) throw new Error("API 키가 없습니다냥! 🐾");

    const modelId = settings.qualityMode === 'pro' ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const maxTokens = settings.maxTokens === 0 ? 8192 : settings.maxTokens;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: settings.temperature, maxOutputTokens: maxTokens },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        if (response.status === 429 && retryCount < 5) {
            await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 1000));
            return callGemini(prompt, retryCount + 1);
        }

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "HTTP " + response.status);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch (e) {
        if (retryCount < 5) {
            await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 1000));
            return callGemini(prompt, retryCount + 1);
        }
        throw e;
    }
}

// 💰 사전 기반 토큰 세이버
async function applyDictionary(text) {
    const dict = await dbGetAll("dict");
    let swappedText = text;
    dict.forEach(item => {
        const regex = new RegExp(item.original, 'gi');
        swappedText = swappedText.replace(regex, item.translation);
    });
    return swappedText;
}

// 🧬 메인 번역 프로세스
async function translateText(text) {
    if (!text || text.trim() === "") return null;

    const targetLang = getTargetLanguage(text);
    const cacheKey = `${targetLang}_${text.trim()}`;
    
    // 1. IndexedDB 캐시 확인
    const cached = await dbGet("cache", cacheKey);
    if (cached) {
        catNotify("🐱 캐시 사용: 토큰 절약!", "success");
        return cached.translation;
    }

    // 2. 사전 치환
    const swappedText = await applyDictionary(text);
    
    // 3. 패턴 보호
    const { protectedText, placeholders } = protectAndTranslate(swappedText);

    // 4. API 호출
    const systemPrompt = settings.customPrompt || `Translate the following text to ${targetLang}. Preserve all [[CAT_PRO_N]] placeholders exactly. Output ONLY the raw translated text.`;
    const fullPrompt = `${systemPrompt}\n\nText: ${protectedText}`;

    try {
        const rawResult = await callGemini(fullPrompt);
        let cleaned = cleanResult(rawResult);
        
        // 5. 패턴 복원
        const finalResult = restorePatterns(cleaned, placeholders);
        
        // 6. 캐시 저장
        await dbPut("cache", { id: cacheKey, translation: finalResult });
        
        return finalResult;
    } catch (e) {
        console.error("🐱 번역 실패:", e);
        catNotify("🐱 API 오류냥! 콘솔을 확인해달라냥.", "danger");
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
        const originalText = msg.extra?.original_mes || msg.mes;
        const translated = await translateText(originalText);
        if (translated) {
            if (!msg.extra) msg.extra = {};
            msg.extra.original_mes = originalText;
            msg.extra.display_text = translated;
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');
    }
}

// 🌍 배치 작업
async function onBatchTranslate() {
    if (isBatchInProgress) { isBatchCanceled = true; return; }
    const confirm = await callGenericPopup("🐱 전체 번역을 시작할까냥?", POPUP_TYPE.CONFIRM);
    if (!confirm) return;

    isBatchInProgress = true;
    isBatchCanceled = false;
    $('#cat-batch-btn').text('중단🐾').addClass('cat-btn-abort');

    try {
        for (let i = 0; i < stContext.chat.length; i++) {
            if (isBatchCanceled) break;
            const msg = stContext.chat[i];
            if (msg.extra?.display_text) continue;
            await processMessage(i);
            await new Promise(r => setTimeout(r, 500));
        }
        catNotify(isBatchCanceled ? "🐱 중단됨!" : "🐱 전체 번역 완료!");
    } finally {
        isBatchInProgress = false;
        $('#cat-batch-btn').text('전체 번역 🌍').removeClass('cat-btn-abort');
    }
}

async function onClearAll() {
    const confirm = await callGenericPopup("🐱 모든 번역을 지울까냥? (캐시는 유지된다냥)", POPUP_TYPE.CONFIRM);
    if (!confirm) return;
    stContext.chat.forEach((msg, i) => {
        if (msg.extra?.display_text) {
            delete msg.extra.display_text;
            stContext.updateMessageBlock(i, msg);
        }
    });
    catNotify("🐱 원본 복구 완료!");
}

// 🐾 드래그 사전 등록 UI
function setupQuickAdd() {
    $(document).on('mouseup touchend', function(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        $('.cat-quick-paw').remove();
        
        if (selectedText && selectedText.length < 50) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            const paw = $(`<div class="cat-quick-paw">🐾</div>`);
            $('body').append(paw);
            paw.css({
                top: rect.top + window.scrollY - 35,
                left: rect.left + window.scrollX + (rect.width/2) - 15
            });

            paw.on('mousedown touchstart', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const translation = prompt(`🐱 "${selectedText}" 의 고정 번역어를 입력해달라냥:`);
                if (translation) {
                    await dbPut("dict", { original: selectedText, translation: translation });
                    catNotify(`🐱 사전 등록 완료: ${selectedText} = ${translation}`);
                }
                paw.remove();
            });
        }
    });
}

function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        const group = $(`
            <div class="cat-btn-group">
                <span class="cat-mes-trans-btn" title="번역"><span class="cat-emoji-icon">🐱</span></span>
                <span class="cat-mes-revert-btn fa-solid fa-rotate-left" title="복구"></span>
            </div>
        `);
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
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 Pro (v18.0)</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>API Key</label>
                    <div class="cat-key-wrapper">
                        <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}">
                        <span id="ct-key-paw" class="ct-key-toggle-paw">🐾</span>
                    </div>
                </div>
                <div class="cat-setting-row"><label>품질 모드</label>
                    <select id="ct-quality" class="text_pole">
                        <option value="flash" ${settings.qualityMode === 'flash' ? 'selected' : ''}>가성비 고양이 (Flash)</option>
                        <option value="pro" ${settings.qualityMode === 'pro' ? 'selected' : ''}>고성능 호랑이 (Pro)</option>
                    </select>
                </div>
                <div class="cat-setting-row" style="display:flex; gap:10px;">
                    <div style="flex:1;"><label>온도 (Temp)</label><input type="number" id="ct-temp" class="text_pole" step="0.1" value="${settings.temperature}"></div>
                    <div style="flex:1;"><label>토큰 (0=Auto)</label><input type="number" id="ct-tokens" class="text_pole" value="${settings.maxTokens}"></div>
                </div>
                <div class="cat-setting-row"><label>표시 모드</label>
                    <select id="ct-view" class="text_pole">
                        <option value="translated" ${settings.viewMode === 'translated' ? 'selected' : ''}>번역본만</option>
                        <option value="bilingual" ${settings.viewMode === 'bilingual' ? 'selected' : ''}>원문 + 번역 (병기)</option>
                    </select>
                </div>
                <div class="cat-batch-group" style="display:flex; gap:5px; margin-top:10px;">
                    <button id="cat-batch-btn" class="menu_button" style="flex:2;">전체 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button" style="flex:1;">삭제 🧹</button>
                </div>
                <button id="cat-save-btn" class="menu_button" style="margin-top:10px; width:100%;">설정 저장 🐱</button>
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

jQuery(async () => {
    await initDB();
    setupUI();
    injectButtons();
    setupQuickAdd();
    
    const observer = new MutationObserver(() => injectButtons());
    const chatBody = document.getElementById('chat');
    if (chatBody) observer.observe(chatBody, { childList: true, subtree: true });
});
