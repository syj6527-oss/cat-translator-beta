// =============================================
// 🐱 캣 트랜스레이터 v19.0 - main.js
// 진입점: 모든 모듈을 가져와서 조합하는 컨트롤러
// =============================================

import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { initDB, dbClearAll }             from './cache.js';
import { translateText }                  from './translator.js';
import { setupQuickAdd }                  from './dictionary.js';
import {
    catNotify,
    saveSettings,
    injectButtons,
    setupUI,
    updateProgress,
    setBatchUIState
} from './ui.js';
import { STYLE_PRESETS } from './translator.js';

// ── 상수 ──────────────────────────────────────
const extName   = "cat-translator";
const stContext = getContext();

// ── 전역 상태 ──────────────────────────────────
let abortFlag         = false; // 🛑 배치 번역 중단 플래그
let originalInputText = "";    // 입력창 원문 복구용

// ── 기본 설정값 ───────────────────────────────
const defaultSettings = {
    customKey:      '',                   // Gemini API 키
    modelId:        'st-profile',         // AI 모델 (기본: 실리태번 프리필 연동)
    autoMode:       'off',                // 자동 번역 모드
    targetLang:     'Korean',             // 번역 목표 언어
    temperature:    0.1,                  // 온도 (0~1)
    maxTokens:      0,                    // 최대 토큰 (0이면 8192 자동)
    styleKey:       'normal',             // 번역 스타일 키
    stylePrompt:    STYLE_PRESETS.normal, // 현재 적용된 스타일 프롬프트
    dictionaryText: 'Ghost=고스트\nSoap=소프\nKönig=코니그' // 기본 사전
};

// 저장된 설정 불러오기 (없으면 기본값 사용)
let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

// ── 💬 메시지 번역 핸들러 ─────────────────────
// id: 메시지 인덱스
async function handleChatTranslate(id) {
    const msg = stContext.chat[id];
    if (!msg) return;

    const mesBlock = $(`.mes[mesid="${id}"]`);
    const isRetry  = !!msg.extra?.display_text; // 이미 번역된 메시지면 재번역
    mesBlock.find('.cat-btn-trans').addClass('cat-glow-active');

    const original = msg.extra?.original_mes || msg.mes;
    const result   = await translateText(original, isRetry, settings);

    if (result) {
        if (!msg.extra) msg.extra = {};
        msg.extra.original_mes = original;
        msg.extra.display_text = result;
        stContext.updateMessageBlock(id, msg);
    }
    mesBlock.find('.cat-btn-trans').removeClass('cat-glow-active');
}

// ── 🔙 메시지 번역 복구 핸들러 ───────────────
function handleChatRevert(id) {
    const msg = stContext.chat[id];
    if (!msg) return;
    if (msg.extra?.display_text)  delete msg.extra.display_text;
    if (msg.extra?.original_mes)  {
        msg.mes = msg.extra.original_mes;
        delete msg.extra.original_mes;
    }
    stContext.updateMessageBlock(id, msg);
    catNotify("🐱 원문 복구 완료!", "success");
}

// ── 📦 전체 채팅 번역 (배치) ──────────────────
// count: 번역할 메시지 수 ('all' | 10 | 30 | 50)
async function handleBatchTranslate(count) {
    const chat = stContext.chat;
    if (!chat || chat.length === 0) {
        catNotify("🐱 번역할 채팅이 없어요!", "warning");
        return;
    }

    // 번역 범위 결정
    const total  = chat.length;
    const start  = count === 'all' ? 0 : Math.max(0, total - count);

    // 아직 번역 안 된 메시지만 추림
    const targets = [];
    for (let i = start; i < total; i++) {
        if (!chat[i].extra?.display_text) targets.push(i);
    }

    if (targets.length === 0) {
        catNotify("🐱 번역할 메시지가 없어요! (이미 다 번역됨)", "warning");
        return;
    }

    // UI를 "번역 중" 상태로 전환
    abortFlag = false;
    setBatchUIState(true);
    catNotify(`🐱 전체 번역 시작! (${targets.length}개)`, "success");

    let done = 0;

    for (const id of targets) {
        // 🛑 중단 플래그 확인
        if (abortFlag) {
            catNotify("🛑 번역이 중단되었습니다.", "warning");
            break;
        }

        await handleChatTranslate(id);
        done++;
        updateProgress(done, targets.length); // 진행률 바 업데이트
    }

    // UI를 "대기" 상태로 복원
    setBatchUIState(false);
    if (!abortFlag) catNotify(`🎉 전체 번역 완료! (${done}개)`, "success");
}

// ── 🛑 번역 중단 핸들러 ───────────────────────
function handleAbort() {
    abortFlag = true;
    catNotify("🛑 번역 중단 요청됨...", "warning");
}

// ── 🗑️ 번역 기록 전체 삭제 핸들러 ────────────
async function handleClearAll() {
    const confirmed = confirm(
        "⚠️ 모든 번역 기록(캐시 + 채팅 표시)을 삭제할까요?\n이 작업은 되돌릴 수 없어요!"
    );
    if (!confirmed) return;

    // ① IndexedDB 캐시 삭제
    await dbClearAll();

    // ② 채팅에서 번역 표시 제거 → 원문 복원
    stContext.chat.forEach((msg, id) => {
        if (msg.extra?.display_text) {
            delete msg.extra.display_text;
            if (msg.extra?.original_mes) {
                msg.mes = msg.extra.original_mes;
                delete msg.extra.original_mes;
            }
            stContext.updateMessageBlock(id, msg);
        }
    });

    catNotify("🗑️ 번역 기록이 모두 삭제되었습니다!", "success");
}

// ── ✍️ 입력창 번역 핸들러 ────────────────────
async function handleInputTranslate() {
    const inputArea = $('#send_textarea');
    const text = inputArea.val();
    if (!text) return;

    $('#cat-input-trans').addClass('cat-glow-active');
    originalInputText = text; // 원문 보관

    const result = await translateText(text, false, settings);
    if (result) inputArea.val(result).trigger('input');

    $('#cat-input-trans').removeClass('cat-glow-active');
}

// ── 🔙 입력창 원문 복구 핸들러 ───────────────
function handleInputRevert() {
    if (originalInputText) {
        $('#send_textarea').val(originalInputText).trigger('input');
        originalInputText = "";
        catNotify("🐱 원문 복구 완료!", "success");
    }
}

// ── 버튼 주입 래퍼 ───────────────────────────
// ui.js의 injectButtons에 핸들러를 바인딩해서 호출
function runInjectButtons() {
    injectButtons(settings, handleChatTranslate, handleChatRevert);

    // 입력창 버튼 이벤트 (없을 때만 등록)
    if ($('#cat-input-trans').length && !$('#cat-input-trans').data('bound')) {
        $('#cat-input-trans').on('click', handleInputTranslate).data('bound', true);
        $('#cat-input-revert').on('click', handleInputRevert).data('bound', true);
    }
}

// ── 🏁 진입점 ─────────────────────────────────
jQuery(async () => {
    // ① IndexedDB 캐시 초기화
    await initDB();

    // ② 설정창 UI 생성 (핸들러 주입)
    setupUI(settings, {
        onSave:  () => saveSettings(settings),
        onBatch: handleBatchTranslate,
        onAbort: handleAbort,
        onClear: handleClearAll
    });

    // ③ 채팅 버튼 초기 주입
    runInjectButtons();

    // ④ 드래그 사전 즉시 등록 기능 활성화
    setupQuickAdd(settings);

    // ⑤ MutationObserver: 새 메시지가 DOM에 추가될 때마다 버튼 자동 주입
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        new MutationObserver(() => runInjectButtons())
            .observe(chatEl, { childList: true, subtree: true });
    }

    // ⑥ 폴백: 0.25초마다 버튼 체크 (모바일 및 동적 렌더링 대응)
    setInterval(runInjectButtons, 250);
});
