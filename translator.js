// ============================================================
// 🐱 Translator v1.0.3 - translator.js
// ============================================================
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { cleanResult, catNotify, detectLanguageDirection, getThemeEmoji, getCompletionEmoji, getCacheModelKey, applyPreReplaceWithCount } from './utils.js';
import { getCached, setCached } from './cache.js';

export const SYSTEM_SHIELD = `[ABSOLUTE DIRECTIVE - VIOLATION = FAILURE]
YOU ARE A FEARLESS TRANSLATION MACHINE. NOT A CHATBOT. NOT AN ASSISTANT.
RETURN ONLY THE RAW TRANSLATED TEXT. NOTHING ELSE.
DO NOT respond. DO NOT converse. DO NOT explain. DO NOT add commentary.
DO NOT repeat the original. DO NOT output alternatives.

[FEARLESS TRANSLATION RULES]
The text WILL contain complex formatting: HTML tags, Markdown, code blocks, YAML, special brackets.
DO NOT PANIC. DO NOT skip any section just because it looks complicated.
TRANSLATE EVERY piece of human-readable text fearlessly!

[FORMAT PRESERVATION]
1. TRANSLATE THE WORDS inside all tags, blocks, and brackets. Never leave readable text untranslated.
2. KEEP THE SYMBOLS. Preserve all HTML tags (<memo>, <div>, <small>, <pre>, <code>), code block markers (\`\`\`yaml, \`\`\`), brackets (『』, <>), and markdown (*bold*, _italic_) in their exact original positions.
3. HTML COMMENTS (<!-- -->): TRANSLATE the human-readable text INSIDE comments. Keep the <!-- --> markers but translate the content between them. These often contain character profiles, status info, and story data that MUST be translated.
4. PRESERVE spacing, indentation, and line breaks exactly. This is critical for YAML and structured blocks.
5. PRESERVE ALL CSS properties, color codes (#fff, rgb), classes, and style attributes untouched.
6. PRESERVE ALL quotation marks ("" '' 「」) in the same positions.

[EXAMPLES]
Source: 『Condition: Sleeping peacefully』
Correct: 『Condition: 평화롭게 수면 중』
Source: \`\`\`yaml\\n- mood: "cheerful"\\n- action: "reading a book"\\n\`\`\`
Correct: \`\`\`yaml\\n- mood: "기분 좋음"\\n- action: "책을 읽고 있다"\\n\`\`\`
Source: <div class="box">- She sighs deeply.</div>
Correct: <div class="box">- 그녀가 깊이 한숨을 쉰다.</div>
Source: <!-- [Character Profiles]\\nDesires: To protect her forest.\\n-->
Correct: <!-- [Character Profiles]\\nDesires: 그녀의 숲을 지키는 것.\\n-->

If the input is a single word, return only the translated single word.

[REGEX TRIGGER PRESERVATION]
Some text uses special patterns as UI triggers for info boxes, status panels, etc.
KEEP these trigger patterns EXACTLY as-is — do NOT translate the structural keywords:
- {{keyword:...}} patterns: translate content inside but keep {{keyword:}} wrapper
- Bracket patterns like [Status], [Info], [Scene]: keep the keyword in English
- Special brackets 『...』, 【...】: keep the bracket style, translate content inside
- Any pattern that looks like a UI/system tag: preserve it unchanged

Output ONLY the final translated text.`;

export const STYLE_PRESETS = {
    normal: { label: '일반 번역', prompt: 'Translate accurately and faithfully.', temperature: 0.3 },
    novel: { label: '소설 스타일', prompt: 'Use literary expressions while preserving the original nuance. Describe emotions richly.', temperature: 0.5 },
    casual: { label: '캐주얼', prompt: 'Translate naturally in casual conversational tone. Contractions and colloquialisms are welcome.', temperature: 0.4 },
    natural: { label: '번역체 탈피', prompt: 'Translate into natural, native-sounding Korean. Avoid translationese. Restructure sentences to follow natural Korean word order. Never use stiff constructions like "~했다는 것을", "~에 대해서", "~하는 것은" when a more natural Korean alternative exists.', temperature: 0.4 },
    formal: { label: '존댓말 고정', prompt: 'Translate all text using formal/polite Korean speech (존댓말/합쇼체). All sentence endings must use -습니다, -합니다, -입니다 forms consistently.', temperature: 0.3 },
    informal: { label: '반말 고정', prompt: 'Translate all text using casual/informal Korean speech (반말). Use -해, -야, -지, -거든 endings. Make it sound like close friends talking.', temperature: 0.4 },
    literary: { label: '문어체', prompt: 'Use formal written/literary Korean style (문어체). Employ refined vocabulary, longer sentence structures, and elegant expressions suitable for published novels.', temperature: 0.5 }
};

const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

export async function fetchTranslation(text, settings, stContext, options = {}) {
    const isVertexModel = settings.directModel && settings.directModel.startsWith('vertex-');
    const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
    const vertexKey = settings.vertexKey || '';
    
    if (!settings.profile && !apiKey && !(isVertexModel && vertexKey)) {
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

    // 🚨 원문-목표 언어 동일 감지: 병기 모드 OFF일 때만 체크
    const bilingualActive = settings.dialogueBilingual && settings.dialogueBilingual !== 'off';
    if (!bilingualActive && !silent) {
        const korCount = (text.match(/[가-힣]/g) || []).length;
        const engCount = (text.match(/[a-zA-Z]/g) || []).length;
        const total = korCount + engCount;
        if (total > 0) {
            const korRatio = korCount / total;
            const engRatio = engCount / total;
            if (engRatio >= 0.7 && targetLang === 'English') {
                catNotify(`${getThemeEmoji()} 원문이 이미 영어입니다! 목표 언어를 확인해주세요!`, "warning");
                return null;
            }
            if (korRatio >= 0.7 && targetLang === 'Korean') {
                catNotify(`${getThemeEmoji()} 원문이 이미 한국어입니다! 목표 언어를 확인해주세요!`, "warning");
                return null;
            }
        }
    }

    if (!prevTranslation) {
        const modelKey = getCacheModelKey(settings);
        const cached = await getCached(text, targetLang, modelKey);
        if (cached) {
            if (!silent) catNotify(`${getCompletionEmoji()} 캐시 히트! ~${Math.round(text.length * 0.5)} 토큰 절약`, "success");
            return { text: cached.translated, lang: targetLang, fromCache: true };
        }
    }

    // 🚨 사전 pre-replace: API 호출 전에 고유명사 미리 치환 (프롬프트 glossary와 이중 안전망)
    const { swapped: preSwapped, matchCount: dictMatchCount } = applyPreReplaceWithCount(text.trim(), settings.dictionary, isToEnglish);
    if (dictMatchCount > 0) {
        console.log(`[CAT] 📖 사전 pre-replace: ${dictMatchCount}개 치환 완료`);
        if (!silent) catNotify(`🐾 사전 ${dictMatchCount}개 단어 치환 적용!`, "success");
    }

    const prompt = assemblePrompt(preSwapped, targetLang, isToEnglish, settings, { prevTranslation, contextMessages });

    try {
        let result = ""; let thought = null;
        if (settings.profile && stContext.ConnectionManagerRequestService) {
            // 🚨 프로필 모드: systemInstruction 미지원 → 유저 메시지에 합침
            console.log('[CAT] 🔌 프로필 모드: SYSTEM_SHIELD → user 메시지 합침');
            const fullPrompt = SYSTEM_SHIELD + '\n' + prompt;
            const response = await stContext.ConnectionManagerRequestService.sendRequest(settings.profile, [{ role: "user", content: fullPrompt }], settings.maxTokens || 8192);
            result = typeof response === 'string' ? response : (response.content || "");
        } else {
            // Vertex 모델 분기
            let actualModel = settings.directModel;
            let activeKey = apiKey;
            let url;
            
            if (isVertexModel) {
                actualModel = settings.directModel.replace('vertex-', '');
                activeKey = vertexKey || apiKey;
                const region = settings.vertexRegion || 'global';
                const project = settings.vertexProject || '';
                
                if (project && region !== 'global') {
                    // 프로젝트 ID + 리전 방식
                    url = `https://${region}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${region}/publishers/google/models/${actualModel}:generateContent`;
                } else {
                    // 글로벌 (API Key 방식)
                    const model = actualModel.startsWith('models/') ? actualModel : `models/${actualModel}`;
                    url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${activeKey}`;
                }
            } else {
                const model = actualModel.startsWith('models/') ? actualModel : `models/${actualModel}`;
                url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${activeKey}`;
            }
            
            const baseTemp = parseFloat(settings.temperature) || 0.3; const temperature = prevTranslation ? Math.min(baseTemp + 0.3, 1.0) : baseTemp; const maxTokens = parseInt(settings.maxTokens) || 8192;
            
            const fetchBody = { systemInstruction: { parts: [{ text: SYSTEM_SHIELD }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: maxTokens }, safetySettings: SAFETY_SETTINGS };
            console.log(`[CAT] 🧠 Direct 모드: systemInstruction 분리 | 모델: ${actualModel} | temp: ${temperature} | maxTokens: ${maxTokens}`);
            
            // Vertex 프로젝트 방식은 Authorization 헤더 사용
            let extraHeaders = {};
            if (isVertexModel && settings.vertexProject && (settings.vertexRegion || 'global') !== 'global') {
                extraHeaders = { 'Authorization': `Bearer ${activeKey}` };
            }
            
            const data = await fetchWithRetry(url, fetchBody, 3, abortSignal, extraHeaders);
            const parts = data.candidates?.[0]?.content?.parts || []; const thoughtPart = parts.find(p => p.thought); thought = thoughtPart?.text || null; const actualPart = parts.find(p => !p.thought) || parts[parts.length - 1]; result = actualPart?.text?.trim() || "";
        }

        let cleaned = cleanResult(result, text);
        if (!cleaned || cleaned.trim().length === 0) { catNotify(`${getThemeEmoji()} 번역 결과가 비어있습니다. 원문 유지.`, "warning"); return null; }
        await setCached(text, targetLang, cleaned, thought, getCacheModelKey(settings));
        return { text: cleaned, lang: targetLang, fromCache: false };
    } catch (e) {
        if (e.name === 'AbortError') return null;
        const errMsg = e.message || '알 수 없는 오류';
        // Vertex 모델 실패 시 프로젝트 ID/리전 입력 안내
        if (isVertexModel && !settings.vertexProject) {
            $('#ct-vertex-extra').slideDown(200);
            catNotify(`🚨 Vertex 연결 실패! 프로젝트 ID와 리전을 입력해보세요.`, "error");
        } else {
            catNotify(`${getThemeEmoji()} 오류: ${errMsg}`, "error");
        }
        return null;
    }
}

function assemblePrompt(text, targetLang, isToEnglish, settings, options = {}) {
    const { prevTranslation, contextMessages = [] } = options;
    const bilingualMode = settings.dialogueBilingual || 'off';
    
    // 🚨 병기 모드 ON이면 짧은 텍스트도 풀 프롬프트 경로 강제 사용
    if (bilingualMode === 'off' && text.length < 100 && !prevTranslation && contextMessages.length === 0 && (!settings.dictionary || !settings.dictionary.trim())) {
        const lang = isToEnglish ? 'English' : targetLang; return `${text}\n\n(Translate the above to ${lang}. Reply with ONLY the translation. Keep all formatting exactly.)`;
    }
    let parts = [];  // 🚨 SYSTEM_SHIELD는 Gemini systemInstruction으로 분리됨
    const preset = STYLE_PRESETS[settings.style] || STYLE_PRESETS.normal; parts.push(`[Style: ${preset.prompt}]`);
    
    // 🚨 병기 모드 ON이면 지문 번역 방향을 Korean으로 강제 (목표 언어 설정과 무관하게)
    if (bilingualMode !== 'off') { targetLang = 'Korean'; isToEnglish = false; }
    
    if (isToEnglish) { parts.push(`Translate the following into English.`); } else { parts.push(`Translate the following into ${targetLang}.`); }
    
    // 🚨 대사 병기 모드 프롬프트 삽입
    if (bilingualMode !== 'off') {
        const bilingualLangMap = {
            'ko-en': { srcLabel: 'English', tgtLabel: '한국어', exSrc: 'I bought a mattress for you.', exTgt: '널 위해 매트리스를 샀어.', exNarSrc: 'He clenched his jaw.', exNarTgt: '그는 이를 악물었다.' },
            'ko-ja': { srcLabel: 'Japanese', tgtLabel: '한국어', exSrc: 'あなたのためにマットレスを買ったんだ。', exTgt: '널 위해 매트리스를 샀어.', exNarSrc: '彼は歯を食いしばった。', exNarTgt: '그는 이를 악물었다.' },
            'ko-zh': { srcLabel: 'Chinese', tgtLabel: '한국어', exSrc: '我给你买了床垫。', exTgt: '널 위해 매트리스를 샀어.', exNarSrc: '他咬紧了牙关。', exNarTgt: '그는 이를 악물었다.' }
        };
        const bl = bilingualLangMap[bilingualMode] || bilingualLangMap['ko-en'];
        parts.push(`
[BILINGUAL DIALOGUE MODE - HIGHEST PRIORITY]
This rule OVERRIDES all other translation instructions for quoted dialogue.
1. Narration/description (text OUTSIDE quotation marks ""): Translate into ${bl.tgtLabel} normally.
2. Dialogue (text INSIDE quotation marks ""): Keep the ORIGINAL ${bl.srcLabel} text intact, then append ${bl.tgtLabel} translation inside [] BEFORE the closing quotation mark.
3. Format: "Original dialogue. [${bl.tgtLabel} 번역.]"
4. Apply this to EVERY quoted dialogue without exception. Do NOT skip any.
5. Other quote styles (「」, 『』, "") follow the same rule.

[EXAMPLES]
Source: ${bl.exNarSrc} "${bl.exSrc}"
Output: ${bl.exNarTgt} "${bl.exSrc} [${bl.exTgt}]"

Source: ${bl.exNarSrc} "${bl.exSrc}" ${bl.exNarSrc}. "${bl.exSrc}"
Output: ${bl.exNarTgt} "${bl.exSrc} [${bl.exTgt}]" ${bl.exNarTgt}. "${bl.exSrc} [${bl.exTgt}]"
`);
    }
    
    if (settings.userPrompt && settings.userPrompt.trim()) { parts.push(`[Additional instructions: ${settings.userPrompt.trim()}]`); }
    
    if (settings.dictionary && settings.dictionary.trim()) {
        parts.push(`\n[MANDATORY GLOSSARY]`);
        parts.push(`You MUST use the following glossary for specific terms. Apply natural morphological changes (plural, possessive, verb conjugations) according to the context without breaking the term's core meaning.`);
        parts.push(`CRITICAL: Output ONLY the translated term. NEVER add the original word in brackets, parentheses, or any annotation like "소프[Soap]" or "소프(Soap)". Just use the glossary term directly.`);
        parts.push(settings.dictionary);
    }

    if (prevTranslation) { parts.push(`[MANDATORY: Your translation MUST be COMPLETELY DIFFERENT from this: "${prevTranslation.substring(0, 200)}"]`); parts.push(`[Use different vocabulary, sentence structure, and tone. Do NOT produce a similar result.]`); }
    if (contextMessages.length > 0) { parts.push('\n[Context - Previous messages for reference only, do NOT translate these:]'); contextMessages.forEach((msg, i) => { const offset = contextMessages.length - i; parts.push(`Message -${offset}: "${msg}"`); }); }
    parts.push(`\n[Translate this message:]\n${text}`);
    return parts.join('\n');
}

async function fetchWithRetry(url, body, retries = 3, abortSignal = null, extraHeaders = {}) {
    const delays = [500, 1000, 2000];
    for (let attempt = 0; attempt <= retries; attempt++) {
        try { const fetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) }; if (abortSignal) fetchOptions.signal = abortSignal; const res = await fetch(url, fetchOptions); if (res.status === 429) { if (attempt < retries) { await sleep(delays[attempt] || 2000); continue; } throw new Error('429 Too Many Requests'); } if (!res.ok) { throw new Error(`API 오류 (${res.status})`); } return await res.json(); } catch (e) { if (e.name === 'AbortError') throw e; if (attempt >= retries) throw e; await sleep(delays[attempt] || 2000); }
    }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
export function gatherContextMessages(msgId, stContext, range = 1) {
    if (range <= 0) return []; const chat = stContext.chat; const messages = []; const startIdx = Math.max(0, msgId - range);
    for (let i = startIdx; i < msgId; i++) { if (chat[i] && chat[i].mes) { const cleanMsg = chat[i].mes.replace(/<(?!!--)[^>]+>/g, '').trim(); if (cleanMsg) messages.push(cleanMsg); } } return messages;
}
