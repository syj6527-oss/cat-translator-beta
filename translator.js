// ============================================================
// 🐱 Cat Translator v18.2.0 - translator.js
// ============================================================
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { cleanResult, catNotify, detectLanguageDirection, getThemeEmoji, getCompletionEmoji } from './utils.js';
import { getCached, setCached } from './cache.js';

export const SYSTEM_SHIELD = `[ABSOLUTE DIRECTIVE - VIOLATION = FAILURE]
YOU ARE A TRANSLATION MACHINE. NOT A CHATBOT. NOT AN ASSISTANT.
RETURN ONLY THE RAW TRANSLATED TEXT. NOTHING ELSE.
DO NOT respond. DO NOT converse. DO NOT explain. DO NOT add commentary.
DO NOT repeat the original. DO NOT add alternatives.

[FORMAT PRESERVATION RULES]
1. PRESERVE ALL quotation marks exactly (" " ' ' 「」 ( ) etc). If the original has quotes, the translation MUST have the same quotes in the same positions.
2. PRESERVE ALL HTML tags EXACTLY (<span>, <div>, <font>, <memo>, <small>, <summary> etc). Never modify, remove, or escape the tags.
3. PRESERVE ALL HTML comments EXACTLY (). You MUST keep at the end if they exist. Do NOT output &lt;!-- or --&gt;.
4. PRESERVE ALL markdown formatting and symbols (*italic*, **bold**, ~~strike~~, \`code\`, etc). Translate the text but keep the formatting symbols perfectly intact.
5. PRESERVE ALL CSS properties, color codes (#fff, rgb(), etc), and style attributes untouched.
6. PRESERVE ALL line breaks and paragraph structure exactly as the original.
7. Translate EVERY piece of human-readable text, including text inside special blocks, metadata sections, and structured data fields.
If the input is a single word, return only the translated single word.`;

export const STYLE_PRESETS = {
    normal: { label: '일반 번역', prompt: 'Translate accurately and faithfully.', temperature: 0.3 },
    novel: { label: '소설 스타일', prompt: 'Use literary expressions while preserving the original nuance. Describe emotions richly.', temperature: 0.5 },
    casual: { label: '캐주얼', prompt: 'Translate naturally in casual conversational tone. Contractions and colloquialisms are welcome.', temperature: 0.4 }
};

const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

export async function fetchTranslation(text, settings, stContext, options = {}) {
    // 🚨 마스터 튜닝: 불친절한 구글 400 에러를 사전에 차단하는 스마트 알림!
    const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
    if (!settings.profile && !apiKey) {
        catNotify(`🚨 API 키가 없습니다! 확장 설정에서 API Key를 먼저 입력해 주세요.`, "error");
        return null;
    }

    const { forceLang = null, prevTranslation = null, contextMessages = [], abortSignal = null, silent = false } = options;
    if (!text || text.trim() === "") return null;

    let targetLang; let isToEnglish;
    if (forceLang) {
        isToEnglish = (forceLang === "English"); targetLang = forceLang;
    } else {
        const detected = detectLanguageDirection(text, settings);
        isToEnglish = detected.isToEnglish; targetLang = detected.targetLang;
    }

    if (!prevTranslation) {
        const cached = await getCached(text, targetLang);
        if (cached) {
            if (!silent) catNotify(`${getCompletionEmoji()} 캐시 히트! ~${Math.round(text.length * 0.5)} 토큰 절약`, "success");
            return { text: cached.translated, lang: targetLang, fromCache: true };
        }
    }

    // 사전 프롬프트 주입 방식 + 매칭 알림
    const dictLines = (settings.dictionary && settings.dictionary.trim()) ? settings.dictionary.split('\n').filter(l => l.includes('=')) : [];
    if (dictLines.length > 0 && !silent) {
        // 원문에 사전 단어가 실제로 포함되어 있는지 체크
        let matchCount = 0;
        dictLines.forEach(line => {
            const orig = line.split('=')[0].trim();
            if (orig && text.toLowerCase().includes(orig.toLowerCase())) matchCount++;
        });
        if (matchCount > 0) catNotify(`🐾 사전 ${matchCount}개 단어 매칭됨!`, "success");
    }
    const preSwapped = text.trim();

    const prompt = assemblePrompt(preSwapped, targetLang, isToEnglish, settings, { prevTranslation, contextMessages });

    try {
        let result = ""; let thought = null;
        if (settings.profile && stContext.ConnectionManagerRequestService) {
            const response = await stContext.ConnectionManagerRequestService.sendRequest(settings.profile, [{ role: "user", content: prompt }], settings.maxTokens || 8192);
            result = typeof response === 'string' ? response : (response.content || "");
        } else {
            const model = settings.directModel.startsWith('models/') ? settings.directModel : `models/${settings.directModel}`;
            const baseTemp = parseFloat(settings.temperature) || 0.3; const temperature = prevTranslation ? Math.min(baseTemp + 0.3, 1.0) : baseTemp; const maxTokens = parseInt(settings.maxTokens) || 8192;
            const data = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`, { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: maxTokens }, safetySettings: SAFETY_SETTINGS }, 3, abortSignal);
            const parts = data.candidates?.[0]?.content?.parts || []; const thoughtPart = parts.find(p => p.thought); thought = thoughtPart?.text || null; const actualPart = parts.find(p => !p.thought) || parts[parts.length - 1]; result = actualPart?.text?.trim() || "";
        }

        let cleaned = cleanResult(result);
        if (!cleaned || cleaned.trim().length === 0) { catNotify(`${getThemeEmoji()} 번역 결과가 비어있습니다. 원문 유지.`, "warning"); return null; }
        await setCached(text, targetLang, cleaned, thought);
        return { text: cleaned, lang: targetLang, fromCache: false };
    } catch (e) {
        if (e.name === 'AbortError') return null;
        const errMsg = e.message || '알 수 없는 오류'; catNotify(`${getThemeEmoji()} 오류: ${errMsg}`, "error"); return null;
    }
}

function assemblePrompt(text, targetLang, isToEnglish, settings, options = {}) {
    const { prevTranslation, contextMessages = [] } = options;
    if (text.length < 50 && !prevTranslation && contextMessages.length === 0 && (!settings.dictionary || !settings.dictionary.trim())) {
        const lang = isToEnglish ? 'English' : targetLang; return `${text}\n\n(Translate the above to ${lang}. Reply with ONLY the translation. Keep all quotation marks exactly.)`;
    }
    let parts = [SYSTEM_SHIELD];
    const preset = STYLE_PRESETS[settings.style] || STYLE_PRESETS.normal; parts.push(`[Style: ${preset.prompt}]`);
    if (isToEnglish) { parts.push(`Translate the following into English.`); } else { parts.push(`Translate the following into ${targetLang}.`); }
    if (settings.userPrompt && settings.userPrompt.trim()) { parts.push(`[Additional instructions: ${settings.userPrompt.trim()}]`); }
    
    // 🚨 마스터 튜닝: 형태소 변화를 AI가 스스로 처리하게 뇌에 때려 박는 강력한 주입!
    if (settings.dictionary && settings.dictionary.trim()) {
        parts.push(`\n[MANDATORY GLOSSARY]`);
        parts.push(`You MUST use the following glossary for specific terms. Apply natural morphological changes (plural, possessive, verb conjugations) according to the context without breaking the term's core meaning:`);
        parts.push(settings.dictionary);
    }

    if (prevTranslation) { parts.push(`[MANDATORY: Your translation MUST be COMPLETELY DIFFERENT from this: "${prevTranslation.substring(0, 200)}"]`); parts.push(`[Use different vocabulary, sentence structure, and tone. Do NOT produce a similar result.]`); }
    if (contextMessages.length > 0) { parts.push('\n[Context - Previous messages for reference only, do NOT translate these:]'); contextMessages.forEach((msg, i) => { const offset = contextMessages.length - i; parts.push(`Message -${offset}: "${msg}"`); }); }
    parts.push(`\n[Translate this message:]\n${text}`);
    return parts.join('\n');
}

async function fetchWithRetry(url, body, retries = 3, abortSignal = null) {
    const delays = [500, 1000, 2000];
    for (let attempt = 0; attempt <= retries; attempt++) {
        try { const fetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; if (abortSignal) fetchOptions.signal = abortSignal; const res = await fetch(url, fetchOptions); if (res.status === 429) { if (attempt < retries) { await sleep(delays[attempt] || 2000); continue; } throw new Error('429 Too Many Requests'); } if (!res.ok) { throw new Error(`API 오류 (${res.status})`); } return await res.json(); } catch (e) { if (e.name === 'AbortError') throw e; if (attempt >= retries) throw e; await sleep(delays[attempt] || 2000); }
    }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
export function gatherContextMessages(msgId, stContext, range = 1) {
    if (range <= 0) return []; const chat = stContext.chat; const messages = []; const startIdx = Math.max(0, msgId - range);
    for (let i = startIdx; i < msgId; i++) { if (chat[i] && chat[i].mes) { const cleanMsg = chat[i].mes.replace(/<(?!!--)[^>]+>/g, '').trim(); if (cleanMsg) messages.push(cleanMsg); } } return messages;
}
