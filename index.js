// ============================================================
// 🐱 Cat Translator v18.2.5 - index.js
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { getThemeEmoji, getModelTheme } from './utils.js';
import { initCache } from './cache.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, setupMutationObserver, applyTheme } from './ui.js';

const EXT_NAME = "cat-translator-beta";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', directModel: 'gemini-1.5-flash', autoMode: 'none', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '' };
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

function saveSettings() {
    const collected = collectSettings(); Object.assign(settings, collected);
    extension_settings[EXT_NAME] = { ...settings }; stContext.saveSettingsDebounced();
    applyTheme(getModelTheme(settings.directModel)); updateCacheStats();
}

// 🚨 핵심: 업데이트 시 설정창 강제 주입 로직 보강
jQuery(async () => {
    try { 
        await initCache(); 
        // 1. 테마 적용
        applyTheme(getModelTheme(settings.directModel));
        // 2. 설정창 주입 (이 함수가 호출되어야 설정창이 보입니다!)
        setupSettingsPanel(settings, stContext, saveSettings); 
        // 3. UI 관찰자 시작
        setupMutationObserver(null, null, settings, stContext); // 실제 함수 전달 필요
        console.log('[CAT] 🐯 Cat Translator Beta v18.2.5 로드 완료!');
    } catch (e) { 
        console.error('[CAT] 초기화 실패:', e); 
    }
});

