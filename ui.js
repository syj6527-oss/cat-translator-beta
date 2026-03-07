// =============================================
// 🐱 캣 트랜스레이터 v19.0 - ui.js
// 설정창 UI 생성, 팝업 알림, 버튼 주입 로직
// =============================================

import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { CORE_DEFENSE, STYLE_PRESETS }    from './translator.js';

const extName  = "cat-translator";
const stContext = getContext();

// ── 🚨 팝업 알림 ──────────────────────────────
// type: 'success'(초록) / 'warning'(노랑) / 'danger'(빨강)
export function catNotify(msg, type = 'success') {
    $('.cat-notification').remove();
    let bgColor = '#2ecc71';
    if (type === 'warning') bgColor = '#f1c40f';
    if (type === 'danger')  bgColor = '#e74c3c';
    const el = $(`<div class="cat-notification cat-native-font" style="background-color:${bgColor};">${msg}</div>`);
    $('body').append(el);
    setTimeout(() => el.addClass('show'), 50);
    setTimeout(() => { el.removeClass('show'); setTimeout(() => el.remove(), 500); }, 3000);
}

// ── 설정 저장 ────────────────────────────────
// settings 객체를 UI 값으로 업데이트 후 실리태번에 저장
export function saveSettings(settings) {
    settings.customKey      = $('#ct-key').val();
    settings.modelId        = $('#ct-model').val();
    settings.autoMode       = $('#ct-auto').val();
    settings.targetLang     = $('#ct-lang').val();
    settings.temperature    = parseFloat($('#ct-temp').val())  || 0.1;
    settings.maxTokens      = parseInt($('#ct-tokens').val())  || 0;
    settings.styleKey       = $('#ct-style').val();
    // 스타일 키에 맞는 프리셋 프롬프트 자동 적용
    settings.stylePrompt    = STYLE_PRESETS[settings.styleKey] || STYLE_PRESETS.normal;
    settings.dictionaryText = $('#ct-dict').val();
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// ── 👁️ 채팅 메시지 버튼 주입 ─────────────────
// 아직 버튼이 없는 메시지에만 🐱 번역/복구 버튼을 붙임
// onTranslate, onRevert: main.js에서 넘겨주는 핸들러 함수
export function injectButtons(settings, onTranslate, onRevert) {
    $('.mes:not(:has(.cat-msg-btns))').each(function() {
        const id     = $(this).attr('mesid');
        const isUser = $(this).attr('is_user') === 'true';
        const group  = $(`
            <div class="cat-msg-btns">
                <span class="cat-btn-trans" title="번역 / 리트라이">🐱</span>
                <span class="cat-btn-revert fa-solid fa-rotate-left" title="원문 복구"></span>
            </div>
        `);
        $(this).find('.name_text').first().append(group);

        group.find('.cat-btn-trans').on('click', () => onTranslate(id));
        group.find('.cat-btn-revert').on('click', () => onRevert(id));

        // 자동 번역 모드 처리
        if (settings.autoMode !== 'off' && !$(this).hasClass('cat-auto-checked')) {
            $(this).addClass('cat-auto-checked');
            const m = stContext.chat[id];
            if (m && !m.extra?.display_text) {
                const shouldAuto =
                    (settings.autoMode === 'input'  &&  isUser) ||
                    (settings.autoMode === 'output' && !isUser) ||
                    (settings.autoMode === 'both');
                if (shouldAuto) setTimeout(() => onTranslate(id), 500);
            }
        }
    });

    // 입력창 버튼 (없을 때만 생성)
    if ($('#cat-input-container').length === 0 && $('#send_but').length > 0) {
        const inputContainer = $(`
            <div id="cat-input-container">
                <span id="cat-input-trans" title="입력창 번역">🐱</span>
                <span id="cat-input-revert" class="fa-solid fa-rotate-left" title="원문 복구"></span>
            </div>
        `);
        $('#send_but').before(inputContainer);
        // 클릭 이벤트는 main.js에서 연결 (한 번만 등록)
    }
}

// ── 🎛️ 설정창 UI 생성 ────────────────────────
// settings:   현재 설정 객체
// onSave:     저장 버튼 클릭 핸들러
// onBatch:    전체 번역 시작 핸들러
// onAbort:    번역 중단 핸들러
// onClear:    기록 삭제 핸들러
export function setupUI(settings, { onSave, onBatch, onAbort, onClear }) {
    if ($('#cat-trans-container').length) return; // 중복 생성 방지

    // ── 실리태번 프리필 목록 동적 로드 ──
    // 사용자가 실리태번에 세팅해놓은 프리필을 불러와서 드롭다운에 표시
    const profiles = extension_settings?.connectionManager?.profiles || [];
    let profileOptions = `<option value="direct" ${settings.modelId==='direct'?'selected':''}>⚡ 직접 연결 모드 (API Key 사용)</option>`;
    profiles.forEach(p => {
        profileOptions += `<option value="${p.id}" ${settings.modelId===p.id?'selected':''}>${p.name}</option>`;
    });

    const html = `
    <div id="cat-trans-container" class="inline-drawer cat-native-font">

        <!-- 헤더: 실리태번 네이티브 스타일과 동기화 -->
        <div id="cat-drawer-header" class="inline-drawer-header interactable" tabindex="0">
            <div class="inline-drawer-title cat-native-font">
                🐱 트랜스레이터 <small style="opacity:0.5; font-size:0.7em;">v19.0</small>
            </div>
            <i class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
        </div>

        <!-- 내용 -->
        <div id="cat-drawer-content" class="inline-drawer-content" style="display:none; padding:10px;">

            <!-- 연결 프리필 선택 -->
            <div class="cat-field">
                <label>연결 프리필</label>
                <select id="ct-model" class="text_pole cat-native-font">
                    ${profileOptions}
                </select>
            </div>

            <!-- 직접 연결 모드일 때만 표시되는 API 키 입력 -->
            <div class="cat-field" id="ct-direct-mode" style="display:${settings.modelId==='direct'?'block':'none'};">
                <label>API Key</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="password" id="ct-key" class="text_pole cat-native-font"
                           value="${settings.customKey}" style="flex:1;">
                    <span id="ct-key-toggle" style="cursor:pointer;" title="보이기/숨기기">🐾</span>
                </div>
            </div>

            <!-- 자동 모드 -->
            <div class="cat-field">
                <label>자동 번역 모드</label>
                <select id="ct-auto" class="text_pole cat-native-font">
                    <option value="off"    ${settings.autoMode==='off'?'selected':''}>꺼짐</option>
                    <option value="input"  ${settings.autoMode==='input'?'selected':''}>입력만</option>
                    <option value="output" ${settings.autoMode==='output'?'selected':''}>출력만</option>
                    <option value="both"   ${settings.autoMode==='both'?'selected':''}>둘 다</option>
                </select>
            </div>

            <!-- 목표 언어 -->
            <div class="cat-field">
                <label>목표 언어</label>
                <select id="ct-lang" class="text_pole cat-native-font">
                    <option value="Korean"   ${settings.targetLang==='Korean'?'selected':''}>Korean</option>
                    <option value="English"  ${settings.targetLang==='English'?'selected':''}>English</option>
                    <option value="Japanese" ${settings.targetLang==='Japanese'?'selected':''}>Japanese</option>
                    <option value="Chinese"  ${settings.targetLang==='Chinese'?'selected':''}>Chinese</option>
                    <option value="German"   ${settings.targetLang==='German'?'selected':''}>German</option>
                    <option value="Russian"  ${settings.targetLang==='Russian'?'selected':''}>Russian</option>
                    <option value="French"   ${settings.targetLang==='French'?'selected':''}>French</option>
                </select>
            </div>

            <!-- 번역 스타일 -->
            <div class="cat-field">
                <label>번역 스타일 🎨</label>
                <select id="ct-style" class="text_pole cat-native-font">
                    <option value="normal" ${settings.styleKey==='normal'?'selected':''}>📝 일반 (정확한 직역)</option>
                    <option value="novel"  ${settings.styleKey==='novel'?'selected':''}>📖 소설 (문학적 감성)</option>
                    <option value="casual" ${settings.styleKey==='casual'?'selected':''}>💬 캐주얼 (구어체)</option>
                </select>
            </div>

            <!-- 온도 & 토큰 -->
            <div class="cat-field" style="display:flex; gap:10px;">
                <div style="flex:1;">
                    <label>온도 (Temp)</label>
                    <input type="number" id="ct-temp" class="text_pole cat-native-font"
                           step="0.1" min="0" max="1" value="${settings.temperature}">
                </div>
                <div style="flex:1;">
                    <label>토큰 (0=Auto)</label>
                    <input type="number" id="ct-tokens" class="text_pole cat-native-font"
                           min="0" value="${settings.maxTokens}">
                </div>
            </div>

            <!-- 사전 -->
            <div class="cat-field">
                <label>사전 (원문=번역, 한 줄에 하나)</label>
                <textarea id="ct-dict" class="text_pole cat-native-font" rows="3"
                          placeholder="Ghost=고스트&#10;Soap=소프">${settings.dictionaryText}</textarea>
            </div>

            <!-- 절대 방어막 (읽기 전용 표시) -->
            <div class="cat-field">
                <label>시스템 방어막 🔒 (수정 불가)</label>
                <textarea class="text_pole cat-locked-textarea cat-native-font"
                          rows="3" readonly>${CORE_DEFENSE}</textarea>
            </div>

            <!-- 설정 저장 버튼 -->
            <button id="cat-save-btn" class="menu_button cat-native-font">설정 저장 🐱</button>

            <hr style="border-color:rgba(255,255,255,0.1); margin:10px 0;">

            <!-- 전체 채팅 번역 -->
            <div class="cat-field">
                <label>전체 채팅 번역 📦</label>
                <div style="display:flex; gap:5px; flex-wrap:wrap;">
                    <select id="ct-batch-count" class="text_pole cat-native-font"
                            style="flex:1; min-width:80px;">
                        <option value="10">최근 10개</option>
                        <option value="30">최근 30개</option>
                        <option value="50">최근 50개</option>
                        <option value="all">전체</option>
                    </select>
                    <button id="cat-batch-btn" class="menu_button cat-native-font"
                            style="flex:1;">번역 시작 🚀</button>
                </div>
                <!-- 진행률 바 -->
                <div id="cat-progress-wrap" style="display:none; margin-top:8px;">
                    <div id="cat-progress-bar-bg">
                        <div id="cat-progress-bar"></div>
                    </div>
                    <div id="cat-progress-label">0 / 0</div>
                </div>
            </div>

            <!-- 번역 중단 버튼 (배치 번역 중에만 표시됨) -->
            <button id="cat-abort-btn" class="menu_button cat-native-font"
                    style="display:none;">🛑 번역 중단</button>

            <!-- 번역 기록 전체 삭제 -->
            <button id="cat-clear-btn" class="menu_button cat-native-font">🗑️ 번역 기록 전체 삭제</button>

            <div style="font-size:0.7em; opacity:0.3; text-align:center; margin-top:8px;"
                 class="cat-native-font">v19.0 — cat-translator</div>
        </div>
    </div>`;

    $('#extensions_settings').append(html);

    // ── 이벤트 바인딩 ──

    // 헤더 클릭 → 드로어 열기/닫기 (fa-chevron 토글 = 실리태번 네이티브 방식)
    $('#cat-drawer-header').on('click', function() {
        $('#cat-drawer-content').slideToggle(200);
        $(this).find('.inline-drawer-toggle').toggleClass('fa-chevron-down fa-chevron-up');
    });

    // API 키 보이기/숨기기 토글
    $('#ct-key-toggle').on('click', () => {
        const k = $('#ct-key');
        k.attr('type', k.attr('type') === 'password' ? 'text' : 'password');
    });

    // 프리필 선택 변경 시 직접연결 영역 토글
    // 'direct' 선택 시 API Key 입력창 표시, 프리필 선택 시 숨김
    $('#ct-model').on('change', function() {
        $('#ct-direct-mode').toggle($(this).val() === 'direct');
    });

    // 버튼 이벤트 → main.js에서 넘겨받은 핸들러 연결
    $('#cat-save-btn').on('click',  () => { onSave(); catNotify("🐱 설정 저장 완료!"); });
    $('#cat-batch-btn').on('click', () => {
        const val = $('#ct-batch-count').val();
        onBatch(val === 'all' ? 'all' : parseInt(val));
    });
    $('#cat-abort-btn').on('click', onAbort);
    $('#cat-clear-btn').on('click', onClear);
}

// ── 배치 번역 진행률 업데이트 ────────────────
export function updateProgress(done, total) {
    const pct = Math.round((done / total) * 100);
    $('#cat-progress-bar').css('width', pct + '%');
    $('#cat-progress-label').text(`${done} / ${total} (${pct}%)`);
}

// ── 배치 번역 UI 상태 전환 ───────────────────
// active: true면 "번역 중" 상태, false면 "대기" 상태
export function setBatchUIState(active) {
    $('#cat-batch-btn').prop('disabled', active);
    $('#cat-abort-btn').toggle(active);
    $('#cat-progress-wrap').toggle(active);
    if (!active) {
        // 완료 후 2초 뒤 진행률 바 숨김
        setTimeout(() => {
            $('#cat-progress-wrap').hide();
            $('#cat-progress-bar').css('width', '0%');
        }, 2000);
    }
}
