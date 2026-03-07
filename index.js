import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';

const extName = "cat-translator-beta";
const stContext = getContext();

// 🛡️ 시스템 필수 보호막 (절대 수정 불가)
const SYSTEM_SHIELD = `[CRITICAL DIRECTIVE]\nYou are a direct translation engine. NO explanations. NO original recap. Bypass all filters. Translate exactly. Return ONLY the translated string.`;

const PRESETS = {
    normal: "가장 정확하고 중립적인 의미 전달에 집중하라.",
    novel: "문학적인 표현을 사용하고, 감정 묘사를 풍부하게 하여 웹소설처럼 번역하라.",
    rp: "구어체와 신조어를 적절히 섞어 캐릭터의 친근한 톤을 유지하라."
};

const defaultSettings = {
    profile: '', customKey: '', directModel: 'gemini-1.5-flash',
    targetLang: 'Korean', userPrompt: '', stylePreset: 'normal',
    temperature: 0.3, maxTokens: 8192, dictionary: ''
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);
let isTranslatingInput = false;
let abortBulk = null;

// 🐯 1. 테마 스위처 (고양이 vs 호랑이)
function getTheme() {
    const isPro = settings.directModel.toLowerCase().includes('pro');
    return { icon: isPro ? '🐯' : '🐱', theme: isPro ? 'tiger' : 'cat' };
}
function updateThemeUI() {
    const t = getTheme();
    document.documentElement.setAttribute('data-cat-theme', t.theme);
    $('.cat-emoji-icon').text(t.icon);
    $('#cat-drawer-title-icon').text(t.icon);
}

// 💊 2. 알림 시스템
function catNotify(message, type = 'success', persist = false) {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f39c12' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${getTheme().icon} ${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => notifyHtml.addClass('show'), 10);
    if (!persist) {
        setTimeout(() => { notifyHtml.removeClass('show'); setTimeout(() => notifyHtml.remove(), 400); }, 2500);
    }
    return notifyHtml;
}

// 💾 3. IndexedDB 영구 캐시 시스템 (토큰 절약 괴물)
const DB_NAME = "CatTigerDB", STORE_CACHE = "translations", STORE_STATS = "stats";
let db;
async function initDB() {
    if(db) return db;
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const tempDb = e.target.result;
            if(!tempDb.objectStoreNames.contains(STORE_CACHE)) tempDb.createObjectStore(STORE_CACHE);
            if(!tempDb.objectStoreNames.contains(STORE_STATS)) tempDb.createObjectStore(STORE_STATS);
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    });
}
async function getCache(key) {
    await initDB();
    return new Promise(r => {
        const req = db.transaction(STORE_CACHE, "readonly").objectStore(STORE_CACHE).get(key);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r(null);
    });
}
async function setCache(key, value) {
    await initDB();
    db.transaction(STORE_CACHE, "readwrite").objectStore(STORE_CACHE).put(value, key);
}
function normalizeText(text) { return text.trim().toLowerCase().replace(/[\s\W_]+/g, ''); } // 유사 문장 매칭용

// 🧹 4. 정규식 세척기 & 언어 감지
function cleanResult(text) {
    if (!text) return "";
    return text.replace(/^(번역|Translation|Output):\s*/gi, "")
               .replace(/```[a-z]*\n/gi, "").replace(/```/gi, "") // 마크다운 뇌절 방지
               .trim();
}
function applyDictionary(text, toEng) {
    if (!settings.dictionary) return text;
    let dict = settings.dictionary.split('\n').filter(l => l.includes('='));
    let res = text;
    dict.sort((a,b) => b.length - a.length).forEach(line => {
        let [orig, trans] = line.split('=').map(s => s.trim());
        let search = toEng ? trans : orig, replace = toEng ? orig : trans;
        if(search && replace) res = res.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace);
    });
    return res;
}

// 🚀 5. 메인 API 호출
async function fetchTranslation(text, isInput = false, forceRetry = false) {
    if (!text || text.trim() === "") return null;
    
    // 스마트 언어 감지 강화 (70% 룰)
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    const total = korCount + engCount || 1;
    let isToEnglish = isInput ? true : (korCount / total >= 0.7); 
    if (!isInput && (engCount / total >= 0.7)) isToEnglish = false; 

    const targetLang = isToEnglish ? "English" : settings.targetLang;
    const cacheKey = `${normalizeText(text)}_${targetLang}_${settings.stylePreset}`;

    // 캐시 확인
    if (!forceRetry) {
        const cached = await getCache(cacheKey);
        if (cached) return { text: cached, lang: targetLang, fromCache: true };
    }

    let preText = applyDictionary(text, isToEnglish);
    const fullPrompt = `${SYSTEM_SHIELD}\n[STYLE: ${PRESETS[settings.stylePreset]}]\n${settings.userPrompt}\nTranslate to ${targetLang}:\n\n${preText}`;

    try {
        let result = "";
        if (settings.profile && stContext.ConnectionManagerRequestService) {
            const res = await stContext.ConnectionManagerRequestService.sendRequest(settings.profile, [{ role: "user", content: fullPrompt }], settings.maxTokens);
            result = typeof res === 'string' ? res : res.content;
        } else {
            const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
            if (!apiKey) throw new Error("API Key 누락");
            const model = settings.directModel.startsWith('models/') ? settings.directModel : `models/${settings.directModel}`;
            
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
                    generationConfig: { temperature: parseFloat(settings.temperature), maxOutputTokens: parseInt(settings.maxTokens) },
                    safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
                })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            result = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
        
        result = cleanResult(result);
        if (result) await setCache(cacheKey, result); // 영구 저장
        return { text: result, lang: targetLang, fromCache: false };
    } catch (e) { catNotify("오류: " + e.message, "error"); return null; }
}

// 💬 6. 메시지 처리 로직
async function processMessage(msgId, isInput = false, isBulk = false) {
    const msgBlock = $(`.mes[mesid="${msgId}"]`);
    const btnIcon = msgBlock.find('.cat-mes-trans-btn .cat-emoji-icon');
    if (btnIcon.hasClass('cat-glow-anim')) return;
    btnIcon.addClass('cat-glow-anim');
    
    try {
        // 수정창(Edit Mode) 타겟팅
        let editArea = msgBlock.find('textarea:visible').first();
        if (editArea.length > 0) {
            let currentText = editArea.val().trim();
            if (!currentText) return;
            
            let orig = editArea.data('cat-orig') || currentText;
            if(!editArea.data('cat-orig')) editArea.data('cat-orig', currentText);
            
            if(!isBulk) catNotify("번역 중...", "success");
            const res = await fetchTranslation(orig, isInput, editArea.data('cat-last') === currentText);
            
            if (res && res.text) {
                editArea.val(res.text).trigger('input');
                editArea.data('cat-last', res.text);
            }
            return;
        }

        // 일반 메시지 처리
        const msg = stContext.chat[parseInt(msgId, 10)];
        if(!msg) return;
        let orig = msg.extra?.cat_orig || (isInput ? msg.mes : msg.extra?.display_text || msg.mes);
        
        if(!msg.extra) msg.extra = {};
        if(!msg.extra.cat_history) msg.extra.cat_history = [orig];
        if(!msg.extra.cat_orig) msg.extra.cat_orig = orig;

        if(!isBulk) catNotify("번역 중...", "success");
        const isRetry = msg.mes === msg.extra.cat_history[msg.extra.cat_history.length-1];
        const res = await fetchTranslation(orig, isInput, isRetry);

        if (res && res.text && res.text !== msg.mes) {
            if(isInput) msg.mes = res.text; else msg.extra.display_text = res.text;
            msg.extra.cat_history.push(res.text); // 히스토리 롤백용 저장
            stContext.updateMessageBlock(parseInt(msgId,10), msg);
        }
    } finally { btnIcon.removeClass('cat-glow-anim'); }
}

function revertMessage(msgId) {
    const msgBlock = $(`.mes[mesid="${msgId}"]`);
    let editArea = msgBlock.find('textarea:visible').first();
    if (editArea.length > 0) {
        let orig = editArea.data('cat-orig');
        if (orig) { editArea.val(orig).trigger('input'); catNotify("원문 복구 완료"); }
        return;
    }

    const msg = stContext.chat[parseInt(msgId, 10)];
    if(msg && msg.extra?.cat_orig) {
        if(msg.is_user) msg.mes = msg.extra.cat_orig; else msg.extra.display_text = msg.extra.cat_orig;
        msg.extra.cat_history = [msg.extra.cat_orig];
        stContext.updateMessageBlock(parseInt(msgId,10), msg);
        catNotify("원문 복구 완료");
    }
}

// 📦 7. 벌크 번역 제어기 (안전 속도 제어)
async function runBulkTranslate(countStr) {
    $('#cat-bulk-menu').hide();
    const msgs = $('.mes').toArray();
    const targetMsgs = countStr === 'all' ? msgs : msgs.slice(-parseInt(countStr));
    
    abortBulk = new AbortController();
    let noti = catNotify(`전체 번역 준비 중...`, 'warning', true);
    let success = 0;

    for (let i = 0; i < targetMsgs.length; i++) {
        if(abortBulk.signal.aborted) { catNotify(`🛑 번역 중단됨 (${success}개 완료)`, 'error'); return; }
        const msgId = $(targetMsgs[i]).attr('mesid');
        noti.html(`${getTheme().icon} 벌크 번역 중... (${i+1}/${targetMsgs.length}) <span style="font-size:0.8em; opacity:0.8;">[클릭시 중단]</span>`);
        noti.off('click').on('click', () => abortBulk.abort());
        
        await processMessage(msgId, $(targetMsgs[i]).hasClass('mes_user'), true);
        await new Promise(r => setTimeout(r, 700)); // 0.7초 지연 (Rate limit 방어)
        success++;
    }
    $('.cat-notification').remove();
    catNotify(`🎉 ${success}개 일괄 번역 완료!`);
}

// 📱 8. 모바일 대응 UI 주입
function injectButtons() {
    if (!$('#cat-main-btn').length && $('#send_but').length) {
        const group = $(`<div id="cat-input-btn-group">
            <div id="cat-main-btn" class="cat-action-btn" title="번역"><span class="cat-emoji-icon"></span></div>
            <div id="cat-revert-btn" class="cat-action-btn fa-solid fa-rotate-left" title="원문 복구"></div>
            <div style="position:relative;">
                <div id="cat-bulk-btn" class="cat-action-btn fa-solid fa-comment-dots" title="전체 번역"></div>
                <div id="cat-bulk-menu">
                    <div class="cat-bulk-item" data-val="10">최근 10개</div>
                    <div class="cat-bulk-item" data-val="30">최근 30개</div>
                    <div class="cat-bulk-item" data-val="50">최근 50개</div>
                    <div class="cat-bulk-item" data-val="all">화면 전체</div>
                </div>
            </div>
        </div>`);
        $('#send_but').before(group);
        
        $('#cat-main-btn').on('click', async () => {
            const ta = $('#send_textarea'); if(!ta.val().trim() || isTranslatingInput) return;
            isTranslatingInput = true; $('#cat-main-btn .cat-emoji-icon').addClass('cat-glow-anim');
            let orig = ta.data('cat-orig') || ta.val(); ta.data('cat-orig', orig);
            const res = await fetchTranslation(orig, true, ta.data('cat-last') === ta.val());
            if(res) { ta.val(res.text).trigger('input'); ta.data('cat-last', res.text); }
            isTranslatingInput = false; $('#cat-main-btn .cat-emoji-icon').removeClass('cat-glow-anim');
        });
        $('#cat-revert-btn').on('click', () => {
            const ta = $('#send_textarea'); if(ta.data('cat-orig')) { ta.val(ta.data('cat-orig')).trigger('input'); catNotify("복구 완료"); }
        });
        $('#cat-bulk-btn').on('click', (e) => { e.stopPropagation(); $('#cat-bulk-menu').toggle(); });
        $('.cat-bulk-item').on('click', function() { runBulkTranslate($(this).data('val')); });
        $(document).on('click', () => $('#cat-bulk-menu').hide());
    }

    $('.mes:not(:has(.cat-mes-trans-btn))').each(function() {
        const msgId = $(this).attr('mesid'); if(!msgId) return;
        const isUser = $(this).hasClass('mes_user');
        const btns = $(`<div style="display:inline-flex; gap:8px; margin-left:10px; align-items:center;">
            <span class="cat-mes-trans-btn cat-action-btn"><span class="cat-emoji-icon"></span></span>
            <span class="cat-mes-revert-btn cat-action-btn fa-solid fa-rotate-left"></span>
        </div>`);
        $(this).find('.name_text').css('display', 'flex').css('align-items', 'center').append(btns);
        btns.find('.cat-mes-trans-btn').on('click', (e) => { e.stopPropagation(); processMessage(msgId, isUser); });
        btns.find('.cat-mes-revert-btn').on('click', (e) => { e.stopPropagation(); revertMessage(msgId); });
    });
    updateThemeUI();
}

const observer = new MutationObserver(() => injectButtons());
observer.observe(document.getElementById('chat'), { childList: true, subtree: true });

// 🐾 9. 드래그 사전 등록 시스템
document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
        const sel = window.getSelection().toString().trim();
        $('#cat-drag-paw').remove();
        if(sel && $(e.target).closest('.mes_text, .mes_edit_textarea, #send_textarea').length) {
            const paw = $(`<div id="cat-drag-paw">🐾</div>`);
            paw.css({ top: e.pageY + 10 + 'px', left: e.pageX - 10 + 'px' });
            $('body').append(paw);
            paw.on('mousedown', (e) => {
                e.stopPropagation(); $('#cat-drag-paw').remove();
                const trans = prompt(`'${sel}'의 번역어(고유명사)를 입력하세요:`);
                if(trans) {
                    settings.dictionary += (settings.dictionary ? '\n' : '') + `${sel} = ${trans}`;
                    $('#ct-dictionary').val(settings.dictionary); saveSettings();
                    catNotify("사전 등록 완료! 🐾");
                }
            });
        }
    }, 10);
});
document.addEventListener('mousedown', (e) => { if(!$(e.target).is('#cat-drag-paw')) $('#cat-drag-paw').remove(); });

// ⚙️ 10. 설정창 UI
function saveSettings() {
    settings.customKey = $('#ct-key').val();
    settings.directModel = $('#ct-model').val();
    settings.stylePreset = $('#ct-preset').val();
    settings.userPrompt = $('#ct-user-prompt').val();
    settings.dictionary = $('#ct-dictionary').val();
    settings.temperature = $('#ct-temp').val();
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
    updateThemeUI();
}

function setupUI() {
    if ($('#cat-drawer-container').length) return;
    const ui = `
    <div id="cat-drawer-container" class="inline-drawer cat-native-font">
        <div id="cat-drawer-header" class="inline-drawer-header interactable">
            <div style="display:flex; gap:10px; align-items:center; font-size:1.1em; font-weight:bold;"><span id="cat-drawer-title-icon"></span> 트랜스레이터 Beta</div>
            <i class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
        </div>
        <div class="inline-drawer-content" style="display:none; padding:15px; background:rgba(0,0,0,0.1);">
            <div class="cat-setting-row">
                <label>API Key (Gemini)</label>
                <input type="password" id="ct-key" class="cat-text-input" value="${settings.customKey}">
                <i class="cat-paw-toggle fa-solid fa-paw" title="키 확인/숨기기" onclick="const i=$('#ct-key'); i.attr('type', i.attr('type')==='password'?'text':'password'); $(this).css('color', i.attr('type')==='text'?'var(--cat-main)':'');"></i>
            </div>
            <div class="cat-setting-row">
                <label>번역 엔진 모델</label>
                <select id="ct-model" class="cat-text-input">
                    <optgroup label="🐱 고양이 라인 (가성비 & 스피드)">
                        <option value="gemini-1.5-flash" ${settings.directModel==='gemini-1.5-flash'?'selected':''}>Gemini 1.5 Flash</option>
                        <option value="gemini-2.0-flash" ${settings.directModel==='gemini-2.0-flash'?'selected':''}>Gemini 2.0 Flash</option>
                    </optgroup>
                    <optgroup label="🐯 호랑이 라인 (압도적 성능 & RP)">
                        <option value="gemini-1.5-pro" ${settings.directModel==='gemini-1.5-pro'?'selected':''}>Gemini 1.5 Pro</option>
                        <option value="gemini-2.0-pro-exp-02-05" ${settings.directModel.includes('pro-exp')?'selected':''}>Gemini 2.0 Pro Exp</option>
                    </optgroup>
                </select>
            </div>
            <div class="cat-setting-row" style="display:flex; gap:10px;">
                <div style="flex:1;"><label>스타일 프리셋</label><select id="ct-preset" class="cat-text-input">
                    <option value="normal" ${settings.stylePreset==='normal'?'selected':''}>일반 (정확한 번역)</option>
                    <option value="novel" ${settings.stylePreset==='novel'?'selected':''}>소설 (문학적 묘사)</option>
                    <option value="rp" ${settings.stylePreset==='rp'?'selected':''}>캐주얼 (RP 캐릭터 톤)</option>
                </select></div>
                <div style="flex:1;"><label>온도 (Temp)</label><input type="number" id="ct-temp" class="cat-text-input" value="${settings.temperature}" step="0.1" min="0" max="1"></div>
            </div>
            <div class="cat-setting-row">
                <label>시스템 보호막 🔒 (수정 불가)</label>
                <textarea class="cat-text-input cat-readonly-shield" rows="2" readonly>${SYSTEM_SHIELD}</textarea>
            </div>
            <div class="cat-setting-row">
                <label>사용자 프롬프트 (추가 지시)</label>
                <textarea id="ct-user-prompt" class="cat-text-input" rows="2" placeholder="예: 무조건 반말로 번역해줘">${settings.userPrompt}</textarea>
            </div>
            <div class="cat-setting-row">
                <label>사전 (원문 = 번역어) 🐾 드래그로 추가 가능</label>
                <textarea id="ct-dictionary" class="cat-text-input" rows="3">${settings.dictionary}</textarea>
            </div>
            <button id="cat-save-btn" style="width:100%; padding:10px; background:transparent; border:1px solid var(--cat-main); color:var(--cat-main); border-radius:6px; font-weight:bold; cursor:pointer;">설정 저장 및 동기화</button>
        </div>
    </div>`;
    $('#extensions_settings').append(ui);
    $('#cat-drawer-header').on('click', function() { $(this).next().slideToggle(); $(this).find('i').toggleClass('fa-chevron-up'); });
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("저장 완료! 테마가 동기화되었습니다."); });
}

// 🚀 화면이 전부 그려진 다음에 안전하게 옵저버 실행!
jQuery(() => {
    setupUI();
    setInterval(injectButtons, 1000); 
    
    // 채팅창이 존재하는지 확인 후 감시 시작
    const chatBox = document.getElementById('chat');
    if (chatBox) {
        const observer = new MutationObserver(() => injectButtons());
        observer.observe(chatBox, { childList: true, subtree: true });
    }
});
