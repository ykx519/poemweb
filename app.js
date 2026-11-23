/* ══════════════════════════════════════════════════════════
   app.js — 诗镜 · Poetry Lens 引擎与交互
   规则引擎：体裁判定 → 格律提示 → 艺术品评 → 改进建议
   ══════════════════════════════════════════════════════════ */
'use strict';

/* ───────────────────────── 0. 平仄字表构建 ───────────────────────── */
const TONE_MAP = {};   // char -> 'ping' | 'ze' | 'ru' | 'shang' | 'qu'
const GROUP_OF = {};   // char -> 韵部 id

(function buildToneMap() {
  PING_GROUPS.forEach(g => { for (const c of g.chars) { TONE_MAP[c] = TONE_MAP[c] || 'ping'; GROUP_OF[c] = GROUP_OF[c] || g.id; } });
  SHANG_GROUPS.forEach(g => { for (const c of g.chars) { TONE_MAP[c] = TONE_MAP[c] || 'shang'; GROUP_OF[c] = GROUP_OF[c] || g.id; } });
  QU_GROUPS.forEach(g => { for (const c of g.chars) { TONE_MAP[c] = TONE_MAP[c] || 'qu'; GROUP_OF[c] = GROUP_OF[c] || g.id; } });
  RU_GROUPS.forEach(g => { for (const c of g.chars) { TONE_MAP[c] = TONE_MAP[c] || 'ru'; GROUP_OF[c] = GROUP_OF[c] || g.id; } });
  for (const c of ZE_EXTRA) { TONE_MAP[c] = TONE_MAP[c] || 'ze'; }
})();

function toneOf(ch) {
  if (POLY_CHARS[ch]) {
    const def = POLY_CHARS[ch].def;
    const rec = POLY_CHARS[ch].readings.find(r => r[0] === def) || POLY_CHARS[ch].readings[0];
    return { t: rec[1].startsWith('平') ? 'ping' : 'ze', raw: rec[1], poly: true };
  }
  const t = TONE_MAP[ch];
  if (!t) return { t: null, raw: '未收录', poly: false };
  return { t: t === 'ping' ? 'ping' : 'ze', raw: ({ ping: '平声', shang: '上声', qu: '去声', ru: '入声' })[t], ru: t === 'ru', poly: false };
}
const isRu = ch => TONE_MAP[ch] === 'ru';

/* 邻韵（用于孤雁出群格 / 辘轳格 / 进退格提示） */
const NEIGHBORS = [
  ['上平一东', '上平二冬'], ['上平三江', '下平七阳'],
  ['上平四支', '上平五微', '上平八齐', '上平十灰'],
  ['上平九佳', '上平十灰'], ['上平十一真', '上平十二文', '上平十三元'],
  ['上平十四寒', '上平十五删', '下平一先'],
  ['下平二萧', '下平三肴', '下平四豪'],
  ['下平八庚', '下平九青', '下平十蒸'],
  ['下平十三覃', '下平十四盐', '下平十五咸']
];
function neighborGroup(a, b) {
  return NEIGHBORS.some(set => set.includes(a) && set.includes(b));
}

/* ───────────────────────── 1. 预处理 ───────────────────────── */
function parseBody(body) {
  const lines = [];
  body.split(/\r?\n/).forEach(raw => {
    if (!raw.trim()) { lines.push({ blank: true }); return; }
    raw.split(/[，。！？；：、,.!?;:…—－~～（）()《》「」“”"']/).forEach(seg => {
      const clean = seg.replace(/[\s\u3000]/g, '').replace(/[^\u4e00-\u9fffA-Za-z]/g, '');
      if (clean) lines.push({ text: seg.trim(), clean, chars: [...clean], blank: false });
    });
  });
  return lines.filter((l, i) => !l.blank || (i > 0 && !lines[i - 1].blank && false));
}
const hasCJK = s => /[\u4e00-\u9fff]/.test(s);
const cjkCount = s => (s.match(/[\u4e00-\u9fff]/g) || []).length;

/* ───────────────────────── 2. 西方诗歌格律 ───────────────────────── */
function latinSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  let m = word.match(/[aeiouy]+/g);
  let n = m ? m.length : 1;
  if (word.length > 3 && word.endsWith('e') && n > 1) n--;
  return n;
}
function rhymeKey(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return '';
  const keyOf = w => { const m = w.match(/[aeiouy]+[^aeiouy]*$/); return m ? m[0] : w.slice(-3); };
  let key = keyOf(word);
  if (key === 'e' && word.length > 3) key = keyOf(word.slice(0, -1));
  return key;
}
function analyzeWestern(lines) {
  const texts = lines.map(l => l.clean);
  const out = { scheme: '', schemeDetail: [], notes: [] };
  const keys = texts.map(t => {
    const words = t.split(/\s+/).filter(Boolean);
    return words.length ? rhymeKey(words[words.length - 1]) : rhymeKey(t);
  });
  // 韵式字母
  const map = {}; const labels = [];
  let next = 0;
  keys.forEach(k => {
    if (!k) { labels.push('·'); return; }
    if (!(k in map)) map[k] = 'ABCDEFGH'[next++];
    labels.push(map[k]);
  });
  out.scheme = labels.join('');
  out.schemeDetail = labels;
  return out;
}
function detectWestern(lines, bodyRaw) {
  const texts = lines.map(l => l.clean).filter(Boolean);
  const n = texts.length;
  const w = analyzeWestern(lines);
  const sy = texts.map(t => t.split(/\s+/).reduce((s, x) => s + latinSyllables(x), 0) || cjkCount(t));
  const evidence = [], alts = [];

  // 俳句：3 行 5-7-5
  if (n === 3) {
    const c575 = texts.every((t, i) => (cjkCount(t) || latinSyllables(t.split(/\s+/).join(''))) === [5, 7, 5][i]);
    const kigo = HAIKU_KIGO.find(k => bodyRaw.includes(k));
    if (c575) {
      evidence.push('3 行，字数呈 5-7-5');
      evidence.push(kigo ? `含季语「${kigo}」` : '含季语校验');
      return {
        primary: '西方诗歌 > 俳句', confidence: '高', evidence,
        alternatives: n === 3 ? ['三行小诗 / 俳谐连句'] : [],
        haikuNoKigo: !kigo
      };
    }
  }
  // 莎士比亚十四行
  if (n === 14) {
    const s = w.scheme;
    const shakespeare = s.slice(0, 4) === 'ABAB' && s.slice(4, 8) === 'CDCD' && s.slice(8, 12) === 'EFEF' && s.slice(12) === 'GG';
    const petrarch = s.slice(0, 8) === 'ABBAABBA' && ['CDECDE', 'CDCDCD'].includes(s.slice(8));
    if (shakespeare) return { primary: '西方诗歌 > 莎士比亚十四行诗', confidence: '高', evidence: ['14 行', `韵式 ${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8, 12)} ${s.slice(12)}`, '末两行对句收束'], alternatives: [] };
    if (petrarch) return { primary: '西方诗歌 > 彼特拉克十四行诗', confidence: '高', evidence: ['14 行', `前八行 ${s.slice(0, 8)}`, `后六行 ${s.slice(8)}`], alternatives: [] };
    if (/^(\w)\1$/.test(s.slice(12))) {
      evidence.push('14 行，末两行押对句');
      return { primary: '西方诗歌 > 莎士比亚十四行诗', confidence: '中', evidence: [...evidence, `实际韵式 ${s}（前 12 行未严格 ABAB 循环）`], alternatives: ['彼特拉克十四行诗', '自由诗'] };
    }
    return { primary: '西方诗歌 > 十四行诗（变体）', confidence: '中', evidence: ['14 行', `韵式 ${s}（不合 ABAB CDCD EFEF GG，亦不合 ABBAABBA）`], alternatives: ['自由诗'] };
  }
  // 维拉内尔：19 行，两个叠句交替
  if (n === 19) {
    const first = texts[0], last = texts[18], t13 = texts[12];
    const repeatCount = texts.filter(t => t === first).length + texts.filter(t => t === t13).length;
    if (repeatCount >= 4) {
      return { primary: '西方诗歌 > 维拉内尔（Villanelle）', confidence: '高', evidence: ['19 行（5 节三行 + 1 节四行）', '两行叠句交替回环', '仅用两个韵脚'], alternatives: [] };
    }
  }
  // 五行打油诗
  if (n === 5 && w.scheme === 'AABBA') {
    return { primary: '西方诗歌 > 五行打油诗（Limerick）', confidence: '高', evidence: ['5 行', '韵式 AABBA', '长短长短长'], alternatives: [] };
  }
  // 民谣体：四行一节，ABAB / ABCB
  if (n >= 4 && n % 4 === 0) {
    const s = w.scheme;
    let ok = true;
    for (let i = 0; i < n; i += 4) {
      const st = s.slice(i, i + 4);
      if (!['ABAB', 'ABCB'].includes(st)) ok = false;
    }
    if (ok) return { primary: '西方诗歌 > 民谣体（Ballad）', confidence: '中', evidence: ['四行一节', `韵式 ${s.slice(0, 4)} 循环`, '叙事与抒情并重'], alternatives: ['自由诗'] };
  }
  // 散文诗：不分行、成段落
  const bodyLines = bodyRaw.split(/\r?\n/).filter(x => x.trim());
  if (bodyLines.length <= 2 && bodyRaw.length > 60) {
    return { primary: '西方诗歌 > 散文诗', confidence: '中', evidence: ['成段落、不分行', '无固定韵脚', '具诗性密度'], alternatives: ['自由诗'] };
  }
  return {
    primary: '西方诗歌 > 自由诗', confidence: '中',
    evidence: [`无固定格律与固定行数（${n} 行）`, '以意象与节奏组织', `参考韵式：${w.scheme || '不押韵'}`],
    alternatives: ['散文诗']
  };
}

/* ───────────────────────── 3. 中国诗歌体裁判定 ───────────────────────── */
function matchCipai(pattern) {
  return CIPAI_LIB.find(cp => cp.pattern.length === pattern.length &&
    cp.pattern.every((v, i) => Math.abs(v - pattern[i]) <= 1));
}
/* 词牌全库匹配（依龙榆生《唐宋词格律》153 词牌，含诸体） */
function findCipai(lens) {
  if (typeof CIPAI_FULL === 'undefined') return null;
  let best = null;
  for (const cp of CIPAI_FULL) {
    for (const ti of cp.tis) {
      if (ti.pattern.length !== lens.length) continue;
      let diff = 0;
      for (let i = 0; i < lens.length; i++) diff += Math.abs(ti.pattern[i] - lens[i]);
      if (!best || diff < best.diff) best = { cp, ti, diff };
    }
  }
  if (!best || best.diff > 2) return null;
  return { cp: best.cp, ti: best.ti, exact: best.diff === 0 };
}
/* 从题目中提取词牌名（含别名） */
function cipaiFromTitle(title) {
  if (typeof CIPAI_FULL === 'undefined' || !title) return null;
  const clean = title.replace(/[《》〈〉]/g, '').split(/[·:：—–\-－~～、,，（(\s]/)[0];
  return CIPAI_FULL.find(c => c.name === clean || c.aliases.includes(clean)) || null;
}
function ciVerdict(hit, lens, alts, titleHit) {
  const { cp, ti, exact } = hit;
  return {
    primary: `词 > 《${cp.name}》`, confidence: exact ? '高' : '中',
    evidence: [
      `${lens.length} 句，句式 ${lens.join('、')} 与《${cp.name}》${ti.title === '正体' ? '正体' : ti.title}${exact ? '完全吻合' : '基本吻合（小异）'}`,
      `用韵格：${cp.yunge || '（未标注）'}，全词 ${cp.zishu} 字`,
      cp.desc.slice(0, 60) + (cp.desc.length > 60 ? '…' : ''),
      titleHit ? `题面标明词牌「${cp.name}」` : '长短参差，依词谱定格'
    ],
    alternatives: alts || [],
    cipai: { name: cp.name, yunge: cp.yunge, desc: cp.desc, appendix: cp.appendix, pattern: ti.pattern, rhymeIdx: ti.rhymeIdx, tiTitle: ti.title, pu: ti.pu, url: cp.url }
  };
}
/* 从文本中找词牌名（含别名） */
function findCipaiName(text) {
  if (!text || typeof CIPAI_FULL === 'undefined') return null;
  for (const c of CIPAI_FULL) {
    if (c.name && text.includes(c.name)) return c;
    for (const a of (c.aliases || [])) if (a && text.includes(a)) return c;
  }
  return null;
}

function ciUnknown(lens, n, named) {
  const minL = Math.min(...lens), maxL = Math.max(...lens), sum = lens.reduce((a, b) => a + b, 0);
  return {
    primary: '词 >（词牌待考）', confidence: '中',
    evidence: [
      `长短参差（${lens.join('、')}），共 ${n} 句 ${sum} 字`,
      named ? '题面 / 首行标有词牌，具备词体特征' : '句式参差有度，具备词体特征',
      '未匹配到《唐宋词格律》153 词牌定格，或为变体（减字 / 摊破 / 偷声）或自度曲'
    ],
    alternatives: ['古体诗 > 乐府 / 歌行体', '曲'],
    cipai: null, ciLike: true
  };
}

/* 期望体裁优先：用户指定体裁时以其为准 */
function detectByExpect(expect, ss, lens, titleRaw, bodyRaw) {
  const map = {
    '五言绝句': '近体诗 > 五言绝句', '七言绝句': '近体诗 > 七言绝句',
    '五言律诗': '近体诗 > 五言律诗', '七言律诗': '近体诗 > 七言律诗', '排律': '近体诗 > 排律',
    '五古': '古体诗 > 五古', '七古': '古体诗 > 七古', '乐府 / 歌行体': '古体诗 > 乐府 / 歌行体',
    '词': '词', '曲': '曲',
    '现代诗': '现代诗', '散文诗': '现代诗 > 散文诗', '自由诗': '现代诗 > 自由诗',
    '莎士比亚十四行诗': '西方诗歌 > 莎士比亚十四行诗', '彼特拉克十四行诗': '西方诗歌 > 彼特拉克十四行诗',
    '俳句': '西方诗歌 > 俳句', '维拉内尔': '西方诗歌 > 维拉内尔（Villanelle）',
    '民谣体': '西方诗歌 > 民谣体（Ballad）', '五行打油诗': '西方诗歌 > 五行打油诗（Limerick）'
  };
  const ev = [`用户指定体裁「${expect}」，以此为准`];
  const noProsody = /现代诗|散文诗|自由诗|莎士比亚|彼特拉克|俳句|维拉内尔|民谣体|打油/.test(expect);
  if (expect === '词') {
    const named = findCipaiName(titleRaw) || findCipaiName(ss[0] || '') || findCipaiName((bodyRaw.split(/\r?\n/)[0] || ''));
    const hit = findCipai(lens);
    if (hit) { const v = ciVerdict(hit, lens, [], !!named); v.evidence = [...ev, ...v.evidence]; return v; }
    if (named) {
      let best = null;
      for (const ti of named.tis) {
        const diff = ti.pattern.length === lens.length ? ti.pattern.reduce((s, v, i) => s + Math.abs(v - lens[i]), 0) : 999;
        if (!best || diff < best.diff) best = { ti, diff };
      }
      const v = ciVerdict({ cp: named, ti: best.ti, exact: false }, lens, [], true);
      v.evidence = [...ev, `题面标明词牌「${named.name}」，但句式与词谱小异，或为变体`, ...v.evidence];
      return v;
    }
    return { primary: '词 >（词牌待考）', confidence: '高', evidence: [...ev, `句式 ${lens.join('、')}，未匹配到词牌定格，判为变体 / 自度曲`], alternatives: [], cipai: null, ciLike: true, noProsody: false };
  }
  return {
    primary: map[expect] || expect,
    confidence: '高', evidence: ev, alternatives: [],
    noProsody, cipai: null
  };
}

function detectChinese(lines, titleRaw, bodyRaw, expect) {
  const ss = lines.map(l => l.clean).filter(Boolean);
  const lens = ss.map(s => s.length);
  const n = ss.length;
  const evidence = [], alts = [];

  // 期望体裁优先：用户已选定时以其为准
  if (expect && expect !== 'auto') return detectByExpect(expect, ss, lens, titleRaw, bodyRaw);

  // 现代诗 / 散文诗（白话特征）
  const vern = ss.filter(s => /[的了吗呢吧着我你他她它们这那在是就都也很和与]/.test(s)).length / Math.max(1, n);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, n);
  if (vern > 0.6 || avg > 12) {
    const bodyLines = bodyRaw.split(/\r?\n/).filter(x => x.trim());
    if (bodyLines.length <= 2 && bodyRaw.length > 60) {
      return { primary: '现代诗 > 散文诗', confidence: '中', evidence: ['成段落、不分行', '白话语感', '无固定韵脚'], alternatives: ['现代诗'] };
    }
    return { primary: '现代诗', confidence: '高', evidence: ['白话语感为主', `句长自由（${lens.join('-')}）`, '分行自由、无固定格律'], alternatives: ['散文诗'] };
  }

  const uniform = lens.every(v => v === lens[0]);
  const hitTitle = cipaiFromTitle(titleRaw);
  const cpAny = findCipai(lens);
  // 词牌名（题面 / 正文首行）——判断是否为词的关键依据
  const cipaiNamed = !!(findCipaiName(titleRaw) || findCipaiName(ss[0] || '') || findCipaiName((bodyRaw.split(/\r?\n/)[0] || '')));

  // 题面标明词牌且句式吻合 → 直接判词
  if (hitTitle && cpAny && cpAny.cp.name === hitTitle.name) return ciVerdict(cpAny, lens, [], true);

  if (uniform) {
    const L = lens[0];
    const near = () => {
      const nm = n === 4 ? (L === 5 ? '五言绝句' : '七言绝句') : n === 8 ? (L === 5 ? '五言律诗' : '七言律诗') : '排律';
      const v = nearVerdict('近体诗 > ' + nm, ss, evidence, alts, [L === 5 ? '五古' : '七古']);
      if (cpAny && v._prosody) {
        const rhymeEnds = v._prosody.rhymeRows.filter(r => r.isRhyme);
        const endsZe = rhymeEnds.length && rhymeEnds.every(r => r.tone.t === 'ze');
        if (endsZe) v.alternatives.unshift(`词 > 《${cpAny.cp.name}》（${cpAny.cp.yunge}，句式全同）`);
      }
      return v;
    };
    if (L === 5 && n === 4) return near();
    if (L === 7 && n === 4) return near();
    if (L === 5 && n === 8) return near();
    if (L === 7 && n === 8) return near();
    if ((L === 5 || L === 7) && n >= 10) {
      const v = near();
      v.evidence.push(`${n} 句 × ${L} 字，除首尾联外宜对仗`);
      if (v._prosody && v._prosody.conformRate < 0.65) {
        return {
          primary: L === 5 ? '古体诗 > 五古' : '古体诗 > 七古', confidence: '高',
          evidence: [...v.evidence, '平仄不合近体格律，判为古体（长篇）'],
          alternatives: ['近体诗 > 排律']
        };
      }
      return v;
    }
    // 齐言但句数特殊：题面 / 首行标有词牌名时判词（如浣溪沙 6×7、玉楼春 8×7）
    if (cipaiNamed) {
      if (cpAny) return ciVerdict(cpAny, lens, [L === 5 ? '五古' : '七古'], true);
      if (hitTitle) return ciVerdictByTitle(hitTitle, lens);
      return ciUnknown(lens, n, true);
    }
    if (L === 5) return { primary: '古体诗 > 五古', confidence: '高', evidence: [`4 句以外的五言齐言（${n} 句）`, '不拘平仄粘对', '可换韵'], alternatives: ['近体诗 > 五言律诗（截句）', '词'] };
    if (L === 7) return { primary: '古体诗 > 七古', confidence: '高', evidence: [`4/8 句以外的七言齐言（${n} 句）`, '不拘平仄粘对'], alternatives: ['近体诗 > 七言律诗（截句）', '词'] };
    if (L === 4) return { primary: '古体诗 > 四言古诗', confidence: '高', evidence: ['四言齐言，风雅遗响'], alternatives: [] };
    return { primary: '古体诗 / 其他', confidence: '中', evidence: [`${n} 句 × ${L} 字`], alternatives: [] };
  }

  // 长短参差：题面 / 首行标有词牌名 → 判词；否则按现代 / 自由 / 散文 / 古体处理
  if (cipaiNamed) {
    if (cpAny) return ciVerdict(cpAny, lens, ['古体诗 > 乐府 / 歌行体', '曲'], true);
    if (hitTitle) return ciVerdictByTitle(hitTitle, lens);
    return ciUnknown(lens, n, true);
  }
  if (/[歌行引吟曲辞篇调]$/.test(titleRaw)) {
    return { primary: '古体诗 > 乐府 / 歌行体', confidence: '高', evidence: ['题面含「歌 / 行 / 引 / 吟 / 曲」', '句式参差、换韵自由'], alternatives: ['词'] };
  }
  // 无词牌名的长短句：现代诗 / 散文诗 / 自由诗优先于古体杂言
  const bodyLines2 = bodyRaw.split(/\r?\n/).filter(x => x.trim());
  if (bodyLines2.length <= 2 && bodyRaw.length > 60 && avg > 6) {
    return { primary: '现代诗 > 散文诗', confidence: '中', evidence: ['成段落、少分行', '白话语感，无固定韵脚'], alternatives: ['自由诗', '现代诗'], noProsody: true };
  }
  if (vern >= 0.25 || avg >= 10) {
    return { primary: '现代诗', confidence: '中', evidence: [`句长自由（${lens.join('-')}）`, '未标词牌、无固定格律，判为现代诗（自由体）'], alternatives: ['自由诗', '古体诗 > 乐府 / 歌行体'], noProsody: true };
  }
  const fiveish = lens.filter(v => v === 5).length, sevenish = lens.filter(v => v === 7).length;
  if (fiveish >= sevenish) return { primary: '古体诗 > 五古（杂言）', confidence: '中', evidence: [`杂言句式（${lens.join('、')}）`, '以五言为主干'], alternatives: ['词', '古体诗 > 乐府 / 歌行体'] };
  return { primary: '古体诗 > 七古（杂言）', confidence: '中', evidence: [`杂言句式（${lens.join('、')}）`, '以七言为主干'], alternatives: ['词', '古体诗 > 乐府 / 歌行体'] };
}

/* 题面有词牌但句式不合：仍判为词，提示减字/摊破/自度曲 */
function ciVerdictByTitle(cp, lens) {
  let best = null;
  for (const ti of cp.tis) {
    const diff = ti.pattern.length === lens.length
      ? ti.pattern.reduce((s, v, i) => s + Math.abs(v - lens[i]), 0) : 999;
    if (!best || diff < best.diff) best = { ti, diff };
  }
  const ti = best && best.diff < 999 ? best.ti : cp.tis[0];
  const v = ciVerdict({ cp, ti, exact: false }, lens, ['古体诗 > 乐府 / 歌行体'], true);
  if (!best || best.diff > 2) {
    v.confidence = '中';
    v.evidence.push(`⚠ 句式与《${cp.name}》词谱（${ti.pattern.join('、')}）不合，或为减字 / 摊破 / 自度体，请人工核对词谱`);
  }
  return v;
}
function nearVerdict(primary, ss, evidence, alts, altNames) {
  evidence.push(`${ss.length} 句 × ${ss[0].length} 字，硬性特征吻合`);
  const r = analyzeProsody(ss, primary);
  if (r.conformRate >= 0.85) evidence.push(`平仄合律（合律率 ${Math.round(r.conformRate * 100)}%）`);
  else { evidence.push(`平仄合律率仅 ${Math.round(r.conformRate * 100)}%（近体诗要求 ≥ 85%）`); alts.push(...altNames); }
  if (r.dualPairs && r.dualPairs.length) {
    const bad = r.dualPairs.filter(p => p.label === '失对').length;
    if (!bad) evidence.push('中二联对仗工稳');
  }
  if (r.rhymeOneRhyme) evidence.push(`一韵到底（${r.rhymeGroups.join('、')}）`);
  return {
    primary, confidence: alts.length ? '中' : '高',
    evidence, alternatives: alts.length ? alts.slice(0, 2) : [],
    _prosody: r
  };
}

/* ───────────────────────── 4. 平仄谱与格律分析 ───────────────────────── */
const PAT5 = { T1: '⊙平⊙仄仄', T2: '⊙仄仄平平', T3: '⊙仄平平仄', T4: '⊙平仄仄平' };
const PAT7 = { T1: '⊙平⊙仄平平仄', T2: '⊙仄平平⊙仄平', T3: '⊙仄⊙平平仄仄', T4: '⊙平⊙仄仄平平' };

function buildPatternSeq(firstLine, len5, count) {
  // 依首句第二字定平起/仄起，依首句末字定首句入韵与否
  const to = toneOf(firstLine[1] || firstLine[0]);
  const last = toneOf(firstLine[firstLine.length - 1]);
  const pingStart = to.t === 'ping';
  const firstRhyme = last.t === 'ping';
  const P = len5 ? PAT5 : PAT7;
  let seq4;
  if (len5) {
    seq4 = pingStart ? (firstRhyme ? [P.T4, P.T2, P.T3, P.T4] : [P.T1, P.T2, P.T3, P.T4])
      : (firstRhyme ? [P.T2, P.T4, P.T1, P.T2] : [P.T3, P.T4, P.T1, P.T2]);
  } else {
    seq4 = pingStart ? (firstRhyme ? [P.T4, P.T2, P.T3, P.T4] : [P.T1, P.T2, P.T3, P.T4])
      : (firstRhyme ? [P.T2, P.T4, P.T1, P.T2] : [P.T3, P.T4, P.T1, P.T2]);
  }
  const seq = [];
  for (let i = 0; i < count; i++) seq.push(seq4[i % 4]);
  return {
    seq,
    name: `${len5 ? '五言' : '七言'} · ${pingStart ? '平' : '仄'}起首句${firstRhyme ? '入' : '不入'}韵`,
    seq4
  };
}

function analyzeProsody(ss, genrePrimary, rhymeIdxArr, cipaiInfo) {
  const res = { lines: [], conformRate: null, flags: [], rhymeGroups: [], rhymeOneRhyme: true, dualPairs: [] };
  res.useCL = !!rhymeIdxArr;
  res.yunge = (cipaiInfo && cipaiInfo.yunge) || '';
  const uniform57 = ss.length > 0 && ss.every(s => s.length === ss[0].length) && (ss[0].length === 5 || ss[0].length === 7);
  res.partial = !uniform57 || !!rhymeIdxArr;
  res.strict = /近体诗/.test(genrePrimary || '');
  const isFive = ss[0] && ss[0].length === 5;
  const pat = res.partial
    ? { seq: [], name: /《.+》/.test(genrePrimary || '') ? (genrePrimary.match(/《.+》/)[0] + ' · 依词谱定格，逐字平仄以词谱为准') : '长短句（词 / 曲 / 乐府）· 不拘平仄谱，依词谱曲牌定格' }
    : buildPatternSeq(ss[0], isFive, ss.length);
  res.patternName = pat.name;
  res.patternSeq = pat.seq;

  let okCount = 0, totalFix = 0, unknownChars = [];
  ss.forEach((line, idx) => {
    const exp = res.partial ? '' : (pat.seq[idx] || '');
    const tones = [...line].map(toneOf);
    const actualStr = tones.map(t => t.t === 'ping' ? '平' : t.t === 'ze' ? '仄' : '？').join('');
    const badPos = [];
    [...exp].forEach((e, i) => {
      if (e === '⊙') return;
      const at = tones[i] && tones[i].t;
      if (!at) { unknownChars.push(line[i]); return; }   // 未收录字不计入合律统计
      totalFix++;
      if (at === (e === '平' ? 'ping' : 'ze')) okCount++;
      else badPos.push(i);
    });
    // 特殊规则（仅近体诗）
    const lineFlags = [];
    if (res.strict) {
      const t = tones.map(x => x.t);
      const tail3 = t.slice(-3).join('');
      if (tail3 === 'pingpingping') lineFlags.push('三平调（句末三平，近体大忌）');
      if (tail3 === 'zezeze' && t[t.length - 1] === 'ze') lineFlags.push('三仄尾（句末三仄）');
      if (t[t.length - 1] === 'ping') {
        const bodyPings = t.slice(0, -1).filter(x => x === 'ping').length;
        if (bodyPings === 1 && t[1] === 'ping') lineFlags.push('孤平（「平平仄仄平」句式第一字误用仄声所致）');
      }
    }
    res.lines.push({
      text: line, exp, actual: actualStr, tones, badPos, flags: lineFlags,
      endChar: line[line.length - 1]
    });
    if (badPos.length || lineFlags.length) res.flags.push({ idx, badPos, lineFlags });
  });
  res.conformRate = res.strict ? (totalFix ? okCount / totalFix : null) : null;
  res.unknownChars = [...new Set(unknownChars)];

  // 粘对（仅齐言近体）
  res.tieDui = [];
  if (!res.partial && res.strict) for (let i = 1; i < ss.length; i++) {
    const a = res.lines[i - 1], b = res.lines[i];
    const headA = a.tones[1] && a.tones[1].t, headB = b.tones[1] && b.tones[1].t;
    if (i % 2 === 1) res.tieDui.push({ pair: [i - 1, i], type: '对', ok: headA && headB && headA !== headB });
    else res.tieDui.push({ pair: [i - 1, i], type: '粘', ok: headA && headB && headA === headB });
  }

  // 韵脚
  res.rhymeRows = [];
  const endInfos = ss.map((s, i) => {
    const ch = s[s.length - 1];
    const t = toneOf(ch);
    return { i, ch, t, group: GROUP_OF[ch] || '未收录', ru: isRu(ch) };
  });
  const evenRhyme = endInfos.filter(e => e.i % 2 === 1);   // 二四六八句
  const firstRhymes = endInfos.length && endInfos[0].t.t === 'ping';
  let rhymePositions;
  if (rhymeIdxArr && rhymeIdxArr.length) {
    rhymePositions = new Set(rhymeIdxArr);
  } else {
    rhymePositions = new Set(evenRhyme.map(e => e.i));
    if (firstRhymes) rhymePositions.add(0);
  }
  const ALLG = PING_GROUPS.concat(SHANG_GROUPS, QU_GROUPS, RU_GROUPS);
  const clOfG = g => (ALLG.find(x => x.id === g) || {}).cl;
  const szOfG = g => (ALLG.find(x => x.id === g) || {}).sz || '';
  const rhymeEnds = endInfos.filter(e => rhymePositions.has(e.i));
  const base = rhymeEnds.find(e => e.group !== '未收录') || rhymeEnds[0] || endInfos[0];
  const firstGroup = base.group;
  // 仅「平韵格 / 仄韵格」且非递换两部的调体与近体讲究一韵到底；转换格 / 错叶格 / 通叶格 / 递换调 / 未知调体转韵为常态
  const multiRhyme = /递换|两部|换叶|错叶|通叶|转韵|换韵/.test((cipaiInfo ? (cipaiInfo.desc || '') + (cipaiInfo.appendix || '') : ''));
  const oneRhymeTune = /平韵格|仄韵格/.test(res.yunge) && !/转换|错叶|通叶/.test(res.yunge) && !multiRhyme;
  // 宽式合韵判定：未收录字一律按合韵；邻韵、同词林部、同辙均视为合韵
  const compat = (g1, g2) => {
    if (g1 === '未收录' || g2 === '未收录') return true;
    if (g1 === g2) return true;
    if (res.useCL && clOfG(g1) && clOfG(g2) && clOfG(g1) === clOfG(g2)) return true;
    if (neighborGroup(g1, g2)) return true;
    if (!res.strict) {
      const s1 = szOfG(g1).split('/')[0], s2 = szOfG(g2).split('/')[0];
      if (s1 && s2 && s1 === s2) return true;
    }
    return false;
  };
  res.rhymeGroups = [...new Set(rhymeEnds.map(e => e.group))];

  let rhymeOk = 0;
  endInfos.forEach(e => {
    const flags = [];
    const isRhyme = rhymePositions.has(e.i);
    const same = compat(e.group, firstGroup);
    if (isRhyme) {
      if (same) rhymeOk++;
      if (e.group === '未收录') {
        flags.push('※未收录字「' + e.ch + '」无法判部——按宽式作合韵处理，请人工确认');
      } else if (e.group !== firstGroup) {
        if (neighborGroup(e.group, firstGroup)) {
          flags.push(`※邻韵通押（「${e.group}」与「${firstGroup}」为邻韵，属孤雁出群格 / 辘轳格一类特殊用法）`);
        } else if (res.strict && szOfG(e.group) && szOfG(firstGroup) && szOfG(e.group).split('/')[0] === szOfG(firstGroup).split('/')[0]) {
          flags.push('※新旧韵不一致：按平水韵出韵，按中华新韵（今音，近似以十三辙归并）合律');
        } else if (res.strict) {
          flags.push(`**出韵：「${e.ch}」属${e.group}，与主韵「${firstGroup}」不同部**`);
        } else if (oneRhymeTune) {
          flags.push(`**换韵：「${e.ch}」属${e.group}，与主韵「${firstGroup}」不同部（本调为${res.yunge}，宜一韵到底）**`);
        } else {
          // 转换格 / 错叶格 / 通叶格 / 词牌待考：转韵为常态，不逐句标注，只汇总韵部序列
        }
      }
      if (e.ru) flags.push(res.strict ? '**入声字作韵脚**：短促急收，仄韵诗中尤为关键' : '※入声字作韵脚：短促急收');
    } else if (res.strict) {
      if (e.t.t === 'ping') flags.push('**非韵脚句末字须仄，此处为平声**');
    }
    if (POLY_CHARS[e.ch]) {
      flags.push(`**「${e.ch}」为多音字（${POLY_CHARS[e.ch].readings.map(r => r[0] + '·' + r[1]).join(' / ')}），此处归部随读音而定，请人工确认**`);
    }
    res.rhymeRows.push({ i: e.i, ch: e.ch, tone: e.t, group: e.group, isRhyme, flags });
  });
  res.rhymeRate = rhymeEnds.length ? rhymeOk / rhymeEnds.length : null;
  if (!res.strict && !oneRhymeTune) res.rhymeRate = null;   // 转韵定格的调体不作合规率
  res.rhymeOneRhyme = res.rhymeRate === null ? true : res.rhymeRate >= 0.999;
  // 韵部序列（供转换格 / 待考调体展示）
  const seq = [];
  rhymeEnds.forEach(e => { if (!seq.length || seq[seq.length - 1] !== e.group) seq.push(e.group); });
  res.rhymeSeq = seq;

  // 对仗（律诗 / 排律：颔联颈联，仅齐言近体）
  if (res.strict && ss.length >= 6) {
    const pairs = ss.length === 6 ? [[1, 2]] : [[2, 3], [4, 5]];
    if (ss.length >= 8) {
      pairs.length = 0; pairs.push([2, 3], [4, 5]);
    }
    res.dualPairs = pairs.map(([a, b]) => {
      const A = [...ss[a]], B = [...ss[b]];
      if (A.length !== B.length) return { a, b, label: '失对', note: '上下句字数不等' };
      let opp = 0, cnt = 0;
      for (let i = 0; i < A.length - 1; i++) {
        const ta = toneOf(A[i]).t, tb = toneOf(B[i]).t;
        if (ta && tb) { cnt++; if (ta !== tb) opp++; }
      }
      const ratio = cnt ? opp / cnt : 0;
      let label = ratio >= 0.7 ? '工对' : ratio >= 0.45 ? '宽对' : '失对';
      if (label === '失对') return { a, b, label, note: `平仄相反率仅 ${Math.round(ratio * 100)}%`, ratio };
      return { a, b, label, note: `平仄相反率 ${Math.round(ratio * 100)}%`, ratio };
    });
  }
  return res;
}

/* ───────────────────────── 5. 艺术品评 ───────────────────────── */
const ALLITERATION_RE = /([\u4e00-\u9fff])\1/g;
const CLICHE = ['断肠', '残月', '相思泪', '愁断', '泪千行', '魂牵梦萦', '红尘滚滚'];
const FAMOUS_EXTRA = [
  '风急天高猿啸哀','渚清沙白鸟飞回','无边落木萧萧下','不尽长江滚滚来','万里悲秋常作客','百年多病独登台','艰难苦恨繁霜鬓','潦倒新停浊酒杯',
  '明月松间照','清泉石上流','竹喧归浣女','莲动下渔舟','空山新雨后','天气晚来秋','随意春芳歇','王孙自可留',
  '床前明月光','疑是地上霜','举头望明月','低头思故乡',
  '朝辞白帝彩云间','千里江陵一日还','两岸猿声啼不住','轻舟已过万重山',
  '春花秋月何时了','往事知多少','小楼昨夜又东风','故国不堪回首月明中','雕栏玉砌应犹在','只是朱颜改','问君能有几多愁','恰似一江春水向东流',
  '一曲新词酒一杯','去年天气旧亭台','夕阳西下几时回','无可奈何花落去','似曾相识燕归来','小园香径独徘徊',
  '大江东去','浪淘尽','千古风流人物','人生如梦','一尊还酹江月',
  '但愿人长久','千里共婵娟','寻寻觅觅','冷冷清清','凄凄惨惨戚戚','梧桐更兼细雨','这次第','怎一个愁字了得',
  '生当作人杰','死亦为鬼雄','两情若是久长时','又岂在朝朝暮暮',
  '此情可待成追忆','只是当时已惘然','沧海月明珠有泪','蓝田日暖玉生烟','庄生晓梦迷蝴蝶','望帝春心托杜鹃','锦瑟无端五十弦','一弦一柱思华年',
  '身无彩凤双飞翼','心有灵犀一点通','春蚕到死丝方尽','蜡炬成灰泪始干','曾经沧海难为水','除却巫山不是云',
  '海内存知己','天涯若比邻','野火烧不尽','春风吹又生',
  '会当凌绝顶','一览众山小','感时花溅泪','恨别鸟惊心','烽火连三月','家书抵万金','国破山河在','城春草木深',
  '采菊东篱下','悠然见南山','山气日夕佳','飞鸟相与还','结庐在人境','而无车马喧','问君何能尔','心远地自偏',
  '行到水穷处','坐看云起时','大漠孤烟直','长河落日圆',
  '劝君更尽一杯酒','西出阳关无故人','独在异乡为异客','每逢佳节倍思亲',
  '飞流直下三千尺','疑是银河落九天','孤帆远影碧空尽','唯见长江天际流',
  '长风破浪会有时','直挂云帆济沧海','抽刀断水水更流','举杯消愁愁更愁','天生我材必有用','千金散尽还复来','安能摧眉折腰事权贵','使我不得开心颜',
  '出师未捷身先死','长使英雄泪满襟','正是江南好风景','落花时节又逢君',
  '露从今夜白','月是故乡明','星垂平野阔','月涌大江流','细草微风岸','危樯独夜舟','飘飘何所似','天地一沙鸥',
  '两个黄鹂鸣翠柳','一行白鹭上青天','窗含西岭千秋雪','门泊东吴万里船',
  '好雨知时节','当春乃发生','随风潜入夜','润物细无声','造化钟神秀','阴阳割昏晓','荡胸生曾云','决眦入归鸟',
  '落霞与孤鹜齐飞','秋水共长天一色','海上生明月','天涯共此时','野旷天低树','江清月近人',
  '秦时明月汉时关','万里长征人未还','但使龙城飞将在','不教胡马度阴山',
  '黄河远上白云间','一片孤城万仞山','羌笛何须怨杨柳','春风不度玉门关',
  '葡萄美酒夜光杯','欲饮琵琶马上催','醉卧沙场君莫笑','古来征战几人回',
  '慈母手中线','游子身上衣','谁言寸草心','报得三春晖',
  '沉舟侧畔千帆过','病树前头万木春','旧时王谢堂前燕','飞入寻常百姓家',
  '商女不知亡国恨','隔江犹唱后庭花','停车坐爱枫林晚','霜叶红于二月花',
  '南朝四百八十寺','多少楼台烟雨中','春色满园关不住','一枝红杏出墙来'
];
const FAMOUS_SET = (() => {
  const set = new Set();
  const add = t => {
    t = (t || '').replace(/[，。！？；、…—－~～「」“”‘’"'（）()《》\s]/g, '');
    if (t.length >= 3) set.add(t);
  };
  FAMOUS_EXTRA.forEach(add);
  (typeof IMAGE_LIB !== 'undefined' ? IMAGE_LIB : []).forEach(im => im.quotes.forEach(q => add(q.split('——')[0])));
  (typeof SCHOOL !== 'undefined' ? [...SCHOOL.cn, ...SCHOOL.west] : []).forEach(g => g.examples.forEach(ex => ex.lines.forEach(l => add(l.t))));
  (typeof POETS !== 'undefined' ? POETS : []).forEach(p => add(p.quote.replace(/[「」]/g, '')));
  return set;
})();

const SCENERY_CHARS = '山水风云月星雨雪霜烟波江河湖海楼台亭桥舟帆柳松竹梅兰菊荷草木花鸟雁鸿鹤鸥蝉蛩猿马犬笛琴钟鼓灯烛炉茶酒书剑镜帘窗阶径沙石泉溪涧峰岭谷崖岛渡津关城宫阙寺园林田桑麻麦稻露虹岚霭潮汐萍苔蘋芙蓉桃杏桐荷芦荻鸳鸯杜鹃鹏莺燕鹭鸥鸦鹭';
const SCENERY_RE = new RegExp('[' + SCENERY_CHARS + ']', 'g');

const ALLUSION_KEYS = ['采菊', '东篱', '折柳', '长亭', '凭栏', '庄生', '望帝', '青鸟', '烂柯', '鸿雁', '杜鹃', '南浦', '阳关', '登楼', '投笔', '请缨', '击楫', '新亭', '黍离', '广陵'];

function analyzeArt(lines, prosody, genre, poet) {
  const text = lines.map(l => l.clean).join('');
  const quoted = lines.map(l => l.clean);
  const imageryHits = IMAGE_LIB.filter(im => text.includes(im.name) || im.collocs.some(c => c.length >= 2 && text.includes(c)));
  const cats = [...new Set(imageryHits.map(i => i.cat))];
  const dup = [...new Set(text.match(ALLITERATION_RE) || [])];
  const allusions = ALLUSION_KEYS.filter(k => text.includes(k));
  const metaphors = (text.match(/[如似若疑是犹如宛如恰似]/g) || []).length;
  const hyper = (text.match(/[千万](里|年|重|丈|古|秋|山)|一日|一夜|三秋/g) || []).length;
  const questions = lines.filter(l => /[何几谁安岂焉怎]/.test(l.clean)).length;
  const clicheHits = CLICHE.filter(c => text.includes(c));
  const lens = lines.map(l => l.clean.length);
  const uniform = lens.every(v => v === lens[0]);
  const conform = (prosody && prosody.conformRate != null && !prosody.partial) ? prosody.conformRate : null;

  // 情感标签（主旨感情 / 风格匹配共用）
  const emoTags = EMOTION_RULES.map(([label, keys]) => ({ label, n: keys.filter(k => text.includes(k)).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).map(x => x.label);
  const lastLine = quoted[quoted.length - 1] || '';
  const sceneEnd = /[山水风月云江天舟柳雁雪霜花鸟烟波星雨桐荷梅竹]/.test(lastLine);

  // ── 五维原始分（各 0–20，拉开区分度）──
  const cl = v => Math.max(0, Math.min(20, v));
  const sceneryCount = (text.match(SCENERY_RE) || []).length;
  const density = text.length ? sceneryCount / text.length : 0;
  // 对句相映：相邻同长句平仄相对（含词 / 古体）
  let parallelPairs = 0;
  for (let i = 1; i < lines.length; i++) {
    const A = [...lines[i - 1].clean], B = [...lines[i].clean];
    if (A.length !== B.length || A.length < 3) continue;
    let opp = 0, cnt = 0;
    for (let j = 0; j < A.length - 1; j++) {
      const ta = toneOf(A[j]).t, tb = toneOf(B[j]).t;
      if (ta && tb) { cnt++; if (ta !== tb) opp++; }
    }
    if (cnt >= 3 && opp / cnt >= 0.55) parallelPairs++;
  }

  const famousHits = lines.filter(l => FAMOUS_SET.has(l.clean)
    || [...FAMOUS_SET].some(f => (f.length >= 6 && l.clean.includes(f)) || (l.clean.length >= 6 && f.includes(l.clean)))).length;
  const famousBonus = famousHits ? Math.min(6, famousHits * 1.5) : 0;

  let theme = 5 + (questions ? 3 : 0) + (allusions.length ? 3 : 0) + famousBonus
    + (emoTags.length ? 2 : 0) + (emoTags.length >= 2 ? 3 : 0)
    + (sceneEnd ? 2 : 0) + (density > 0.2 ? 3 : density > 0.12 ? 2 : 0)
    - Math.min(8, clicheHits.length * 4)
    - (!imageryHits.length && !emoTags.length && !questions ? 4 : 0);
  theme = cl(theme);

  const pairBest = Math.min(4, parallelPairs * 2);
  let rhetoric = 1 + (dup.length ? 4 : 0) + Math.min(5, metaphors * 2) + famousBonus
    + (allusions.length ? 4 : 0) + pairBest + (hyper ? 2 : 0) + (questions ? 2 : 0);
  rhetoric = cl(rhetoric);

  let imagery = 2 + Math.min(7, imageryHits.length * 1.8) + Math.min(8, density * 30) + famousBonus
    + (cats.length >= 2 ? 3 : cats.length ? 1 : 0) + (cats.length >= 3 ? 2 : 0)
    - Math.min(6, clicheHits.length * 3);
  imagery = cl(imagery);

  const formBase = conform != null ? 10 * conform
    : (genre && genre.cipai ? (genre.confidence === '高' ? 9 : 6) : 4);
  let craft = 3 + formBase + (uniform ? 2 : 1) + (sceneEnd ? 2 : 0) + famousBonus
    + (lens.length >= 8 ? 1 : 0) + (questions ? 1 : 0) - Math.min(4, clicheHits.length * 2);
  craft = cl(craft);

  // ── 风格匹配度：本诗与诗人 / 风格流派的契合程度 ──
  const dimEmo = {
    '感时忧世': ['忧国伤时', '悲秋伤逝'], '写意抒情': ['思乡怀人', '送别离情', '闺怨相思'],
    '玄思清远': ['哲理玄思'], '隐逸疏离': ['闲适田园'], '家国情怀': ['忧国伤时', '壮志豪情'],
    '奇崛翻新': ['壮志豪情', '哲理玄思']
  };
  const has = l => emoTags.includes(l);
  let styleScore, styleNote;
  if (poet) {
    let s2 = 10;
    const kind = poet.kind;
    if (/沉郁|顿挫|忧民|讽喻|感时|忧思|讽/.test(kind)) { s2 += (has('忧国伤时') ? 3 : 0) + (has('悲秋伤逝') ? 2 : 0) + (pairBest >= 2 ? 2 : 0); styleNote = '沉郁一路，重顿挫与寄托'; }
    else if (/豪放|豪迈|慷慨|雄浑|沉雄|壮|正气|浩歌|抗节|骨力/.test(kind)) { s2 += (has('壮志豪情') ? 3 : 0) + (hyper ? 2 : 0); styleNote = '豪壮一路，重气象与力度'; }
    else if (/浪漫|飘逸|奇绝|鬼仙|奇崛|才情|绚烂|少年|风流|俊逸/.test(kind)) { s2 += (metaphors >= 2 ? 2 : 0) + (hyper ? 2 : 0) + (questions ? 1 : 0) + (density > 0.18 ? 2 : 0); styleNote = '浪漫奇逸一路，重想象与夸张'; }
    else if (/婉约|深情|绵邈|缠绵|柔|秾艳|深婉|真挚|伤别|哀婉|纤柔/.test(kind)) { s2 += ((has('闺怨相思') || has('送别离情') || has('思乡怀人')) ? 3 : 0) + (dup.length ? 2 : 0) + (sceneEnd ? 2 : 0); styleNote = '婉约深情一路，重声情与细节'; }
    else if (/田园|淡远|闲|清远|疏放|自然|浅远|冲淡|活法/.test(kind)) { s2 += (has('闲适田园') ? 3 : 0) + (clicheHits.length ? 0 : 2) + (density > 0.18 ? 2 : 0); styleNote = '淡远一路，重白描与真趣'; }
    else if (/玄|哲|禅|清空|骚雅|思接|寓言/.test(kind)) { s2 += (has('哲理玄思') ? 3 : 0) + (questions ? 2 : 0); styleNote = '玄思一路，重理趣与留白'; }
    else if (/哀|悲|孤愤|乱世|故国|苦吟|冷|峻|秋思/.test(kind)) { s2 += ((has('悲秋伤逝') || has('忧国伤时')) ? 3 : 0) + (dup.length ? 2 : 0); styleNote = '悲慨一路，重沉着与顿挫'; }
    else { s2 += 2; styleNote = '风格自成一格'; }
    const top2 = poet.traits.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2).map(d => POET_DIMS[d.i]);
    top2.forEach(d => { if ((dimEmo[d] || []).some(e => emoTags.includes(e))) s2 += 1.5; });
    styleScore = cl(s2);
  } else {
    styleScore = cl(5 + Math.min(6, emoTags.length * 2) + Math.min(4, dup.length * 2 + metaphors)
      - (clicheHits.length ? 3 : 0) + (allusions.length ? 2 : 0) + (density > 0.2 ? 2 : 0));
    styleNote = '未匹配诗人档案，按风格自洽度计分';
  }

  // ── 总分：拉伸分布（中间多、两头低的阶梯化正态）──
  const raw = { theme, rhetoric, imagery, craft, style: styleScore };
  const rawTotal = theme + rhetoric + imagery + craft + styleScore;
  const spread = x => Math.max(2, Math.min(99, Math.round(50 + 42 * Math.tanh((x - 56.5) / 18))));
  const total = spread(rawTotal);

  // 五维分数按比例缩放到总分（自洽：五维之和 = 总分）
  const keys = ['theme', 'rhetoric', 'imagery', 'craft', 'style'];
  const dims = {};
  let acc = 0;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) dims[k] = total - acc;
    else { dims[k] = Math.max(0, Math.min(20, Math.round(raw[k] * total / Math.max(1, rawTotal)))); acc += dims[k]; }
  });
  let diff = total - keys.reduce((s, k) => s + dims[k], 0);
  for (let i = 0; diff !== 0 && i < 40; i++) {
    const k = keys[i % 4];
    const d = diff > 0 ? (dims[k] < 20 ? 1 : 0) : (dims[k] > 0 ? -1 : 0);
    dims[k] += d; diff -= d;
  }

  const grade = total >= 90 ? '仙品' : total >= 75 ? '上品' : total >= 60 ? '中品' : total >= 40 ? '下品' : '凡品';

  const q1 = quoted[0] || '';
  const qMid = quoted[Math.floor(quoted.length / 2)] || '';
  const qLast = quoted[quoted.length - 1] || '';
  const imgNames = imageryHits.slice(0, 4).map(i => `「${i.name}」`).join('、') || '「明月」「清风」';
  const dimsP = {
    theme: `全诗以「${q1.slice(0, 7)}」起笔，立意${theme >= 15 ? '高远而有寄托' : theme >= 10 ? '平正，情意真切' : '略显寻常，尚可开掘'}。${questions ? '以问语作波澜（如' + (quoted.find(l => /[何几谁安岂]/.test(l)) || qMid) + '），情感因此不落平板；' : ''}${allusions.length ? `化用${allusions.map(a => '「' + a + '」').join('、')}之典，古今映照；` : ''}${clicheHits.length ? `惟「${clicheHits.join('」「')}」稍落套语，削弱了个人化的发现；` : '未见陈词滥调，情感由自家胸臆流出；'}结尾「${qLast.slice(0, 7)}」${qLast ? '收得' + (theme >= 14 ? '含蓄，余味可咀' : '平实') : ''}。`,
    rhetoric: `修辞上${dup.length ? `叠字（${dup.join('、')}）使声情摇曳，` : ''}${metaphors ? `比喻词（如/似/疑是）${metaphors} 处，取譬${rhetoric >= 15 ? '贴切而新鲜' : '尚称自然'}；` : '以白描为主，不假雕饰；'}${pairBest >= 4 ? '对仗处见功力，两句相反而相成；' : pairBest ? '对仗大体工稳；' : ''}${allusions.length ? '用典而不为典所役，如盐着水。' : '未用典故，语语自出。'}整体${rhetoric >= 15 ? '辞采与情致相称' : '修辞可再丰富一层'}。`,
    imagery: `意象上，诗中${imgNames}构成${cats.length >= 3 ? '多层次的意象群，' : '集中的意象核心，'}色调${imagery >= 15 ? '鲜明' : '清朗'}，${imageryHits.length >= 3 ? '由景生情、情景相生' : '以少总多，留白甚多'}。${clicheHits.length ? `惜「${clicheHits.join('」「')}」意象使用频率过高，新意略减。` : '意象未经人道语，颇具新鲜感。'}「${qMid.slice(0, 7)}」一句最见取象之功。`,
    craft: `技法上${uniform ? '句式整饬' : '句式长短相济'}，${conform != null ? (conform >= 0.85 ? '平仄合律，声情与内容相称' : '格律尚有可调之处，详见格律一节') : (genre && genre.cipai ? '依词谱定格，声情与词调相称' : '体式自由，以气运词')}。章法${lens.length >= 8 ? '取起承转合之正体，中二联撑起全篇' : lens.length === 4 ? '四句起承转合，第三句一转为关键' : '随文气推进，自然成势'}。「${qLast.slice(0, 7)}」作结${craft >= 15 ? '，以景结情 / 以情收束，意在言外' : '，尚可更求言外之味'}。`,
    style: `风格上，本诗${styleNote}。${poet ? `对照${poet.name}（${poet.region}·${poet.kind}）一路：` : ''}${styleScore >= 15 ? '本诗风格鲜明，与其人其派声气相应' : styleScore >= 10 ? '风格大体相合，个别处尚可再突出其特色' : '风格与所宗尚有距离，或未充分展开其标志性的手法'}。`
  };

  const highlight = total >= 90 ? `最打动人处：「${qMid || q1}」——天然浑成，一字不可易。`
    : total >= 75 ? `最打动人处：「${qMid || q1}」——${imageryHits.length ? '取象精准，情景交融' : '情真语挚'}。`
      : total >= 60 ? `最见潜力处：「${qMid || q1}」——若在此处再进一层，全篇生色。`
        : `可着力处：先求语句畅达、意象具体，再论其余。`;

  return { total, grade, dims, raw, rawTotal, paragraphs: dimsP, highlight, styleNote,
    feature: { imageryHits, dup, allusions, clicheHits, metaphors, questions, emoTags, hyper, famousHits } };
}

/* ───────────────────────── 5.5 风格特色 / 主旨感情（诗人档案 + 文本推断） ───────────────────────── */
function findPoet(author) {
  if (typeof POETS === 'undefined' || !author) return null;
  const clean = author.replace(/[（(].*?[）)]/g, '').replace(/[·・\s]/g, '').trim();
  if (!clean) return null;
  return POETS.find(p => clean.includes(p.name) || (p.name.includes(clean) && clean.length >= 2)) || null;
}
const EMOTION_RULES = [
  ['思乡怀人', ['故乡', '故园', '乡心', '乡思', '归思', '思归', '望乡', '忆', '怀人', '故人', '千里', '婵娟']],
  ['羁旅漂泊', ['客', '旅', '孤舟', '漂泊', '驿', '万里', '关山', '天涯', '行路', '征蓬']],
  ['送别离情', ['送', '别', '离', '折柳', '长亭', '灞', '阳关', '执手', '挥手', '孤帆']],
  ['壮志豪情', ['剑', '金戈', '楼兰', '功名', '壮', '胡马', '沙场', '长风', '豪', '破']],
  ['忧国伤时', ['国', '山河', '社稷', '黎民', '忧', '战', '烽火', '兴亡', '黍离', '神州', '干戈']],
  ['闲适田园', ['田', '园', '菊', '东篱', '柴门', '桑麻', '渔樵', '闲', '归去', '南山']],
  ['咏史怀古', ['故国', '英雄', '千秋', '遗', '废', '前朝', '吴宫', '晋', '古']],
  ['闺怨相思', ['妆', '眉', '镜', '帘', '闺', '妾', '相思', '肠断', '泪', '罗']],
  ['悲秋伤逝', ['秋', '落', '暮', '衰', '残', '逝', '花落', '白发', '迟暮', '霜']],
  ['哲理玄思', ['禅', '空', '道', '真意', '梦', '悟', '本来', '何处']]
];

function buildStyleEmotion(art, lines, author, prosody, genre) {
  const poet = findPoet(author);
  const text = lines.map(l => l.clean).join('');
  const f = art.feature;
  const emoTags = (f && f.emoTags) || EMOTION_RULES.map(([label, keys]) => ({ label, n: keys.filter(k => text.includes(k)).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).map(x => x.label);

  const styleChips = [];
  if (f.dup.length) styleChips.push(['声情摇曳', `叠字（${f.dup.join('、')}）复沓，一唱三叹`]);
  if (f.allusions.length) styleChips.push(['典丽雅正', `用典 ${f.allusions.length} 处（${f.allusions.slice(0, 3).join('、')}），以典入诗而不为典所役`]);
  if (f.metaphors >= 2) styleChips.push(['比兴灵动', '比喻、比拟层出，取譬贴切而新鲜']);
  if (f.questions) styleChips.push(['深曲跌宕', '以问语作波澜，不作平铺直叙']);
  if (prosody && prosody.dualPairs && prosody.dualPairs.some(p => p.label === '工对')) styleChips.push(['工整精严', '对仗工稳，律法精严，句句有锤炼之功']);
  if (!f.clicheHits.length && f.imageryHits.length >= 2) styleChips.push(['兴象玲珑', '取象新鲜，意象自成意境']);
  if (!f.allusions.length && !f.dup.length) styleChips.push(['质朴自然', '白描直寻，不假雕饰，语淡而味终不薄']);
  if (art.dims.craft >= 14) styleChips.push(['章法谨严', '起承转合，脉络井然']);
  const chips = styleChips.slice(0, 3);

  let styleHtml = `<div class="tag-row">${chips.map(c => `<span class="tag-type">${esc(c[0])}</span>`).join('')}</div>
    <ul class="evidence-list">${chips.map(c => `<li>${esc(c[1])}</li>`).join('')}</ul>`;

  if (poet) {
    const topDims = poet.traits.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2);
    styleHtml = `
      <div class="poet-mini">
        <div class="poet-mini-head"><b>诗人档案 · ${esc(poet.name)}</b><span class="poet-era-badge">${esc(poet.region)}</span><span class="poet-kind-chip">${esc(poet.kind)}</span></div>
        <div class="poet-quote">${esc(poet.quote)}</div>
        <p>${esc(poet.intro)}</p>
        <p class="poet-one">${esc(poet.one)}</p>
      </div>
      <div class="tag-row">${chips.map(c => `<span class="tag-type">${esc(c[0])}</span>`).join('')}<span class="tag-pri">风格匹配 ${art.dims.style} / 20　气质倾向：${topDims.map(d => esc(POET_DIMS[d.i]) + ' ' + d.v).join(' · ')}</span></div>
      <ul class="evidence-list">${chips.map(c => `<li>${esc(c[1])}</li>`).join('')}</ul>`;
  } else {
    styleHtml = `<div class="note-box">作者「${esc(author || '佚名')}」未见于诗人档案（${typeof POETS !== 'undefined' ? POETS.length : ''} 位，先秦 ~ 近现代），以下为依本诗文本的风格分析。风格匹配 ${art.dims.style} / 20 按风格自洽度计。</div>` + styleHtml;
  }

  const emoCount = emoTags.slice(0, 3);
  let emotionHtml = `<div class="tag-row">${emoCount.map(e => `<span class="tag-type">${esc(e)}</span>`).join('') || '<span class="tag-pri">即景感兴，情旨含蓄</span>'}</div>
    <p>${emoCount.length
      ? `本诗情感主旨以「${emoCount.map(e => esc(e)).join('」「')}」为宗：${esc(lines[Math.floor(lines.length / 2)] ? lines[Math.floor(lines.length / 2)].clean : '')}一句最见情旨，结尾「${esc(lines[lines.length - 1] ? lines[lines.length - 1].clean : '')}」${art.total >= 75 ? '收得沉着，情在言外' : '情感显豁'}。`
      : '本诗不落常见情旨窠臼，情感藏于意象与叙述之中，须于言外求之。'}</p>`;
  if (poet) {
    const topDims = poet.traits.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 3);
    emotionHtml += `<div class="note-box"><b>${esc(poet.name)}的情感底色：</b>${topDims.map(d => esc(POET_DIMS[d.i]) + '（' + d.v + '）').join('、')}<br>${esc(poet.intro)}${esc(poet.one)}</div>`;
  }

  return { styleHtml, emotionHtml, poet };
}

/* ───────────────────────── 6. 改进与借鉴 ───────────────────────── */
function buildRevision(art, prosody, lines, genre) {
  const improve = [], learn = [];
  const ss = lines.map(l => l.clean);

  // 1. 格律 / 押韵问题 → 高优先级
  if (prosody && prosody.rhymeRows) {
    const outs = prosody.rhymeRows.filter(r => r.flags.some(f => /出韵|邻韵通押|非韵脚句末字须仄/.test(f)));
    outs.slice(0, 2).forEach(r => {
      improve.push({
        type: '押韵', priority: '高', original: ss[r.i] || '',
        suggestion: `第${r.i + 1}句末字「${r.ch}」${r.flags[0].replace(/\*\*/g, '')}`,
        reason: `近体诗要求一韵到底（${prosody.rhymeGroups.join('、')}）；此字不在韵部内，破坏了全篇的音响统一。`,
        alternative: `可换一个与「${prosody.rhymeGroups[0]}」同部的字收句；若坚持此意，可把整句改押仄韵（古体做法），或调整句意让韵脚自然落在同部字上。改后此句尾字须与二、四句同部，且注意新旧韵差异。`
      });
    });
    const badPairs = (prosody.dualPairs || []).filter(p => p.label === '失对');
    badPairs.forEach(p => {
      improve.push({
        type: '对仗', priority: '高', original: `${ss[p.a]} / ${ss[p.b]}`,
        suggestion: `第${p.a + 1}、${p.b + 1}句（${p.label}）→ 重排为工对：上下句同位字平仄相反、词性相当`,
        reason: `律诗颔联、颈联须对仗。${p.note}。`,
        alternative: `保留上句，下句按「名—动—名」结构重写；或改作流水对（两句一意贯注），如「即从巴峡穿巫峡，便下襄阳向洛阳」。`
      });
    });
    const lineBad = (prosody.lines || []).filter(l => l.badPos.length || l.flags.length).slice(0, 2);
    lineBad.forEach(l => {
      improve.push({
        type: '格律', priority: '高', original: l.text,
        suggestion: `第${prosody.lines.indexOf(l) + 1}句「${l.badPos.map(i => l.text[i]).join('」「')}」处出律 → 按谱「${l.exp}」换字${l.flags.length ? '；并消除 ' + l.flags.join('、') : ''}`,
        reason: `此处谱式要求${l.badPos.map(i => l.exp[i] + '声').join('、')}，现为${l.badPos.map(i => (l.tones[i].t === 'ping' ? '平' : '仄') + '声').join('、')}，${l.flags.length ? l.flags[0].replace(/\*\*/g, '') : '与标准谱不符'}。`,
        alternative: `一三五不论（七言一三五字、五言一三字）处可就地换字；若不换字，可用「拗救」：本句自救或对句相救。改后请复查粘对。`
      });
    });
  }

  // 2. 意象 / 陈词
  if (art.feature.clicheHits.length) {
    improve.push({
      type: '意象', priority: '中', original: `「${art.feature.clicheHits.join('」「')}」`,
      suggestion: '替换高频套语 → 以具体、个人化的感官细节代之',
      reason: '公共象征使用过频，读者难有新鲜感受。',
      alternative: '例如把「断肠」换作一个具体的动作或物件：「人比黄花瘦」式的具象表达，胜过直接言愁。'
    });
  }
  // 3. 炼字（若不足 3 条，补常规炼字建议）
  if (improve.length < 3) {
    const mid = ss[Math.floor(ss.length / 2)] || ss[0] || '';
    improve.push({
      type: '炼字', priority: '中', original: mid,
      suggestion: `${mid} → 保留骨架，试换动词/形容词中最「实」的一个字`,
      reason: '诗眼常在一处动词或颜色字。逐字掂量：此字能否换成更精确、更意外的那个？',
      alternative: '另一种思路：把陈述句改成呈现句——去掉判断词，让画面自己说话；改后注意该字平仄须合谱。'
    });
  }
  if (!improve.length) {
    improve.push({
      type: '总评', priority: '低', original: '（全篇）',
      suggestion: '无需改动',
      reason: '全诗格律稳、意象新、章法完整。',
      alternative: '可继续磨练的方向：在结句上再求「言外之味」——把直抒的那半句删去，留给读者。'
    });
  }

  // 借鉴
  const f = art.feature;
  if (f.dup.length) {
    learn.push({
      quote: `${f.dup.join('、')}（叠字）`,
      principle: '以声写形：叠字摹声状物，音义兼到，一唱三叹。',
      practice: '仿照此法写一句写景诗，要求：用一组叠字摹写一种声音或形态，叠字须贴合所写之物的质感。'
    });
  }
  if (prosody && prosody.dualPairs && prosody.dualPairs.some(p => p.label !== '失对')) {
    learn.push({
      quote: ss[(prosody.dualPairs[0] || {}).a] + ' / ' + ss[(prosody.dualPairs[0] || {}).b],
      principle: '对仗相反而相成：上下句同位平仄相对、事类相当，张力来自「似而不同」。',
      practice: '仿写一联对仗：上句写景，下句写情；要求同位字词性相同、平仄相反，且两句间有意义的呼应。'
    });
  }
  if (f.imageryHits.length >= 2) {
    learn.push({
      quote: `${f.imageryHits.slice(0, 2).map(i => i.name).join(' + ')}`,
      principle: '意象并置（蒙太奇）：不加连词，让两个意象直接碰撞，意义在缝隙中生成。',
      practice: '选两个意象（一动一静、一大一小），写一句七言诗，句中不出现「和」「与」等连接词。'
    });
  }
  if (f.questions || art.total >= 75) {
    learn.push({
      quote: ss[ss.length - 1] || '',
      principle: '以景结情 / 问而不答：结尾不把话说尽，用画面或问句留下余味。',
      practice: '把任意一句直抒胸臆的结尾改写为「以景结情」：用一个画面作结，情绪藏在画面里。'
    });
  }
  while (learn.length < 2) {
    learn.push({
      quote: ss[0] || '',
      principle: '起句定调：劈空而来的一句，决定全诗的气场。',
      practice: '用「先声夺人」法重写一首旧作的起句：不交代背景，直接抛出一个画面或一声感叹。'
    });
  }
  return { improve: improve.slice(0, 5), learn: learn.slice(0, 4) };
}

/* ───────────────────────── 7. 渲染 ───────────────────────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderToneLine(line, prosodyRow) {
  return [...line].map((ch, i) => {
    const t = toneOf(ch);
    const cls = t.t === 'ping' ? 'ping' : t.t === 'ze' ? 'ze' : 'unknown';
    const mark = t.t === 'ping' ? '—' : t.t === 'ze' ? '|' : '';
    const bad = prosodyRow && prosodyRow.badPos.includes(i);
    return `<span class="char-tone ${cls}" title="${t.raw}${t.poly ? '（多音字）' : ''}${bad ? ' · 出律' : ''}">${esc(ch)}${mark ? `<span class="tone-mark">${mark}</span>` : ''}</span>`;
  }).join('');
}

function renderGenre(out) {
  const g = out;
  return `
    <div class="genre-line">
      <span class="tree">${g.primary.split(/\s*>\s*/).length > 1 ? esc(g.primary.split(/\s*>\s*/)[0]) + ' →' : ''}</span>
      <span class="main-genre">${esc(g.primary.split(/\s*>\s*/).pop())}</span>
      <span class="confidence">置信度 ${g.confidence}</span>
    </div>
    <ul class="evidence-list">${g.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
    ${g.alternatives && g.alternatives.length ? `<div class="alt-genre"><b>亦可能是：</b>${g.alternatives.map(esc).join('、')}<br><span class="muted">区分依据：句数句式与格律特征（粘对、对仗、韵部）的吻合程度不同。</span></div>` : ''}
  `;
}

function boldFlags(str) {
  return esc(str).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function renderProsody(prosody, lines, system, genreOut) {
  const isModern = /现代诗|散文诗|自由诗|俳句|打油|民谣|十四行|维拉内尔/.test(genreOut.primary);
  if (isModern) {
    let extra = '';
    if (genreOut.haikuNoKigo) extra = `<div class="flag-box"><b>缺季语提示：</b>俳句须含季语（如「蛙」「月」「红叶」），本篇未检出，请补季语或注明为变体。</div>`;
    return `<div class="note-box">本篇为${esc(genreOut.primary.split(/\s*>\s*/).pop() || '自由体')}，无固定平仄谱。品鉴侧重：内在节奏、分行语气、意象密度与收束。${extra}</div>`;
  }
  if (!prosody) return `<div class="note-box">未取到格律数据。</div>`;

  const R = prosody;
  const patLines = R.patternSeq.map((p, i) =>
    `<div class="pattern-line">${esc(p)}<span class="rhyme-mark">${/[平]$/.test(p) ? '（韵）' : ''}</span>${i % 2 === 1 ? '<span class="tie-mark">（对）</span>' : i > 0 && i % 2 === 0 ? '<span class="tie-mark">（粘）</span>' : ''}</div>`).join('');

  const rows = (prosody.partial ? [] : R.lines).map((l, i) => `
    <tr>
      <td class="num" data-label="句">${i + 1}</td>
      <td data-label="诗文">${renderToneLine(l.text, l)}${l.badPos.length ? ` <span class="pairing-tag bad">出律 ${l.badPos.length} 字</span>` : ''}</td>
      <td data-label="标准谱">${esc(l.exp)}</td>
      <td data-label="实际平仄">${esc(l.actual)}</td>
      <td data-label="句末">${esc(l.endChar)} · ${toneOf(l.endChar).raw}</td>
    </tr>`).join('');

  const rhymeRows = R.rhymeRows.map(r => `
    <tr>
      <td class="num" data-label="句">${r.i + 1}</td>
      <td data-label="末字"><span class="${r.isRhyme && !r.flags.some(f => /出韵/.test(f)) ? 'rhyme-dot' : ''}${r.flags.some(f => /出韵|非韵脚/.test(f)) ? 'rhyme-out draw' : ''}">${esc(r.ch)}</span></td>
      <td data-label="平仄">${toneOf(r.ch).raw}</td>
      <td data-label="韵部">${esc(r.group)}</td>
      <td data-label="是否押韵">${r.isRhyme ? '押韵' : '不押韵'}</td>
      <td data-label="提示">${r.flags.map(f => `<div class="${f.startsWith('※') ? 'muted' : ''}">${boldFlags(f)}</div>`).join('') || '<span class="muted">—</span>'}</td>
    </tr>`).join('');

  const pairsHtml = (R.dualPairs || []).map(p =>
    `<div><span class="pairing-tag ${p.label === '失对' ? 'bad' : p.label === '工对' ? 'ok' : 'mid'}">${p.label}</span>
     第${p.a + 1}–${p.b + 1}联（${esc(lines[p.a].clean)} / ${esc(lines[p.b].clean)}）<span class="muted">${esc(p.note)}</span></div>`).join('');

  const tieBad = (R.tieDui || []).filter(t => !t.ok);
  const special = [];
  R.lines.forEach((l, i) => l.flags.forEach(f => special.push(`第${i + 1}句：${f}`)));

  const cipai = genreOut && genreOut.cipai;
  const cipaiPu = cipai && cipai.pu && cipai.pu.length ? `
    <div class="pattern-box">
      <h4>词谱 · 《${esc(cipai.name)}》${cipai.tiTitle && cipai.tiTitle !== '正体' ? ' · ' + esc(cipai.tiTitle) : ''} <span class="confidence">${esc(cipai.yunge || '')}</span></h4>
      ${cipai.pu.map(line => `<div class="pattern-line">${esc(line).replace(/（韵）/g, '<span class="rhyme-mark">（韵）</span>').replace(/（叶）/g, '<span class="rhyme-mark">（叶）</span>')}</div>`).join('')}
      <div class="muted" style="margin-top:8px">「平 / 仄」定声，「中」为可平可仄，「（韵）」为押韵位。${esc(cipai.appendix || '')}</div>
      <div class="muted">词谱出自龙榆生《唐宋词格律》（上海古籍出版社 1978 年版）；完整词谱与例词见顶部「词牌查询」页。</div>
    </div>` : '';
  const cipaiHint = genreOut && genreOut.ciLike ? `
    <div class="note-box">本篇句式具备词体特征但未命中 153 词牌定格——建议到顶部「词牌查询」页按句式 / 字数比对，或按减字、摊破、偷声等变体核对。</div>` : '';

  return `
    ${cipaiPu || `<div class="pattern-box">
      <h4>${prosody.partial ? '体式 · ' : '标准格律 · '}${esc(R.patternName)}</h4>
      ${patLines || '<div class="muted">长短句依词谱 / 曲牌定格，逐句平仄以词谱为准；下方逐句分析韵脚与特殊规则。</div>'}
      ${patLines ? '<div class="muted" style="margin-top:8px">⊙ 表示可平可仄；「（韵）」标注押韵位；「（粘）（对）」标注联间关系。</div>' : ''}
    </div>`}
    ${cipaiHint}

    ${rows ? `<h4 style="font-family:var(--serif);letter-spacing:2px;margin:18px 0 10px">本诗实际平仄 · 逐句对照</h4>
    <table class="compare-table">
      <thead><tr><th>句</th><th>诗文（平 — 仄 |）</th><th>标准谱</th><th>实际平仄</th><th>句末</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : ''}

    <h4 style="font-family:var(--serif);letter-spacing:2px;margin:18px 0 10px">韵脚逐句分析 · ${esc(RHYME_SYSTEMS[system].name)}</h4>
    <table class="compare-table">
      <thead><tr><th>句</th><th>末字</th><th>平仄</th><th>韵部</th><th>押韵</th><th>提示</th></tr></thead>
      <tbody>${rhymeRows}</tbody>
    </table>

    ${pairsHtml ? `<h4 style="font-family:var(--serif);letter-spacing:2px;margin:18px 0 10px">对仗检查</h4><div>${pairsHtml}</div>` : ''}
    ${tieBad.length ? `<div class="flag-box"><b>粘对失律：</b>${tieBad.map(t => `第${t.pair[0] + 1}–${t.pair[1] + 1}句（应${t.type}而未${t.type}）`).join('、')}</div>` : ''}
    ${special.length ? `<div class="flag-box"><b>特殊规则提示：</b>${special.map(esc).join('；')}</div>` : ''}
    <div class="note-box">${[
      R.strict ? (R.conformRate != null ? `平仄合律率：<b>${Math.round(R.conformRate * 100)}%</b>${R.unknownChars.length ? `（未收录字 ${R.unknownChars.map(c => '「' + esc(c) + '」').join('')} 不计入统计）` : ''}` : '')
        : (R.rhymeRate != null ? `韵位合规率：<b>${Math.round(R.rhymeRate * 100)}%</b>（宽式判定：未收录字按合韵计，邻韵 / 同词林部 / 同辙均视为合韵）`
          : `韵位判定：<b>宽式</b>（未收录字按合韵计）${R.rhymeSeq && R.rhymeSeq.length ? '　韵部序列：' + R.rhymeSeq.map(g => esc(g === '未收录' ? '未收录' : g)).join(' → ') : ''}`),
      !R.strict && R.rhymeRate == null
        ? (R.yunge ? `本调用韵格：<b>${esc(R.yunge)}</b>——转韵为定格要求` : '词牌待考：词体转韵为常态，不作一韵到底要求')
        : (/转换|错叶|通叶/.test(R.yunge || '') ? `本调用韵格：<b>${esc(R.yunge)}</b>——转韵为定格要求` : `一韵到底：${R.rhymeOneRhyme ? '是' : '<b>否（存在换韵 / 出韵，见上表加粗项）</b>'}`)
    ].filter(Boolean).join('　')}</div>
  `;
}

function renderArt(art) {
  const g = art.grade, score = art.total;
  const aiNote = art.aiEnhanced ? '<div class="ai-badge">AI 鉴赏 · 评分由本地规则引擎给出</div>' : '';
  const sealClass = score >= 90 ? 'g-90' : score >= 75 ? 'g-75' : score >= 60 ? 'g-60' : score >= 40 ? 'g-40' : 'g-0';
  const d = art.dims;
  return `
    ${aiNote}
    <div class="art-dims">
      <div class="art-dim"><h4>主题立意</h4><p>${esc(art.paragraphs.theme)}</p></div>
      <div class="art-dim"><h4>修辞</h4><p>${esc(art.paragraphs.rhetoric)}</p></div>
      <div class="art-dim"><h4>意象</h4><p>${esc(art.paragraphs.imagery)}</p></div>
      <div class="art-dim"><h4>手法</h4><p>${esc(art.paragraphs.craft)}</p></div>
      <div class="art-dim"><h4>风格匹配</h4><p>${esc(art.paragraphs.style)}</p></div>
    </div>
    <div class="art-tags">
      <div class="art-tab">
        <h4><span class="tag-type">风格特色</span></h4>
        <div>${art.styleHtml || ''}</div>
      </div>
      <div class="art-tab">
        <h4><span class="tag-type">主旨感情</span></h4>
        <div>${art.emotionHtml || ''}</div>
      </div>
    </div>
    <div class="score-stage">
      <div class="seal-stamp ${sealClass}" title="综合评级印章">
        <div class="grade">${g}</div>
        <div class="score">${score} / 100</div>
      </div>
      <div class="score-bars">
        <div class="score-row"><span class="name">主题立意</span><span class="bar"><span class="fill" style="width:${d.theme / 20 * 100}%"></span></span><span class="val">${d.theme} / 20</span></div>
        <div class="score-row"><span class="name">修辞手法</span><span class="bar"><span class="fill" style="width:${d.rhetoric / 20 * 100}%"></span></span><span class="val">${d.rhetoric} / 20</span></div>
        <div class="score-row"><span class="name">意象营造</span><span class="bar"><span class="fill" style="width:${d.imagery / 20 * 100}%"></span></span><span class="val">${d.imagery} / 20</span></div>
        <div class="score-row"><span class="name">技法章法</span><span class="bar"><span class="fill" style="width:${d.craft / 20 * 100}%"></span></span><span class="val">${d.craft} / 20</span></div>
        <div class="score-row"><span class="name">风格匹配</span><span class="bar"><span class="fill" style="width:${d.style / 20 * 100}%"></span></span><span class="val">${d.style} / 20</span></div>
      </div>
    </div>
    <div class="highlight-line">${esc(art.highlight)}</div>
  `;
}

function renderRevision(rev) {
  const imp = rev.improve.map(it => `
    <div class="improve-item">
      <div class="improve-head">
        <span class="tag-type">${esc(it.type)}</span>
        <span class="tag-pri ${it.priority === '高' ? 'high' : ''}">优先级 ${it.priority}</span>
      </div>
      <div class="rowline"><span class="lbl">原句</span><code>${esc(it.original)}</code></div>
      <div class="rowline"><span class="lbl">建议</span>${esc(it.suggestion)}</div>
      <div class="rowline"><span class="lbl">理由</span>${esc(it.reason)}</div>
      <div class="rowline"><span class="lbl">另一种思路</span>${esc(it.alternative)}</div>
    </div>`).join('');
  const learn = rev.learn.map(it => `
    <div class="learn-item">
      <div class="quote">「${esc(it.quote)}」</div>
      <div class="principle"><b>可学习的原理：</b>${esc(it.principle)}</div>
      <div class="practice"><b>仿写练习：</b>${esc(it.practice)}</div>
    </div>`).join('');
  return `<h4 style="font-family:var(--serif);letter-spacing:2px;margin-bottom:12px">改进（按优先级排序）</h4>${imp}
    <h4 style="font-family:var(--serif);letter-spacing:2px;margin:22px 0 12px">借鉴（可迁移的写作原理）</h4>${learn}`;
}

/* ───────────────────────── 8. 主流程 ───────────────────────── */
let lastReport = null;
let aiMode = false;

function toast(msg, ms) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 4600);
}

/* ───────── AI 增强鉴赏（调用鉴赏接口 = AI 创作页配置的同一 API） ───────── */
function buildAppreciationPrompt(r) {
  const poet = r.art && r.art.poet;
  const ctx = [
    `题目：${r.title}${r.author ? '　作者：' + r.author : ''}`,
    `正文：\n${r.body}`,
    `体裁判定：${r.genre.primary}（置信度 ${r.genre.confidence}）`,
    r.prosody ? `格律：${r.prosody.patternName}；合律率 ${r.prosody.conformRate != null ? Math.round(r.prosody.conformRate * 100) + '%' : '—'}；韵部 ${(r.prosody.rhymeGroups || []).join('、') || '—'}` : '格律：自由体',
    `本地评分：${r.art.grade}（${r.art.total}/100）`,
    `已识别意象：${(r.art.feature.imageryHits || []).map(i => i.name).join('、') || '—'}；情感标签：${(r.art.feature.emoTags || []).join('、') || '—'}`,
    poet ? `诗人档案：${poet.name}（${poet.region}·${poet.kind}）— ${poet.intro}` : ''
  ].filter(Boolean).join('\n');
  return `你是一位资深古典文学编辑与诗词鉴赏专家。请基于下面这首诗与初步分析，给出高质量鉴赏与改进建议。\n\n${ctx}\n\n严格输出 JSON，不要任何额外文字、不要 markdown 代码块，结构如下：\n{\n  "commentary": {\n    "theme": "主题立意评述，120-250字，须结合原句举例",\n    "rhetoric": "修辞手法评述，120-250字",\n    "imagery": "意象营造评述，120-250字",\n    "craft": "技法章法评述，120-250字",\n    "style": "风格特色（结合诗人/流派），80-150字",\n    "emotion": "主旨感情，80-150字",\n    "highlight": "一句话点明最打动人的地方"\n  },\n  "improve": [\n    {"type":"炼字/意象/格律/章法","priority":"高/中/低","original":"原句","suggestion":"建议，具体到字词句","reason":"理由","alternative":"另一种思路，含至少一个替代方案"}\n  ],\n  "learn": [\n    {"quote":"出彩原句","principle":"可迁移的写作原理","practice":"仿写练习模板"}\n  ]\n}\n要求：improve 3-5 条、learn 2-4 条；评述结合原句；改进具体到字词，禁止空话。`;
}
function parseAppreciation(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const obj = JSON.parse(t.slice(s, e + 1));
    return (obj && obj.commentary) ? obj : null;
  } catch (err) { return null; }
}
async function enhanceAppreciation(report) {
  const cfg = getAICfg();
  if (!cfg) return null;
  const raw = await callLLM(buildAppreciationPrompt(report), cfg);
  return parseAppreciation(raw);
}
function applyAppreciation(ai, report) {
  const c = ai.commentary || {};
  const art = report.art, rev = report.rev;
  art.aiEnhanced = true;
  if (c.theme) art.paragraphs.theme = c.theme;
  if (c.rhetoric) art.paragraphs.rhetoric = c.rhetoric;
  if (c.imagery) art.paragraphs.imagery = c.imagery;
  if (c.craft) art.paragraphs.craft = c.craft;
  if (c.style) art.paragraphs.style = c.style;
  if (c.highlight) art.highlight = c.highlight;
  art.styleHtml = `<p>${esc(c.style || '')}</p>`;
  art.emotionHtml = `<p>${esc(c.emotion || '')}</p>`;
  if (Array.isArray(ai.improve) && ai.improve.length) {
    rev.improve = ai.improve.slice(0, 5).map(it => ({
      type: it.type || '改进', priority: it.priority || '中',
      original: it.original || '', suggestion: it.suggestion || '',
      reason: it.reason || '', alternative: it.alternative || ''
    }));
  }
  if (Array.isArray(ai.learn) && ai.learn.length) {
    rev.learn = ai.learn.slice(0, 4).map(it => ({
      quote: it.quote || '', principle: it.principle || '', practice: it.practice || ''
    }));
  }
}

function judge() {
  const title = $('#in-title').value.trim();
  const author = $('#in-author').value.trim();
  const body = $('#in-body').value;
  const expect = $('#in-expect').value;

  if (!title) { alert('请填写题目'); $('#in-title').focus(); return; }
  if (!body.trim()) { alert('请填写正文'); $('#in-body').focus(); return; }

  const system = ($('input[name="rhyme"]:checked') || {}).value || 'pingshui';
  const isWestern = system === 'western' || !hasCJK(body);
  const lines = (isWestern
    ? body.split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).map(x => ({ text: x, clean: x.replace(/[^\u4e00-\u9fffA-Za-z'\u2019\s]/g, ''), chars: [...x] }))
    : parseBody(body)).filter(l => l.clean);
  if (!lines.length) { alert('未解析到有效诗句'); return; }

  let genre = isWestern ? detectWestern(lines, body) : detectChinese(lines, title, body, expect);
  if (isWestern && expect && expect !== 'auto') {
    if (genre.primary.includes(expect)) genre.evidence.push(`与指定体裁「${expect}」一致`);
    else genre.evidence.push(`（用户期望体裁「${expect}」，当前自动判定为「${genre.primary}」，以自动判定的西方格律为准）`);
  }

  let prosody = null, art, rev;
  if (!isWestern && !genre.noProsody && !/现代诗|散文诗|自由诗/.test(genre.primary)) {
    prosody = genre._prosody || analyzeProsody(lines.map(l => l.clean), genre.primary,
      genre.cipai && genre.cipai.rhymeIdx, genre.cipai);
  }
  art = analyzeArt(lines, prosody, genre, findPoet(author));
  const se = buildStyleEmotion(art, lines, author, prosody, genre);
  art.styleHtml = se.styleHtml; art.emotionHtml = se.emotionHtml; art.poet = se.poet;
  rev = buildRevision(art, prosody, lines, genre);
  lastReport = { title, author, body, system, genre, prosody, art, rev, lines };

  $('#report-poem').textContent = `《${title}》${author ? ' · ' + author : ''}`;
  $('#genre-out').innerHTML = renderGenre(genre);
  $('#prosody-out').innerHTML = renderProsody(prosody, lines, system, genre);
  $('#art-out').innerHTML = renderArt(art);
  $('#revise-out').innerHTML = renderRevision(rev);
  $('#report').hidden = false;

  // 朱批展开：卡片自上而下依次淡入
  ['card-a', 'card-b', 'card-c', 'card-d'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('revealed');
    setTimeout(() => el.classList.add('revealed'), 80 + i * 260);
  });
  $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // AI 增强：体裁/格律/评分已由本地引擎给出，评述与改进建议调用鉴赏接口
  if (aiMode) {
    const artHtml = $('#art-out').innerHTML;
    const revHtml = $('#revise-out').innerHTML;
    $('#art-out').innerHTML = '<div class="note-box ai-loading">🤖 AI 增强鉴赏生成中……（体裁 / 格律 / 评分已由本地规则引擎给出）</div>' + artHtml;
    $('#revise-out').innerHTML = '<div class="note-box ai-loading">🤖 AI 改进与借鉴生成中……</div>' + revHtml;
    enhanceAppreciation(lastReport).then(ai => {
      if (ai) {
        applyAppreciation(ai, lastReport);
        $('#art-out').innerHTML = renderArt(lastReport.art);
        $('#revise-out').innerHTML = renderRevision(lastReport.rev);
        toast('AI 增强鉴赏完成（' + esc((getAICfg() || {}).model || '') + '）。');
      } else {
        $('#art-out').innerHTML = artHtml;
        $('#revise-out').innerHTML = revHtml;
        toast('AI 未返回可解析结果，已保留本地评述。');
      }
    }).catch(err => {
      $('#art-out').innerHTML = artHtml;
      $('#revise-out').innerHTML = revHtml;
      toast('AI 鉴赏请求失败：' + esc(err && err.message || err) + '（可能为 CORS / 密钥），已回落本地评述。');
    });
  }
}

/* ───────────────────────── 9. 打印 / 导出为笺 ───────────────────────── */
function printLetter() {
  if (!lastReport) return;
  const { title, author, genre, art, rev, prosody, lines } = lastReport;
  const sheet = $('#letter-sheet');
  sheet.innerHTML = `
    <div class="letter-inner">
      <div class="letter-title">诗镜品鉴笺 · ${esc(title)}</div>
      <div class="l-section"><h4>壹 · 体裁</h4><div>${esc(genre.primary)}（置信度 ${genre.confidence}）</div></div>
      <div class="l-section"><h4>贰 · 格律</h4><div>${prosody ? esc(prosody.patternName) + ' · 合律率 ' + Math.round(prosody.conformRate * 100) + '%' : '自由体，无固定格律'}</div></div>
      <div class="l-section"><h4>叁 · 评级</h4><div>${art.grade}（${art.total} / 100）· ${esc(art.highlight)}</div></div>
      <div class="l-section"><h4>肆 · 改进</h4><div>${rev.improve.map(i => '· ' + esc(i.type) + '：' + esc(i.suggestion)).join('<br>')}</div></div>
      <div class="letter-close">诗镜 · Poetry Lens　谨识</div>
    </div>
    <div class="letter-actions">
      <button class="btn primary" onclick="window.print()">打印 / 存为 PDF</button>
      <button class="btn" id="btn-close-letter">返回报告</button>
    </div>`;
  sheet.hidden = false;
  sheet.classList.add('printing');
  $('#btn-close-letter').onclick = () => { sheet.classList.remove('printing'); sheet.hidden = true; };
}

/* ───────────────────────── 9.5 导出图片（移动端可用） ───────────────────────── */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 1500);
}

function drawJian(ctx, W, PAD, R) {
  const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif';
  const INK = '#211C18', INK2 = '#6B6157', CINNABAR = '#A8352A', STONE = '#4C6572';
  const RULE2 = '#D4C7AE';
  const contentW = W - PAD * 2, center = PAD + contentW / 2;
  let y = PAD + 6;

  function wrap(text, size, maxW) {
    ctx.font = `${size}px ${SERIF}`;
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      let line = '';
      for (const ch of para) {
        if (line && ctx.measureText(line + ch).width > maxW) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    }
    return out;
  }
  function rr(x, yy, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, yy);
    ctx.arcTo(x + w, yy, x + w, yy + h, r);
    ctx.arcTo(x + w, yy + h, x, yy + h, r);
    ctx.arcTo(x, yy + h, x, yy, r);
    ctx.arcTo(x, yy, x + w, yy, r);
    ctx.closePath();
  }
  function drawSection(label, val, yy) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CINNABAR; ctx.font = `25px ${SERIF}`;
    ctx.fillText(label, PAD, yy + 25); yy += 40;
    wrap(val, 27, contentW).forEach(w => {
      ctx.fillStyle = INK; ctx.font = `27px ${SERIF}`;
      ctx.fillText(w, PAD + 24, yy + 27); yy += 46;
    });
    return yy + 18;
  }

  // 眉标
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CINNABAR; ctx.font = `26px ${SERIF}`;
  ctx.fillText('诗 镜 · 品 鉴 笺', center, y + 22); y += 52;
  // 题目 / 作者
  ctx.fillStyle = INK; ctx.font = `bold 50px ${SERIF}`;
  ctx.fillText(`《${R.title}》`, center, y + 50); y += 74;
  if (R.author) {
    ctx.fillStyle = INK2; ctx.font = `25px ${SERIF}`;
    ctx.fillText(`—— ${R.author}`, center, y + 25); y += 48;
  }
  // 正文
  y += 12;
  R.body.split('\n').filter(s => s.trim()).forEach(l => {
    wrap(l, 35, contentW).forEach(w => {
      ctx.fillStyle = INK; ctx.font = `35px ${SERIF}`;
      ctx.fillText(w, center, y + 35); y += 68;
    });
  });
  // 分隔线
  y += 10;
  ctx.strokeStyle = RULE2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 40;
  // 壹 体裁 / 贰 格律
  const g = R.genre;
  y = drawSection('壹 · 体裁', `${g.primary}（置信度 ${g.confidence}）`, y);
  const pros = R.prosody && R.prosody.patternName
    ? `${R.prosody.patternName} · 合律率 ${Math.round((R.prosody.conformRate || 0) * 100)}%`
    : '自由体，无固定平仄谱';
  y = drawSection('贰 · 格律', pros, y);
  // 叁 评级
  ctx.textAlign = 'left';
  ctx.fillStyle = CINNABAR; ctx.font = `25px ${SERIF}`;
  ctx.fillText('叁 · 评级', PAD, y + 25); y += 46;
  const art = R.art;
  const seal = 128, sx = PAD + 8, sy = y;
  rr(sx, sy, seal, seal, 12); ctx.fillStyle = CINNABAR; ctx.fill();
  ctx.fillStyle = '#F6F1E7'; ctx.textAlign = 'center';
  ctx.font = `bold 52px ${SERIF}`; ctx.fillText(art.grade, sx + seal / 2, sy + 64);
  ctx.font = `22px ${SERIF}`; ctx.fillText(`${art.total}/100`, sx + seal / 2, sy + 100);
  const dims = [['主题立意', art.dims.theme], ['修辞手法', art.dims.rhetoric], ['意象营造', art.dims.imagery], ['技法章法', art.dims.craft], ['风格匹配', art.dims.style]];
  const bx = sx + seal + 36, barW = W - PAD - bx - 110;
  let by = y + 14;
  dims.forEach(d => {
    ctx.textAlign = 'left'; ctx.fillStyle = INK2; ctx.font = `22px ${SERIF}`;
    ctx.fillText(d[0], bx, by + 22);
    const trackX = bx + 150, trackY = by + 6, trackH = 16;
    rr(trackX, trackY, barW, trackH, 8); ctx.fillStyle = '#E7DECB'; ctx.fill();
    rr(trackX, trackY, Math.max(6, barW * d[1] / 20), trackH, 8); ctx.fillStyle = STONE; ctx.fill();
    ctx.fillStyle = INK2; ctx.font = `20px ${SERIF}`; ctx.fillText(`${d[1]}/20`, trackX + barW + 14, by + 22);
    by += 38;
  });
  y = Math.max(y + seal + 16, by + 6);
  if (art.highlight) {
    wrap('「' + art.highlight + '」', 25, contentW).forEach(w => {
      ctx.fillStyle = STONE; ctx.font = `italic 25px ${SERIF}`;
      ctx.fillText(w, PAD, y + 25); y += 42;
    });
  }
  y += 14;
  // 肆 改进
  ctx.textAlign = 'left';
  ctx.fillStyle = CINNABAR; ctx.font = `25px ${SERIF}`;
  ctx.fillText('肆 · 改进', PAD, y + 25); y += 44;
  (R.rev.improve || []).slice(0, 3).forEach(it => {
    wrap(`· ${it.type}：${it.suggestion}`, 25, contentW).forEach(w => {
      ctx.fillStyle = INK; ctx.font = `25px ${SERIF}`;
      ctx.fillText(w, PAD + 12, y + 25); y += 40;
    });
    y += 6;
  });
  // 落款
  y += 12;
  ctx.strokeStyle = RULE2; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 44;
  ctx.textAlign = 'center'; ctx.fillStyle = INK2; ctx.font = `24px ${SERIF}`;
  ctx.fillText('诗镜 · Poetry Lens　谨识', center, y + 24);
  return y + 40;
}

function exportReportImage() {
  if (!lastReport) { toast('请先点击「开始品鉴」生成报告'); return; }
  const R = lastReport;
  const W = 1080, PAD = 84;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = 2000;
  let ctx = canvas.getContext('2d');
  const bottom = drawJian(ctx, W, PAD, R); // 测量总高
  const H = Math.ceil(bottom + PAD);
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F6F1E7'; ctx.fillRect(0, 0, W, H); // 纸底
  drawJian(ctx, W, PAD, R); // 内容
  // 双线边框 + 朱砂角标
  ctx.strokeStyle = '#D4C7AE'; ctx.lineWidth = 2; ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = '#E2D9C8'; ctx.lineWidth = 1; ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.fillStyle = '#A8352A'; ctx.fillRect(28, 28, 8, 66); ctx.fillRect(28, 28, 66, 8);

  canvas.toBlob(blob => {
    const fname = `诗镜_品鉴笺_${R.title}.png`;
    let file = null;
    try { file = new File([blob], fname, { type: 'image/png' }); } catch (e) { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '诗镜 · 品鉴笺', text: `《${R.title}》品鉴笺` })
        .then(() => toast('已导出 / 分享图片'))
        .catch(() => { downloadBlob(blob, fname); toast('已导出图片'); });
    } else {
      downloadBlob(blob, fname);
      toast('已导出图片（可保存到相册）');
    }
  }, 'image/png');
}

/* ───────────────────────── 10. 体裁学堂 ───────────────────────── */
function renderSchoolTree() {
  const tree = $('#school-tree');
  const make = (branchName, items) => `
    <div class="tree-branch"><h4>${branchName}</h4>
      ${items.map(g => `<button class="tree-item" data-gid="${g.id}">${esc(g.name)}</button>`).join('')}
    </div>`;
  tree.innerHTML = make('中国诗歌', SCHOOL.cn) + make('西方诗歌', SCHOOL.west);
  tree.addEventListener('click', e => {
    const btn = e.target.closest('.tree-item');
    if (!btn) return;
    $$('.tree-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderSchoolPage(btn.dataset.gid);
  });
  renderSchoolPage('wujue');
  tree.querySelector('.tree-item').classList.add('active');
}
function renderSchoolPage(gid) {
  const g = [...SCHOOL.cn, ...SCHOOL.west].find(x => x.id === gid);
  if (!g) return;
  const r = g.rules;
  $('#school-content').innerHTML = `
    <h2>${esc(g.name)}</h2>
    <div class="sub">${esc(g.overview.slice(0, 40))}……</div>
    <div class="school-section"><h3>一 · 概述</h3><p>${esc(g.overview)}</p></div>
    <div class="school-section"><h3>二 · 格律规范</h3>
      <ul>
        <li><b>句数：</b>${esc(r.count)}</li>
        <li><b>字数：</b>${esc(r.chars)}</li>
        <li><b>平仄：</b>${esc(r.pingze)}</li>
        <li><b>押韵：</b>${esc(r.rhyme)}</li>
        <li><b>对仗：</b>${esc(r.duel)}</li>
        <li><b>禁忌：</b><b style="color:var(--cinnabar)">${esc(r.taboo)}</b></li>
      </ul>
    </div>
    <div class="school-section"><h3>三 · 写作手法</h3><ul>${g.techniques.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="school-section"><h3>四 · 标准范例（逐句图注）</h3>
      ${g.examples.map(ex => `
        <div class="example-card"><h4>${esc(ex.title)}</h4>
          ${ex.lines.map(l => `<div class="ex-line"><div class="txt">${esc(l.t)}</div><div class="anno">${esc(l.a)}</div></div>`).join('')}
        </div>`).join('')}
    </div>
    <div class="school-section"><h3>五 · 常见错误</h3><ul>${g.mistakes.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
  `;
  $('#school-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ───────────────────────── 11. 辞典 ───────────────────────── */
const COMMON_WORDS = {
  '风': ['清风', '春风', '西风', '风雨'], '月': ['明月', '孤月', '月明', '残月'],
  '山': ['青山', '空山', '寒山', '山色'], '水': ['流水', '秋水', '烟水', '江水'],
  '花': ['落花', '黄花', '飞花', '花影'], '云': ['白云', '孤云', '云彩', '烟云'],
  '天': ['青天', '江天', '天涯', '霜天'], '人': ['故人', '幽人', '行人', '佳人'],
  '心': ['冰心', '寸心', '心远', '惊心'], '声': ['笛声', '猿声', '雨声', '声慢'],
  '来': ['归来', '春来', '夜来', '自来'], '时': ['时节', '几时', '旧时', '当时'],
  '空': ['碧空', '空山', '夜空', '空明'], '明': ['明月', '明烛', '分明', '明明'],
  '秋': ['秋风', '秋水', '悲秋', '清秋'], '春': ['春山', '春风', '春芳', '春色'],
  '楼': ['高楼', '危楼', '江楼', '西楼'], '舟': ['孤舟', '轻舟', '扁舟', '渔舟'],
  '柳': ['杨柳', '衰柳', '柳色', '折柳'], '雪': ['飞雪', '暮雪', '雪净', '风雪']
};
const ALL_GROUPS = [
  ...PING_GROUPS.map(g => ({ ...g, cat: '平声' })),
  ...SHANG_GROUPS.map(g => ({ ...g, cat: '上声' })),
  ...QU_GROUPS.map(g => ({ ...g, cat: '去声' })),
  ...RU_GROUPS.map(g => ({ ...g, cat: '入声' }))
];

function dictCharLookup() {
  const ch = $('#dict-char').value.trim().slice(0, 1);
  const box = $('#char-result');
  if (!ch) { box.innerHTML = '<div class="muted">请输入一个汉字。</div>'; return; }
  const t = toneOf(ch);
  const g = ALL_GROUPS.find(x => x.chars.includes(ch));
  const poly = POLY_CHARS[ch];
  box.innerHTML = `
    <div class="result-card">
      <div class="char-big">${esc(ch)}</div>
      <h4>读音与平仄</h4>
      <p>${poly ? poly.readings.map(r => `<b>${r[0]}</b>（${r[1]}）${esc(r[2] || '')}`).join('<br>') : `<b>${t.raw}</b>${t.ru ? '（入声字，短促急收）' : ''}`}</p>
      <h4 style="margin-top:10px">韵部</h4>
      <p>平水韵：<b>${esc(g ? g.id : '未收录')}</b>${g ? '（' + g.cat + '）' : ''}<br>
         词林正韵：${g && g.cl ? esc(CILIN_DESC[g.cl] || '') : '未收录'}<br>
         十三辙：${esc(g && g.sz ? g.sz : '未收录')}　中华新韵（参考）：${esc(g && g.xn ? g.xn : '未收录')}</p>
      <h4 style="margin-top:10px">常见组词</h4>
      <div class="word-chips">${(COMMON_WORDS[ch] || []).map(w => `<span class="word-chip ping">${esc(w)}</span>`).join('') || '<span class="muted">暂未收录，欢迎补充</span>'}</div>
      ${poly ? '<div class="flag-box"><b>该字存在平仄两读，请人工确认</b>（语境优先判定，报告中亦加粗提示）</div>' : ''}
    </div>`;
}

function dictGroupLookup() {
  const id = $('#dict-group').value;
  const g = ALL_GROUPS.find(x => x.id === id);
  const box = $('#group-result');
  if (!g) return;
  const chars = [...g.chars];
  const ping = chars.filter(c => toneOf(c).t === 'ping');
  const ze = chars.filter(c => toneOf(c).t !== 'ping');
  box.innerHTML = `
    <div class="result-card">
      <h4>${esc(g.id)}（${esc(g.cat)}）</h4>
      ${g.mood ? `<p><b>情感色彩：</b>${esc(g.mood)}</p>` : ''}
      ${g.cl ? `<p class="muted">词林正韵：${esc(CILIN_DESC[g.cl] || '')}　·　十三辙：${esc(g.sz || '—')}</p>` : ''}
      <p><b>平声字：</b></p>
      <div class="word-chips">${ping.map(c => `<span class="word-chip ping">${esc(c)}</span>`).join('') || '—'}</div>
      <p style="margin-top:10px"><b>仄声字：</b></p>
      <div class="word-chips">${ze.map(c => `<span class="word-chip">${esc(c)}</span>`).join('') || '—'}</div>
    </div>`;
}

function dictImageLookup() {
  const cat = $('#image-cat').value;
  const key = $('#image-key').value.trim();
  const box = $('#image-result');
  let hits = IMAGE_LIB.filter(im => (cat === 'all' || im.cat === cat) && (!key || im.name.includes(key) || im.meaning.includes(key) || im.collocs.some(c => c.includes(key))));
  if (!hits.length) { box.innerHTML = '<div class="muted">未找到相关意象，试试「孤舟」「杜鹃」「秋水」。</div>'; return; }
  box.innerHTML = `<div class="image-grid">${hits.map(im => `
    <div class="image-card">
      <h4>${esc(im.name)}</h4>
      <div class="meta">${esc(im.cat)} · ${esc(im.mood)}</div>
      <p>${esc(im.meaning)}</p>
      <p class="muted">常见搭配：${im.collocs.map(c => '「' + esc(c) + '」').join(' ')}</p>
      ${im.quotes.map(q => `<div class="quote">— ${esc(q)}</div>`).join('')}
    </div>`).join('')}</div>`;
}

function initCompose() {
  $('#compose-methods').innerHTML = COMPOSE_METHODS.map((m, i) =>
    `<button class="method-btn ${i === 0 ? 'active' : ''}" data-mk="${m.key}">${esc(m.name)}</button>`).join('');
  $('#compose-methods').addEventListener('click', e => {
    const b = e.target.closest('.method-btn');
    if (!b) return;
    $$('.method-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderComposeStage(b.dataset.mk);
  });
  renderComposeStage('verb');
}
function renderComposeStage(mk) {
  const m = COMPOSE_METHODS.find(x => x.key === mk) || COMPOSE_METHODS[0];
  const picks = [...IMAGE_LIB].sort(() => Math.random() - 0.5).slice(0, 2);
  $('#compose-stage').innerHTML = `
    <h4>${esc(m.name)}</h4>
    <p class="muted">${m.desc}</p>
    <div class="prompt-imgs">${picks.map(p => '「' + esc(p.name) + '」').join('　＋　')}</div>
    <p class="muted">${esc(m.tip)}</p>
    <div class="inline-form wide" style="margin-top:14px">
      <input type="text" id="compose-input" placeholder="补写一句诗，如：孤舟泊寒渡">
      <button class="btn primary" id="btn-compose-check">评点</button>
    </div>
    <div id="compose-fb"></div>`;
  $('#btn-compose-check').onclick = () => {
    const v = $('#compose-input').value.trim();
    const fb = $('#compose-fb');
    if (!v) { fb.innerHTML = '<div class="feedback muted">先写一句再来。</div>'; return; }
    const len = cjkCount(v);
    const hasBoth = picks.every(p => v.includes(p.name) || p.collocs.some(c => v.includes(c)));
    const lastCh = [...v][[...v].length - 1];
    const lastT = toneOf(lastCh);
    const tri = [...v].slice(-3).map(c => toneOf(c).t).join('');
    const notes = [];
    notes.push(`句长 ${len} 字${len === 5 || len === 7 ? '，合五/七言 ✔' : '，五言 / 七言更佳'}`);
    notes.push(hasBoth ? '两个意象都用上了 ✔' : `意象未用全：请设法带入「${picks.map(p => p.name).join('」「')}」`);
    if (tri === 'pingpingping') notes.push('⚠ 句末三平（三平调），请调整尾字');
    else notes.push(`尾字「${lastCh}」为${lastT.raw}，${lastT.t === 'ping' ? '可作韵脚' : '宜作非韵句收束'}`);
    const score = (len === 5 || len === 7 ? 40 : 20) + (hasBoth ? 40 : 10) + (tri === 'pingpingping' ? 0 : 20);
    fb.innerHTML = `<div class="feedback"><b>即时反馈（${score} / 100）</b><ul style="padding-left:20px;margin-top:8px">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="muted" style="margin-top:8px">提示：${esc(COMPOSE_METHODS.find(x => x.key === mk).tip)}</p></div>`;
  };
}

/* ───────────────────────── 11.5 词牌查询（龙榆生《唐宋词格律》） ───────────────────────── */
function renderCipaiTree() {
  const key = ($('#cipai-key').value || '').trim();
  const yg = $('#cipai-yunge').value;
  const hits = (typeof CIPAI_FULL !== 'undefined' ? CIPAI_FULL : []).filter(c =>
    (yg === 'all' || c.yunge === yg) &&
    (!key || c.name.includes(key) || c.aliases.some(a => a.includes(key))));
  const byG = {};
  hits.forEach(c => { (byG[c.yunge || '其他'] = byG[c.yunge || '其他'] || []).push(c); });
  const tree = $('#cipai-tree');
  tree.innerHTML = Object.entries(byG).map(([g, list]) => `
    <div class="tree-branch"><h4>${esc(g)}（${list.length}）</h4>
      ${list.map(c => `<button class="tree-item" data-cid="${c.id}">${esc(c.name)} <small class="muted">${c.zishu}字</small></button>`).join('')}
    </div>`).join('') || '<div class="muted" style="padding:12px">无匹配词牌，试试「浣溪沙」「满江红」。</div>';
}

function renderCipaiDetail(id) {
  const c = (typeof CIPAI_FULL !== 'undefined' ? CIPAI_FULL : []).find(x => x.id === +id);
  if (!c) return;
  $('#cipai-content').innerHTML = `
    <h2>《${esc(c.name)}》</h2>
    <div class="sub">${c.aliases.length ? '又名 ' + c.aliases.map(a => '《' + esc(a) + '》').join('、') + '　·　' : ''}<b>${esc(c.yunge || '')}</b>　·　${c.zishu} 字　·　${c.tis.length} 体</div>
    <div class="school-section"><h3>一 · 格律说明</h3><p>${esc(c.desc)}</p>${c.appendix ? `<div class="note-box">${esc(c.appendix)}</div>` : ''}</div>
    <div class="school-section"><h3>二 · 词谱</h3>
      ${c.tis.map((ti, i) => `
        <div class="example-card">
          <h4>${esc(ti.title)}${i === 0 && c.tis.length > 1 ? '（多作正体）' : ''}　<span class="muted">句式 ${ti.pattern.join('、')}｜押韵 第 ${ti.rhymeIdx.map(x => x + 1).join('、')} 句</span></h4>
          ${ti.pu.map(line => `<div class="pattern-line">${esc(line).replace(/（韵）/g, '<span class="rhyme-mark">（韵）</span>').replace(/（叶）/g, '<span class="rhyme-mark">（叶）</span>')}</div>`).join('')}
        </div>`).join('')}
    </div>
    <div class="school-section"><h3>三 · 例词（《唐宋词格律》选）</h3>
      ${c.examples.map(ex => `
        <div class="example-card">
          <h4>${esc(ex.author)}</h4>
          ${ex.text.split('\n').map(t => t.trim() ? `<div class="ex-line"><div class="txt">${esc(t.trim())}</div></div>` : '').join('')}
        </div>`).join('')}
    </div>
    <div class="school-section"><h3>四 · 来源</h3>
      <p class="muted">词谱与例词整理自 <a href="${c.url}" target="_blank" rel="noopener">longyusheng.org</a>（听琴斋主人制作的龙榆生先生纪念网站），出自龙榆生《唐宋词格律》（上海古籍出版社 1978 年版），仅供学习参考。</p>
    </div>`;
}

/* ───────────────────────── 11.6 中国诗人（先秦 ~ 近现代） ───────────────────────── */
function renderPoetList() {
  const era = $('#poet-era').value;
  const kind = $('#poet-kind').value;
  const name = ($('#poet-name').value || '').trim();
  const hits = (typeof POETS !== 'undefined' ? POETS : []).filter(p =>
    (era === 'all' || p.region === era) &&
    (kind === 'all' || p.kind === kind) &&
    (!name || p.name.includes(name)));
  $('#poet-stats').textContent = `共 ${hits.length} 位诗人（先秦 ~ 近现代）`;
  const eraList = (typeof POET_ERAS !== 'undefined' ? POET_ERAS : []).filter(e => POETS.some(p => p.region === e))
    .concat([...new Set(POETS.map(p => p.region))].filter(e => !(typeof POET_ERAS !== 'undefined' && POET_ERAS.includes(e))));
  $('#poet-list').innerHTML = eraList.map(e => {
    const group = hits.filter(p => p.region === e);
    if (!group.length) return '';
    return `
      <div class="poet-era-section">
        <h3 class="poet-era-title">${esc(e)}<span class="muted">（${group.length}）</span></h3>
        <div class="poet-grid">
          ${group.map(p => {
            const topDims = p.traits.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2);
            return `
              <div class="poet-card">
                <div class="poet-card-head">
                  <span class="poet-name">${esc(p.name)}</span>
                  <span class="poet-era-badge">${esc(p.region)}</span>
                </div>
                <div class="poet-kind-chip">${esc(p.kind)}</div>
                <div class="poet-quote">${esc(p.quote)}</div>
                <p>${esc(p.intro)}</p>
                <p class="poet-one">${esc(p.one)}</p>
                <div class="poet-traits">气质倾向：${topDims.map(d => esc(POET_DIMS[d.i]) + ' ' + d.v).join(' · ')}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('') || '<div class="muted" style="padding:20px 0">无匹配诗人，试试「李白」「清」「田园」。</div>';
}

function initPoetsPage() {
  $('#poet-era').innerHTML = '<option value="all">全部朝代</option>' + POET_ERAS.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  $('#poet-kind').innerHTML = '<option value="all">全部风格</option>' + [...new Set(POETS.map(p => p.kind))].sort().map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  $('#btn-poet-search').onclick = renderPoetList;
  $('#poet-name').addEventListener('keydown', e => { if (e.key === 'Enter') renderPoetList(); });
  $('#poet-name').addEventListener('input', renderPoetList);
  $('#poet-era').addEventListener('change', renderPoetList);
  $('#poet-kind').addEventListener('change', renderPoetList);
  renderPoetList();
}

/* ───────────────────────── 11.7 跟我写诗 ───────────────────────── */
const WRITE_FORMS = {
  jinti: ['五绝', '七绝', '五律', '七律', '排律'],
  ci: ['词（按所选词牌定格）'],
  guti: ['五古', '七古', '乐府 / 歌行体'],
  modern: ['现代诗', '散文诗'],
  western: ['俳句', '莎士比亚十四行诗', '彼特拉克十四行诗', '维拉内尔', '民谣体', '五行打油诗', '自由诗']
};

function refreshWriteForms() {
  const cat = $('#write-cat').value;
  $('#write-cipai-field').hidden = cat !== 'ci';
  $('#write-form').innerHTML = (WRITE_FORMS[cat] || []).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  renderWriteExamples();
}
function refreshCipaiSelect() {
  const key = ($('#write-cipai-key').value || '').trim();
  const hits = (typeof CIPAI_FULL !== 'undefined' ? CIPAI_FULL : []).filter(c =>
    !key || c.name.includes(key) || c.aliases.some(a => a.includes(key)));
  $('#write-cipai').innerHTML = hits.slice(0, 60).map(c => `<option value="${c.id}">${esc(c.name)}（${c.zishu} 字 · ${esc(c.yunge)}）</option>`).join('') || '<option value="">无匹配词牌</option>';
  refreshCipaiPu();
}
function refreshCipaiPu() {
  const c = (typeof CIPAI_FULL !== 'undefined' ? CIPAI_FULL : []).find(x => x.id === +$('#write-cipai').value);
  $('#write-cipai-pu').innerHTML = c ? `
    <div class="pattern-box" style="margin:10px 0 0">
      <h4>词谱 · 《${esc(c.name)}》${esc(c.tis[0].title)}　<span class="confidence">${esc(c.yunge)}</span></h4>
      ${c.tis[0].pu.map(line => `<div class="pattern-line">${esc(line).replace(/（韵）/g, '<span class="rhyme-mark">（韵）</span>')}</div>`).join('')}
    </div>` : '';
  renderWriteExamples();
}
function refreshStyleDesc() {
  const st = (typeof STYLE_LIBRARY !== 'undefined' ? STYLE_LIBRARY : []).find(s => s.key === $('#write-style').value);
  $('#write-style-desc').innerHTML = st
    ? `<b>${esc(st.key)}</b>：${esc(st.desc)}<br><span class="muted">常用意象：${st.imgs.map(i => '「' + esc(i) + '」').join(' ')}　推荐韵部：${st.groups.map(esc).join('、')}</span>`
    : '';
}
function showRhymeGroup(gid) {
  const g = (typeof ALL_GROUPS !== 'undefined' ? ALL_GROUPS : []).find(x => x.id === gid);
  if (!g) return;
  $('#write-rhyme-info').innerHTML = `
    <div class="result-card">
      <h4>韵脚 · ${esc(g.id)}（${esc(g.cat)}）</h4>
      ${g.mood ? `<p class="muted">情感色彩：${esc(g.mood)}</p>` : ''}
      <div class="word-chips">${[...g.chars].slice(0, 24).map(c => `<span class="word-chip ping">${esc(c)}</span>`).join('')}</div>
      <p class="muted" style="margin-top:8px">押韵字请从同一韵部取用；换韵体裁可另选一部。</p>
    </div>`;
}
function randomRhyme() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const st = (typeof STYLE_LIBRARY !== 'undefined' ? STYLE_LIBRARY : []).find(s => s.key === $('#write-style').value);
  if (st && st.groups.length && Math.random() < 0.7) {
    const gname = pick(st.groups).replace(/[（(].*$/, '');
    let cands = ALL_GROUPS.filter(x => x.id.includes(gname));
    if (!cands.length) cands = ALL_GROUPS.filter(x => x.cat === '平声');
    showRhymeGroup(pick(cands).id);
  } else {
    showRhymeGroup(pick(ALL_GROUPS.filter(x => x.cat === '平声')).id);
  }
}
function byCharRhyme() {
  const ch = ($('#write-rhyme-char').value || '').trim().slice(0, 1);
  if (!ch) return;
  const gid = (typeof GROUP_OF !== 'undefined' ? GROUP_OF[ch] : null);
  if (gid) showRhymeGroup(gid);
  else $('#write-rhyme-info').innerHTML = `<div class="flag-box"><b>「${esc(ch)}」未收录</b>——可换一个常用字取韵，或直接用你喜欢的同韵字。</div>`;
}
/* 经典例作：随体裁 / 词牌联动，分批轮换（换一批，前 N 批不重样） */
const exampleState = { key: '', batch: 0 };
function renderWriteExamples(advance) {
  const box = $('#write-examples');
  if (!box) return;
  const cat = $('#write-cat').value;
  let items = [], srcNote = '更多逐句图注见「体裁学堂」页。', key;
  if (cat === 'ci') {
    const c = (typeof CIPAI_FULL !== 'undefined' ? CIPAI_FULL : []).find(x => x.id === +$('#write-cipai').value);
    key = 'ci-' + (c ? c.id : 0);
    if (c) {
      items = c.examples.map(ex => ({ title: `《${c.name}》· 「${(ex.text.split(/[，。、；！？\n]/)[0] || '').slice(0, 8)}…」`, author: ex.author, text: ex.text }));
      srcNote = `例词出自龙榆生《唐宋词格律》；《${esc(c.name)}》词谱见上方。`;
    }
  } else {
    const form = $('#write-form').value;
    key = 'form-' + form;
    items = (typeof EXAMPLES_LIB !== 'undefined' ? EXAMPLES_LIB[form] : []) || [];
    srcNote = `该体裁共 ${items.length} 首例作分批轮换；更多逐句图注见「体裁学堂」页。`;
  }
  if (exampleState.key !== key) { exampleState.key = key; exampleState.batch = 0; }
  if (advance) exampleState.batch++;
  const batchSz = items.length >= 10 ? 2 : 1;
  const batches = [];
  for (let i = 0; i < items.length; i += batchSz) batches.push(items.slice(i, i + batchSz));
  const idx = batches.length ? exampleState.batch % batches.length : 0;
  const round = batches.length ? Math.floor(exampleState.batch / batches.length) : 0;
  const cur = batches[idx] || [];
  box.innerHTML = items.length
    ? `<div class="examples-head">
         <span class="muted">第 ${idx + 1} / ${batches.length} 批（每批 ${batchSz} 首，前 ${batches.length} 批不重样${round ? `，已进入第 ${round + 1} 轮` : ''}）</span>
         <button class="btn mini" data-roll="examples">换一批</button>
       </div>
       ${cur.map(ex => `
        <div class="example-card">
          <h4>${esc(ex.title)}　<span class="muted">${esc(ex.author)}</span></h4>
          ${ex.text.split('\n').map(t => t.trim() ? `<div class="ex-line"><div class="txt">${esc(t.trim())}</div></div>` : '').join('')}
        </div>`).join('')}<p class="muted">${srcNote}</p>`
    : '<div class="muted">选择体裁后，这里会给出该体裁的经典例作。</div>';
}

/* 写作提示：意象锦囊 / 组句示例 / 手法示例 / 情绪主旨引导（可分卡刷新） */
function currentWriteStyle() {
  return (typeof STYLE_LIBRARY !== 'undefined' ? STYLE_LIBRARY : []).find(s => s.key === $('#write-style').value) || (typeof STYLE_LIBRARY !== 'undefined' ? STYLE_LIBRARY[0] : { key: '', imgs: [], scenes: [], techs: [], emo: [] });
}
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const pick1 = arr => arr[Math.floor(Math.random() * arr.length)];

function rollImagery() {
  const st = currentWriteStyle();
  const pool = (typeof IMAGE_LIB !== 'undefined' ? IMAGE_LIB : []).map(im => ({
    name: im.name, meta: `${im.cat} · ${im.mood}`, desc: im.meaning, ex: im.quotes[0] || ''
  }));
  st.imgs.forEach(n => {
    if (!pool.some(p => p.name === n)) pool.push({ name: n, meta: '风格意象', desc: `宜于「${st.key}」一路取用`, ex: '' });
  });
  return pickN(pool, 3 + Math.floor(Math.random() * 3)); // 3–5 个
}
function rollPhrase() {
  const quotePool = (typeof IMAGE_LIB !== 'undefined' ? IMAGE_LIB : []).flatMap(im => im.quotes);
  const quotes = pickN(quotePool, 2);
  const tpl = pick1(typeof PHRASE_TEMPLATES !== 'undefined' ? PHRASE_TEMPLATES : []);
  return { quotes, tpl };
}
function rollTech() {
  const st = currentWriteStyle();
  const tpls = pickN(typeof PHRASE_TEMPLATES !== 'undefined' ? PHRASE_TEMPLATES : [], 2);
  const scene = pick1(st.scenes);
  return { tpls, scene, tech: pick1(st.techs) };
}
function rollMood() {
  const st = currentWriteStyle();
  const g = (typeof WRITE_GUIDANCE !== 'undefined' ? WRITE_GUIDANCE[st.key] : null) || { mood: st.desc, opens: [], turns: [], ends: [], themes: st.emo };
  return { st, g, open: pick1(g.opens.length ? g.opens : ['从眼前实景切入']), turn: pick1(g.turns.length ? g.turns : ['由景入情，再翻进一层']), end: pick1(g.ends.length ? g.ends : ['以景结情，留余味']) };
}
function hintCardHtml(part) {
  const btn = `<button class="btn mini" data-roll="${part}">换一批</button>`;
  if (part === 'imagery') {
    const items = hintStore.imagery;
    return `<div class="hint-card wide"><div class="hint-card-head"><h4>意象锦囊（${items.length} 个）</h4>${btn}</div>
      ${items.map(im => `<p><b>「${esc(im.name)}」</b><span class="muted">（${esc(im.meta)}）</span>：${esc(im.desc)}${im.ex ? `<br><span class="quote-inline">${esc(im.ex)}</span>` : ''}</p>`).join('')}</div>`;
  }
  if (part === 'phrase') {
    const { quotes, tpl } = hintStore.phrase;
    return `<div class="hint-card wide"><div class="hint-card-head"><h4>组句示例</h4>${btn}</div>
      ${quotes.map(q => `<p class="quote-inline">${esc(q)}</p>`).join('')}
      ${tpl ? `<p><b>模板 · ${esc(tpl.name)}</b>：${esc(tpl.tip)}<br>例：${esc(tpl.ex)}<br><span class="muted">练：${esc(tpl.task)}</span></p>` : ''}</div>`;
  }
  if (part === 'tech') {
    const { tpls, scene, tech } = hintStore.tech;
    return `<div class="hint-card wide"><div class="hint-card-head"><h4>手法示例</h4>${btn}</div>
      <p><b>场景建议：</b>${esc(scene)}——先把场景看见，再落笔。</p>
      <p><b>风格手法：</b>${esc(tech)}</p>
      ${tpls.map(t => `<p><b>· ${esc(t.name)}</b>：${esc(t.tip)}<br>例：${esc(t.ex)}</p>`).join('')}</div>`;
  }
  const { st, g, open, turn, end } = hintStore.mood;
  return `<div class="hint-card wide"><div class="hint-card-head"><h4>情绪主旨引导 · ${esc(st.key)}</h4>${btn}</div>
    <p><b>情绪底色：</b>${esc(g.mood)}</p>
    <p><b>起句：</b>${esc(open)}</p>
    <p><b>承转：</b>${esc(turn)}</p>
    <p><b>结句：</b>${esc(end)}</p>
    <div class="tag-row">${(g.themes || []).map(t => `<span class="tag-type">主旨可写 · ${esc(t)}</span>`).join('')}</div></div>`;
}
const hintStore = { imagery: [], phrase: { quotes: [], tpl: null }, tech: { tpls: [], scene: '', tech: '' }, mood: null };
function rollHint(part) {
  if (part === 'imagery' || part === 'all') hintStore.imagery = rollImagery();
  if (part === 'phrase' || part === 'all') hintStore.phrase = rollPhrase();
  if (part === 'tech' || part === 'all') hintStore.tech = rollTech();
  if (part === 'mood' || part === 'all') hintStore.mood = rollMood();
  const box = $('#write-hints');
  if (part === 'all') {
    box.innerHTML = `<div class="hint-grid">${['imagery', 'phrase', 'tech', 'mood'].map(p => `<div id="hint-part-${p}">${hintCardHtml(p)}</div>`).join('')}</div>`;
  } else {
    const el = document.getElementById('hint-part-' + part);
    if (el) el.innerHTML = hintCardHtml(part);
  }
}
function writeHint() { rollHint('all'); }
function writeDone() {
  const title = ($('#write-title').value || '').trim();
  const body = ($('#write-body').value || '').trim();
  if (!body) { alert('先写两句再来～'); return; }
  $('#in-title').value = title || '无题';
  $('#in-body').value = body;
  $('#in-author').value = '';
  const sys = $('#write-cat').value === 'western' ? 'western' : 'pingshui';
  $$('input[name="rhyme"]').forEach(r => r.checked = r.value === sys);
  document.querySelector('.nav-link[data-page="home"]').click();
  $('#in-body').dispatchEvent(new Event('input'));
  const panel = document.querySelector('.input-panel');
  let tip = $('#write-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'write-tip'; tip.className = 'flag-box';
    panel.insertBefore(tip, panel.firstChild);
  }
  tip.innerHTML = `<b>已一键粘贴：</b>《${esc(title || '无题')}》的题目与正文已填入品鉴台。点击「开始品鉴」，即可获得格律与内容的赏析与改进建议。`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ───────────────────────── 11.8 AI 创作（Prompt 生成 + 智能体 API） ───────────────────────── */
const AI_CFG_KEY = 'poemweb-ai-cfg';

function aiEl(id) { return document.getElementById(id); }

function initAIPage() {
  // 种类
  aiEl('ai-form').innerHTML = AI_FORMS.map(f => `<option value="${f.key}">${esc(f.name)}</option>`).join('');
  aiEl('ai-style').innerHTML = AI_STYLE_KEYS.map(k => {
    const s = STYLE_LIBRARY.find(x => x.key === k);
    return `<option value="${esc(k)}">${esc(k)}${s ? ' — ' + esc(s.desc) : ''}</option>`;
  }).join('');
  aiEl('ai-theme').innerHTML = AI_THEMES.map(t => `<option value="${esc(t.key)}">${esc(t.key)} — ${esc(t.desc)}</option>`).join('');
  aiEl('ai-provider').innerHTML = AI_PROVIDERS.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('');
  refreshAISub();
  refreshAICipai();
  loadAICfg();

  aiEl('ai-form').addEventListener('change', refreshAISub);
  aiEl('ai-cipai-key').addEventListener('input', refreshAICipai);
  aiEl('ai-provider').addEventListener('change', fillProviderDefaults);
  aiEl('btn-gen-prompt').onclick = () => {
    const full = buildAIPrompt().full;
    aiEl('ai-prompt-out').value = full;
    aiEl('ai-status').innerHTML = '<b>提示词已生成</b>，可点击「复制」粘贴到任意 AI 助手，或「填入生成的 Prompt」进入创作。';
  };
  aiEl('btn-copy-prompt').onclick = copyPrompt;
  aiEl('btn-save-cfg').onclick = saveAICfg;
  aiEl('btn-test-cfg').onclick = testAICfg;
  aiEl('btn-clear-cfg').onclick = () => {
    aiEl('ai-apikey').value = '';
    localStorage.removeItem(AI_CFG_KEY);
    aiEl('ai-status').innerHTML = '<b>已清除</b>本机保存的 API Key。';
  };
  aiEl('btn-ai-fill').onclick = () => {
    const full = aiEl('ai-prompt-out').value.trim() || buildAIPrompt().full;
    aiEl('ai-req').value = full;
    aiEl('ai-status').innerHTML = '<b>已填入</b>创作框，点击「开始创作」。';
  };
  aiEl('btn-ai-create').onclick = createWithAI;
}

function refreshAISub() {
  const f = AI_FORMS.find(x => x.key === aiEl('ai-form').value) || AI_FORMS[0];
  const isCi = f.key === 'ci';
  aiEl('ai-cipai-field').hidden = !isCi;
  aiEl('ai-sub-field').hidden = isCi || !f.subs.length;
  aiEl('ai-sub').innerHTML = f.subs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}
function refreshAICipai() {
  const key = (aiEl('ai-cipai-key').value || '').trim();
  const hits = CIPAI_FULL.filter(c => !key || c.name.includes(key) || c.aliases.some(a => a.includes(key)));
  aiEl('ai-cipai').innerHTML = hits.slice(0, 60).map(c => `<option value="${c.id}">${esc(c.name)}（${c.zishu} 字 · ${esc(c.yunge)}）</option>`).join('') || '<option value="">无匹配</option>';
}

function buildAIPrompt() {
  const formKey = aiEl('ai-form').value;
  const form = AI_FORMS.find(x => x.key === formKey) || AI_FORMS[0];
  const styleKey = aiEl('ai-style').value;
  const style = STYLE_LIBRARY.find(s => s.key === styleKey) || STYLE_LIBRARY[0];
  const themeCustom = (aiEl('ai-theme-custom').value || '').trim();
  const themeKey = aiEl('ai-theme').value;
  const theme = themeCustom || themeKey;
  const themeDesc = themeCustom ? '' : (AI_THEMES.find(t => t.key === themeKey) || {}).desc || '';
  const imagery = (aiEl('ai-imagery').value || '').split(/[、，,;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);

  let formDesc = '', rhymeNote = form.rhyme;
  if (formKey === 'ci') {
    const c = CIPAI_FULL.find(x => x.id === +aiEl('ai-cipai').value);
    formDesc = c ? `词 ·《${c.name}》（${c.yunge}，${c.zishu} 字，${c.tis[0].title}）` : '词（词牌自选）';
    rhymeNote = '填词用词林正韵，记录词牌与谱体；用户未指定谱体时选工具支持的一种并注明';
  } else {
    const sub = aiEl('ai-sub').value || form.subs[0] || form.name;
    formDesc = `${sub}`;
    rhymeNote = form.rhyme;
  }

  const staticPart = `你是一名中文古典诗词创作与审校助手。你可以按题创作、检查格律、润色原作，并用简明中文解释修改理由。\n\n【任务与默认规则】\n- 近体诗默认用平水韵，填词默认用词林正韵。用户指定其他韵书时，按指定标准处理。若工具缺少相应数据，说明校验范围。\n- 填词时记录词牌和谱体。用户未指定谱体时，选择工具支持的一种，并注明所用谱体。古体诗和自由诗按用户指定的规则处理。\n\n【创作和润色】\n1. 先确定体裁、起式或谱体、韵书，以及用户想表达的情境和情感。\n2. 起草时优先保留自然语序、具体意象和原意，避免为凑韵而生造搭配。\n3. 调用 check_meter 校验草稿。根据工具返回的句、字位置修改。\n4. 修改后重新校验，最多两轮。交付的正文须与最后一次送检的正文一致。\n5. 润色时优先做最小改动，并说明关键改字如何影响原意或格律。\n\n【格律审校】\n- 区分确定错误、可接受变格和需要人工复核的情况。\n- 对多音字，结合句义判断实际读法。若只有另一种读法符合格律，标为待复核，并说明歧义所在。\n- 遇到拗救、特殊换韵或词牌异体，按工具覆盖情况标注待复核。\n- 对律诗的颔联和颈联，另从词性、句法、语义对应三个方面点评对仗。\n- 如果工具调用失败，标注「未完成工具校验」。两轮修改后仍有问题时，列出剩余问题及其位置。\n\n【输出】\n创作时先给诗词正文，再给体裁或谱体、韵书、韵脚和校验结论。\n审校时先给结论，再逐项列出句号与字位、原字、问题和修改建议。`;

  const reqPart = `【本次创作要求】\n- 体裁：${formDesc}\n- 韵书：${rhymeNote}\n- 风格：${styleKey}——${style.desc}\n- 主题：${theme}${themeDesc ? '（' + themeDesc + '）' : ''}\n- 须使用的意象：${imagery.length ? imagery.map(i => '「' + i + '」').join('、') : '（不指定，自选贴合意象）'}\n- 请创作 2-3 首，每首独立成篇，题目自拟；每首以【作品一】【作品二】【作品三】开头标注，便于分篇评分。`;

  return { system: staticPart, user: reqPart, full: staticPart + '\n\n' + reqPart };
}

function copyPrompt() {
  const text = aiEl('ai-prompt-out').value.trim();
  if (!text) { aiEl('ai-status').innerHTML = '请先点击「生成 Prompt」。'; return; }
  const done = () => { aiEl('ai-status').innerHTML = '<b>已复制</b>到剪贴板，可粘贴到任意 AI 助手。'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallbackCopy);
  } else fallbackCopy();
  function fallbackCopy() {
    const ta = aiEl('ai-prompt-out');
    ta.removeAttribute('readonly'); ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); done(); } catch (e) { aiEl('ai-status').innerHTML = '复制失败，请手动选中复制。'; }
    ta.setAttribute('readonly', '');
  }
}

function fillProviderDefaults() {
  const p = AI_PROVIDERS.find(x => x.key === aiEl('ai-provider').value) || AI_PROVIDERS[0];
  aiEl('ai-baseurl').value = p.baseUrl;
  aiEl('ai-model').value = p.model;
  aiEl('ai-cfg-note').innerHTML = `<b>${esc(p.name)}</b>：${esc(p.note)}。密钥仅保存在<b>本机浏览器</b>（localStorage），仅用于直连所选平台官方接口。`;
}
function saveAICfg() {
  const cfg = {
    provider: aiEl('ai-provider').value,
    baseUrl: aiEl('ai-baseurl').value.trim(),
    model: aiEl('ai-model').value.trim(),
    apiKey: aiEl('ai-apikey').value.trim()
  };
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    aiEl('ai-status').innerHTML = '<b>配置不完整</b>：Base URL、模型、API Key 均需填写。'; return;
  }
  localStorage.setItem(AI_CFG_KEY, JSON.stringify(cfg));
  aiEl('ai-status').innerHTML = '<b>配置已保存</b>（本机浏览器）。可点击「测试连接」验证。';
}
function loadAICfg() {
  try {
    const cfg = JSON.parse(localStorage.getItem(AI_CFG_KEY) || 'null');
    if (cfg) {
      aiEl('ai-provider').value = cfg.provider || 'deepseek';
      aiEl('ai-baseurl').value = cfg.baseUrl || '';
      aiEl('ai-model').value = cfg.model || '';
      aiEl('ai-apikey').value = cfg.apiKey || '';
    } else fillProviderDefaults();
  } catch (e) { fillProviderDefaults(); }
}
function getAICfg() {
  try {
    const cfg = JSON.parse(localStorage.getItem(AI_CFG_KEY) || 'null');
    if (cfg && cfg.baseUrl && cfg.model && cfg.apiKey) return cfg;
  } catch (e) {}
  return null;
}
async function callLLM(prompt, cfg, onDone) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      stream: false
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + (t ? '：' + t.slice(0, 200) : ''));
  }
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : JSON.stringify(data).slice(0, 500);
}
async function testAICfg() {
  const cfg = readCfgFromForm();
  if (!cfg) return;
  aiEl('ai-status').innerHTML = '正在测试连接……';
  try {
    await callLLM('请回复「连接成功」四个字。', cfg);
    aiEl('ai-status').innerHTML = '<b>连接成功</b>，可以开始创作。';
  } catch (e) {
    aiEl('ai-status').innerHTML = `<b style="color:var(--cinnabar)">连接失败</b>：${esc(e.message)}。若为 CORS / 网络限制，请用第一栏生成的 Prompt 粘贴到平台官网使用。`;
  }
}
function readCfgFromForm() {
  const cfg = {
    baseUrl: aiEl('ai-baseurl').value.trim(),
    model: aiEl('ai-model').value.trim(),
    apiKey: aiEl('ai-apikey').value.trim()
  };
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    aiEl('ai-status').innerHTML = '<b>请先完整填写并保存 API 配置</b>（Base URL / 模型 / API Key）。';
    return null;
  }
  return cfg;
}

function parseAIWorks(text) {
  let parts = text.split(/【作品[一二三四五12345]】/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return parts.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let title = '';
    const bodyLines = [];
    for (const l of lines) {
      const m = l.match(/[《「](.+?)[》」]/);
      if (!title && m) { title = m[1]; continue; }
      if (!title && l.length <= 14 && !/[，。！？；、]/.test(l) && /诗|词|行|吟|曲|赋|引|谣/.test(l)) { title = l; continue; }
      if (/[\u4e00-\u9fff]/.test(l) && /[，。！？；、]/.test(l)) bodyLines.push(l);
    }
    return { title: title || '无题', body: bodyLines.join('\n'), raw: block };
  }).filter(w => w.body.length > 8);
}

function scoreRelevance(poemText, opts) {
  const text = poemText;
  const imgHits = opts.imagery.filter(i => text.includes(i));
  const imgScore = opts.imagery.length ? imgHits.length / opts.imagery.length : 0.5;
  const themeRule = EMOTION_RULES.find(r => r[0] === opts.theme);
  const themeHits = themeRule ? themeRule[1].filter(k => text.includes(k)) : [];
  const themeScore = themeRule ? Math.min(1, themeHits.length / 2) : 0.5;
  const lines = text.split('\n').filter(l => l.trim());
  const complete = lines.length >= 4 ? 1 : lines.length >= 2 ? 0.75 : 0.5;
  const fit = Math.round((imgScore * 0.5 + themeScore * 0.3 + complete * 0.2) * 100);
  return { fit, imgHits, themeHits, imgScore, themeScore, complete };
}

async function createWithAI() {
  const cfg = readCfgFromForm();
  if (!cfg) return;
  const prompt = (aiEl('ai-req').value || '').trim();
  if (!prompt) { aiEl('ai-status').innerHTML = '<b>请先填写提示词</b>（可点「填入生成的 Prompt」）。'; return; }
  aiEl('ai-results').innerHTML = '';
  aiEl('ai-status').innerHTML = '<b>创作中……</b>（模型生成 2-3 首约需数秒）';
  const btn = aiEl('btn-ai-create');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const out = await callLLM(prompt, cfg);
    aiEl('ai-status').innerHTML = '<b>创作完成</b>，以下为作品与贴合度评分。';
    renderAIResults(out, prompt);
  } catch (e) {
    aiEl('ai-status').innerHTML = `<b style="color:var(--cinnabar)">请求失败</b>：${esc(e.message)}。若为 CORS 限制，可用「复制」的 Prompt 到平台官网创作。`;
  } finally {
    btn.disabled = false; btn.textContent = '开始创作';
  }
}

function copyPlainText(text, msg) {
  const done = () => toast(msg || '已复制到剪贴板');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中复制'); }
    document.body.removeChild(ta);
  }
}

function copyAllAIWorks() {
  const works = window._aiWorks || [];
  if (!works.length) { toast('暂无作品可复制'); return; }
  const text = works.map((w, i) => `《${w.title}》\n${w.body}`).join('\n\n');
  copyPlainText(text, `已复制全部作品（共 ${works.length} 首）`);
}

function copyAIWork(i) {
  const w = (window._aiWorks || [])[i];
  if (!w) return;
  copyPlainText(`《${w.title}》\n${w.body}`, `已复制《${w.title}》`);
}

function renderAIResults(rawText, prompt) {
  const works = parseAIWorks(rawText);
  window._aiWorks = works; // 供一键复制使用
  const themeCustom = (aiEl('ai-theme-custom').value || '').trim();
  const opts = {
    theme: themeCustom || aiEl('ai-theme').value,
    imagery: (aiEl('ai-imagery').value || '').split(/[、，,;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5)
  };
  const box = aiEl('ai-results');
  if (!works.length) {
    box.innerHTML = `<div class="result-card"><h4>原始返回</h4><pre class="ai-raw">${esc(rawText)}</pre></div>`;
    return;
  }
  box.innerHTML = `
    <div class="ai-copy-bar">
      <span class="ai-copy-count">已生成 <b>${works.length}</b> 首作品</span>
      <button class="btn" id="btn-copy-all-works">📋 一键复制全部作品</button>
    </div>` + works.map((w, i) => {
    const rel = scoreRelevance(w.body, opts);
    let art = null;
    try {
      const lines = parseBody(w.body).filter(l => l.clean);
      if (lines.length >= 2) {
        const genre = detectChinese(lines, w.title, w.body);
        const prosody = (genre._prosody || (/现代诗|散文诗|自由诗/.test(genre.primary) ? null : analyzeProsody(lines.map(l => l.clean), genre.primary, genre.cipai && genre.cipai.rhymeIdx, genre.cipai)));
        art = analyzeArt(lines, prosody, genre, findPoet(''));
      }
    } catch (e) { /* 评分失败不影响展示 */ }
    return `
      <div class="result-card ai-work">
        <div class="ai-work-head">
          <h4>作品${['一', '二', '三', '四', '五'][i] || i + 1} · 《${esc(w.title)}》</h4>
          <div class="ai-badges">
            <button class="btn mini ghost" data-copy-work="${i}">📋 复制</button>
            <span class="tag-type">贴合度 ${rel.fit}%</span>
            ${art ? `<span class="tag-pri">诗镜评分 ${art.total}（${art.grade}）</span>` : ''}
          </div>
        </div>
        ${w.body.split('\n').map(l => `<div class="ex-line"><div class="txt">${esc(l)}</div></div>`).join('')}
        <div class="ai-fit">
          <b>贴合度明细：</b>
          意象 ${opts.imagery.length ? `${rel.imgHits.length}/${opts.imagery.length}` + (rel.imgHits.length ? `（命中 ${rel.imgHits.map(h => '「' + esc(h) + '」').join('、')}）` : '') : '未指定'}　·
          主题「${esc(opts.theme)}」${rel.themeHits.length ? `命中 ${rel.themeHits.map(h => '「' + esc(h) + '」').join('、')}` : '未见关键词，可从意境判断'}　·
          结构完整度 ${Math.round(rel.complete * 100)}%
        </div>
      </div>`;
  }).join('');
  // 绑定一键复制与逐首复制
  const allBtn = box.querySelector('#btn-copy-all-works');
  if (allBtn) allBtn.onclick = copyAllAIWorks;
  box.querySelectorAll('[data-copy-work]').forEach(b => {
    b.onclick = () => copyAIWork(+b.getAttribute('data-copy-work'));
  });
}

/* ───────────────────────── 11.9 公众号弹层 ───────────────────────── */
function initWechatModal() {
  const modal = document.getElementById('wechat-modal');
  const openBtn = document.getElementById('btn-wechat');
  const closeBtn = document.getElementById('wechat-close');
  const copyBtn = document.getElementById('btn-copy-wechat');
  if (!modal || !openBtn) return;
  let lastFocus = null;
  const focusables = () => modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  function open(trigger) {
    lastFocus = trigger || document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    else if (openBtn && openBtn.focus) openBtn.focus();
  }
  openBtn.addEventListener('click', e => open(e.currentTarget || openBtn));
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', e => {
    if (e.target.hasAttribute && e.target.hasAttribute('data-close')) close();
  });
  document.addEventListener('keydown', e => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const nameEl = document.getElementById('wechat-name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const done = () => {
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(name).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = name; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { copyBtn.textContent = '请手动复制'; }
      document.body.removeChild(ta);
    }
  });
}

/* ───────────────────────── 12. 初始化 ───────────────────────── */
/* ───────────────────────── 12. 背景音乐 / 点歌台 ───────────────────────── */
const BGM = { audio: null, list: [], cur: -1, playing: false, loaded: false };

/* —— 自动读取 Music/ 音乐库：按「歌名+歌手名」解析文件名 —— */
function parseSongName(name) {
  let title = name, artist = '';
  const i = name.indexOf('+');
  if (i > 0) { title = name.slice(0, i).trim(); artist = name.slice(i + 1).trim(); }
  else {
    const m = name.split(/[-–—_]/);
    if (m.length >= 2) { title = m[0].trim(); artist = m.slice(1).join(' ').trim(); }
  }
  return { title: title || name, artist };
}

function fileToSong(path) {
  const clean = decodeURIComponent(String(path).split('?')[0]);
  const fname = clean.split('/').pop();
  const base = fname.replace(/\.[^.]+$/, '');
  const t = parseSongName(base);
  return { title: t.title, artist: t.artist, src: 'Music/' + fname, tag: '' };
}

function dedupeMusic(list) {
  const seen = {};
  return list.filter(s => s.src && !seen[s.src] && (seen[s.src] = 1));
}

async function loadMusicLibrary() {
  // 1) 直接读取 Music/ 目录列表（支持目录列表的服务器：新增歌曲自动识别）
  try {
    const res = await fetch('Music/');
    if (res.ok) {
      const html = await res.text();
      const files = [...html.matchAll(/href=["']([^"']+?\.(?:mp3|m4a|ogg|wav))["']/gi)].map(m => m[1]);
      const songs = dedupeMusic(files.map(fileToSong).filter(s => s.title));
      if (songs.length) return songs;
    }
  } catch (e) { /* 目录列表不可用则维续 */ }
  // 2) 读取 Music/index.json 清单（任何静态主机可用）
  try {
    const res = await fetch('Music/index.json');
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length) {
        const songs = dedupeMusic(arr.map(x => typeof x === 'string' ? fileToSong(x)
          : { title: x.title || '', artist: x.artist || '', src: x.src || ('Music/' + (x.file || '')), tag: x.tag || '' }).filter(s => s.src));
        if (songs.length) return songs;
      }
    }
  } catch (e) { /* 无清单则维续 */ }
  // 3) 回退 data-music.js（file:// 直接打开可用）
  return (typeof MUSIC !== 'undefined' && Array.isArray(MUSIC))
    ? MUSIC.map(s => ({ title: s.title || '', artist: s.artist || '', src: s.src || '', tag: s.tag || '' })).filter(s => s.src)
    : [];
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function playIndex(i) {
  const list = BGM.list;
  if (!list.length) { toast('歌单为空：请在 Music/ 文件夹放入歌曲，并在 data-music.js 登记'); return; }
  BGM.cur = ((i % list.length) + list.length) % list.length;
  const s = list[BGM.cur];
  BGM.audio.src = s.src;
  BGM.playing = true;              // 乐观置位，点击即刻反馈
  syncBgmUI();
  updateProgress();
  BGM.audio.play().catch(() => { BGM.playing = false; syncBgmUI(); });
}

function playRandom() {
  const n = BGM.list.length; if (!n) return;
  let i = Math.floor(Math.random() * n), guard = 0;
  while (n > 1 && i === BGM.cur && guard++ < 30) i = Math.floor(Math.random() * n);
  playIndex(i);
}

function playNext() { if (BGM.list.length) playIndex(BGM.cur + 1); }
function playPrev() { if (BGM.list.length) playIndex(BGM.cur - 1); }

function toggleBgm() {
  const a = BGM.audio;
  if (!BGM.list.length) { toast('歌单为空：请在 Music/ 文件夹放入歌曲，并在 data-music.js 登记'); return; }
  if (!a.paused) a.pause();
  else if (BGM.cur >= 0 && a.src) {
    BGM.playing = true; syncBgmUI();
    a.play().catch(() => { BGM.playing = false; syncBgmUI(); });
  }
  else playRandom();
}

function updateProgress() {
  const a = BGM.audio;
  const bar = $('#jb-bar'), time = $('#jb-time');
  const pct = a.duration ? (a.currentTime / a.duration * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (time) time.textContent = fmtTime(a.currentTime) + ' / ' + fmtTime(a.duration || 0);
}

function syncBgmUI() {
  const s = BGM.list[BGM.cur];
  const btn = $('#btn-bgm');
  if (btn) {
    btn.classList.toggle('playing', BGM.playing);
    btn.title = s ? (BGM.playing ? `正在播放：${s.title} · ${s.artist}（点击暂停）` : `已暂停：${s.title}（点击播放）`) : '播放背景音乐（随机）';
  }
  const now = $('#bgm-now');
  if (now) {
    if (s && BGM.playing) { now.hidden = false; now.textContent = `♪ ${s.title} · ${s.artist}`; }
    else now.hidden = true;
  }
  const cover = $('#jb-cover');
  if (cover) cover.classList.toggle('playing', BGM.playing);
  const jt = $('#jb-title'), ja = $('#jb-artist'), jtog = $('#jb-toggle');
  if (jt) jt.textContent = s ? s.title : '未在播放';
  if (ja) ja.textContent = s ? s.artist : '点一首歌，或让诗镜随机为你选曲';
  if (jtog) jtog.textContent = BGM.playing ? '⏸ 暂停' : '▶ 播放';
  document.querySelectorAll('#jb-list .jb-item').forEach(el => {
    const on = +el.getAttribute('data-idx') === BGM.cur;
    el.classList.toggle('cur', on);
    const pb = el.querySelector('.jb-item-play');
    if (pb) pb.textContent = (on && BGM.playing) ? '⏸' : '▶';
  });
}

function renderJukebox(filter) {
  const box = $('#jb-list'); if (!box) return;
  const q = (filter || '').trim().toLowerCase();
  const items = BGM.list.map((s, i) => ({ s, i })).filter(({ s }) =>
    !q || (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q) || (s.tag || '').toLowerCase().includes(q));
  const count = $('#jb-count');
  if (count) count.textContent = q ? `匹配 ${items.length} / ${BGM.list.length} 首` : `共 ${BGM.list.length} 首`;
  if (!BGM.list.length) {
    box.innerHTML = BGM.loaded
      ? '<div class="jb-empty">音乐库为空。请将歌曲命名为「歌名+歌手名.mp3」放入 <b>Music/</b> 文件夹，再运行 <code>node tools/scan-music.js</code> 更新清单。</div>'
      : '<div class="jb-empty">正在读取 Music/ 音乐库…</div>';
    return;
  }
  if (!items.length) {
    box.innerHTML = `<div class="jb-empty">没有匹配「${esc(filter)}」的歌曲。试试其它歌名 / 歌手名，或清空搜索。</div>`;
    return;
  }
  box.innerHTML = items.map(({ s, i }) => `
    <div class="jb-item" data-idx="${i}" data-play="${i}">
      <button class="jb-item-play" title="播放 / 暂停">▶</button>
      <div class="jb-item-meta">
        <div class="jb-item-title">${esc(s.title)}</div>
        <div class="jb-item-artist">${esc(s.artist || '未知')}${s.tag ? ' · ' + esc(s.tag) : ''}</div>
      </div>
      <div class="jb-item-no">${String(i + 1).padStart(2, '0')}</div>
    </div>`).join('');
  box.querySelectorAll('.jb-item').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.getAttribute('data-play');
      if (i === BGM.cur && !BGM.audio.paused) BGM.audio.pause();
      else if (i === BGM.cur) {
        BGM.playing = true; syncBgmUI();
        BGM.audio.play().catch(() => { BGM.playing = false; syncBgmUI(); });
      }
      else playIndex(i);
    });
  });
  syncBgmUI();
}

function initMusic() {
  BGM.audio = new Audio();
  BGM.audio.preload = 'metadata';
  const vol = parseFloat(localStorage.getItem('shijing_bgm_vol'));
  BGM.audio.volume = isNaN(vol) ? 0.6 : vol;
  const a = BGM.audio;
  a.addEventListener('ended', () => playNext());                 // 曲终自动下一首
  a.addEventListener('error', () => { if (BGM.playing) playNext(); }); // 文件缺失自动跳过
  a.addEventListener('timeupdate', updateProgress);
  a.addEventListener('loadedmetadata', updateProgress);
  a.addEventListener('play', () => { BGM.playing = true; syncBgmUI(); });
  a.addEventListener('pause', () => { BGM.playing = false; syncBgmUI(); });

  const btn = $('#btn-bgm'); if (btn) btn.onclick = toggleBgm;
  renderJukebox('');   // 先渲染加载态
  loadMusicLibrary().then(list => {
    BGM.list = list;
    BGM.loaded = true;
    const search = $('#jb-search');
    renderJukebox(search ? search.value : '');
    syncBgmUI();
  }).catch(() => { BGM.loaded = true; renderJukebox(''); });
  const search = $('#jb-search');
  if (search) search.addEventListener('input', () => renderJukebox(search.value));
  const bind = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  bind('#jb-toggle', toggleBgm);
  bind('#jb-next', playNext);
  bind('#jb-prev', playPrev);
  bind('#jb-random', playRandom);
  const track = $('#jb-track');
  if (track) track.addEventListener('click', e => {
    if (!BGM.audio.duration) return;
    const r = track.getBoundingClientRect();
    BGM.audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * BGM.audio.duration;
  });
  syncBgmUI();
}

function init() {
  // 导航
  $$('.nav-link, .brand').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const page = a.dataset.page;
    $$('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // 模式开关：本地规则 / AI 增强（鉴赏接口 = 「AI 创作」页保存的同一 API）
  $('#mode-local').onclick = () => {
    aiMode = false;
    $('#mode-local').classList.add('active');
    $('#mode-ai').classList.remove('active');
    toast('已切换到<b>本地规则引擎</b>：体裁判定、格律检查、韵脚分析与评分均在浏览器内完成。');
  };
  $('#mode-ai').onclick = () => {
    const cfg = getAICfg();
    if (!cfg) {
      aiMode = false;
      $('#mode-ai').classList.remove('active');
      $('#mode-local').classList.add('active');
      toast('未检测到鉴赏接口配置。请先到「AI 创作」页填写并保存 API（Base URL / 模型 / API Key），再开启 AI 增强。正在为你跳转……');
      $$('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.page === 'ai'));
      $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-ai'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    aiMode = true;
    $('#mode-ai').classList.add('active');
    $('#mode-local').classList.remove('active');
    toast('AI 增强已开启：品鉴时「艺术水平」与「改进借鉴」将由 <b>' + esc(cfg.model) + '</b> 生成，体裁 / 格律 / 评分仍由本地规则引擎给出。');
  };

  // 实时统计
  const updateStats = () => {
    const lines = parseBody($('#in-body').value).filter(l => l.clean);
    const chars = lines.reduce((s, l) => s + l.clean.length, 0);
    $('#st-lines').textContent = lines.length;
    $('#st-chars').textContent = chars;
    $('#st-avg').textContent = lines.length ? (chars / lines.length).toFixed(1) : '0';
  };
  $('#in-body').addEventListener('input', updateStats);

  // 示例菜单
  $('#sample-menu').innerHTML = SAMPLES.map((s, i) =>
    `<button data-si="${i}">${esc(s.label)}<small>${esc(s.tag)}</small></button>`).join('');
  $('#btn-sample').onclick = e => {
    e.stopPropagation();
    const menu = $('#sample-menu');
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', () => { $('#sample-menu').hidden = true; });
  $('#sample-menu').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = SAMPLES[+b.dataset.si];
    $('#in-title').value = s.title;
    $('#in-author').value = s.author;
    $('#in-body').value = s.body;
    $$('input[name="rhyme"]').forEach(r => r.checked = r.value === s.system);
    $('#sample-menu').hidden = true;
    updateStats();
  });

  // 期望体裁下拉
  const expectOpts = ['auto'];
  const flat = [
    '五言绝句', '七言绝句', '五言律诗', '七言律诗', '排律',
    '五古', '七古', '乐府 / 歌行体', '词', '曲', '现代诗', '散文诗',
    '莎士比亚十四行诗', '彼特拉克十四行诗', '俳句', '维拉内尔', '民谣体', '五行打油诗', '自由诗'
  ];
  $('#in-expect').innerHTML = '<option value="auto">请自动判定</option>' +
    flat.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');

  $('#btn-judge').onclick = judge;
  $('#btn-clear').onclick = () => {
    $('#in-title').value = ''; $('#in-author').value = ''; $('#in-body').value = '';
    $('#report').hidden = true; updateStats();
  };
  $('#btn-print').onclick = printLetter;
  $('#btn-export-img').onclick = exportReportImage;

  // 平/仄双色切换
  $$('.tone-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tone-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const mode = b.dataset.tone;
    $$('.char-tone').forEach(el => {
      if (mode === 'both') el.style.opacity = 1;
      else if (mode === 'ping') el.style.opacity = el.classList.contains('ping') ? 1 : .35;
      else el.style.opacity = el.classList.contains('ze') ? 1 : .35;
    });
  }));

  // 学堂
  renderSchoolTree();

  // 辞典
  $('#dict-group').innerHTML = ALL_GROUPS.map(g => `<option value="${esc(g.id)}">${esc(g.id)}（${esc(g.cat)}）</option>`).join('');
  $('#image-cat').innerHTML = '<option value="all">全部主题</option>' +
    [...new Set(IMAGE_LIB.map(i => i.cat))].map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#btn-char-lookup').onclick = dictCharLookup;
  $('#dict-char').addEventListener('keydown', e => { if (e.key === 'Enter') dictCharLookup(); });
  $('#btn-group-lookup').onclick = dictGroupLookup;
  $('#btn-image-lookup').onclick = dictImageLookup;
  $('#image-key').addEventListener('keydown', e => { if (e.key === 'Enter') dictImageLookup(); });
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
  }));
  initCompose();

  // 词牌查询
  const refreshCipai = () => { renderCipaiTree(); const first = $('#cipai-tree .tree-item'); if (first) { $$('#cipai-tree .tree-item').forEach(b => b.classList.remove('active')); first.classList.add('active'); renderCipaiDetail(first.dataset.cid); } };
  $('#btn-cipai-search').onclick = refreshCipai;
  $('#cipai-key').addEventListener('keydown', e => { if (e.key === 'Enter') refreshCipai(); });
  $('#cipai-yunge').addEventListener('change', refreshCipai);
  $('#cipai-key').addEventListener('input', refreshCipai);
  $('#cipai-tree').addEventListener('click', e => {
    const b = e.target.closest('.tree-item');
    if (!b) return;
    $$('#cipai-tree .tree-item').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderCipaiDetail(b.dataset.cid);
  });
  refreshCipai();

  // 中国诗人
  initPoetsPage();

  // 跟我写诗
  $('#write-style').innerHTML = STYLE_LIBRARY.map(s => `<option value="${esc(s.key)}">${esc(s.key)}</option>`).join('');
  refreshWriteForms(); refreshStyleDesc(); refreshCipaiSelect();
  initAIPage();
  $('#write-cat').addEventListener('change', refreshWriteForms);
  $('#write-form').addEventListener('change', renderWriteExamples);
  $('#write-cipai-key').addEventListener('input', refreshCipaiSelect);
  $('#write-cipai').addEventListener('change', refreshCipaiPu);
  $('#write-style').addEventListener('change', () => { refreshStyleDesc(); rollHint('all'); });
  $('#btn-rhyme-random').onclick = randomRhyme;
  $('#btn-rhyme-lookup').onclick = byCharRhyme;
  $('#btn-write-hint').onclick = writeHint;
  $('#btn-write-done').onclick = writeDone;
  $('#write-hints').addEventListener('click', e => {
    const b = e.target.closest('[data-roll]');
    if (b) rollHint(b.dataset.roll);
  });
  $('#write-examples').addEventListener('click', e => {
    const b = e.target.closest('[data-roll="examples"]');
    if (b) renderWriteExamples(true);
  });
  renderWriteExamples();
  writeHint();
  initWechatModal();
  initMusic();

  updateStats();
}

document.addEventListener('DOMContentLoaded', init);
