/**
 * 招募演出用的素材与音效常量（D3/C-9 重做版）
 *
 * 所有 file 均来自 data/ui_atlas.json（origin: assetbundle）或素材轨产出（extra3/），
 * 所有 SE 均来自 data/se_index.json（resources/se/*.wav 实测存在）。
 * 没有真素材的部分用 CSS 兜底，DOM 上打 data-ui-source="css-fallback" 标记，见各组件。
 *
 * D3（报告二视频抽帧 48 帧证据，冲突裁决①）十连揭示形制：
 *   阿罗娜抽签进场 → 单张竖卡居中逐张揭示（普卡青绿彩虹环扩散）
 *   → ★3/新角色全屏演出（立绘右滑入 + 右侧契约书竖卡 + 左下蓝色名字条 + 底部语音字幕）
 *   → 卡与卡之间深蓝台词卡 → 结果页。报告一「卡片飞落 5×2 网格」描述与本证据冲突，弃用。
 */

/** 结果背景：按最高稀有度选（R=★1，SR=★2，SSR=★3），真实游戏贴图 2048×1024 */
export const GACHA_BG: Record<1 | 2 | 3, string> = {
  1: '/res/ui/extra/Gacha_BG_R.png',
  2: '/res/ui/extra/Gacha_BG_SR.png',
  3: '/res/ui/extra/Gacha_BG_SSR.png',
};

/** 揭示卡（剪影 + 光环，按稀有度染色），真实游戏贴图 512×512 */
export const GACHA_RESUME: Record<1 | 2 | 3, string> = {
  1: '/res/ui/extra/Img_Gacha_Char_R_Resume.png',
  2: '/res/ui/extra/Img_Gacha_Char_SR_Resume.png',
  3: '/res/ui/extra/Img_Gacha_Char_SSR_Resume.png',
};

/** 系统室背景（阿罗娜的工作间），真实游戏贴图 1806×2048 */
export const ROOM_BG = '/res/ui/extra/UIWorkAronaSceneBG_Day.png';

/** 阿罗娜半身像（真素材，预合成）；1=常态 2=笑（抽签拉出瞬间的笑脸差分） */
export const ARONA_IMG = '/res/ui/extra/Image_Char_Arona.png';
export const ARONA_IMG_SMILE = '/res/ui/extra/Image_Char_Arona2.png';

/**
 * 普拉娜立绘（C-10）：素材轨 composite_plana.py 从 assets-_mx-npcs-plana bundle
 * 的 Mesh 顶点/UV+蒙皮正面投影栅格化产出（1024×1315 RGBA），真素材。
 * 注意：Tablet_01/010 与 Sack 蒙皮后悬空已剔除，合成件不含平板背包（来源差异如实标注）。
 */
export const PLANA_IMG = '/res/ui/extra3/Plana_Composite.png';

/** 白色光球（加算贴图，黑底；CSS 里配 mix-blend-mode: screen 在暗底上等效 Unity additive） */
export const BALL_FX = '/res/ui/extra/FX_TEX_GachaBall9.png';

/** 阿罗娜眼部特效（真 alpha 的辉光贴图），SSR 时刻用 */
export const EYE_FX = '/res/ui/extra/FX_TEX_GT_Aronaeye1.png';

/** 招募申请表纸（新学生揭示用），真实游戏贴图 830×1064 */
export const SUBINFO_PAPER = '/res/ui/extra/Gacha_SubInfo.png';

/** 结果底纹（入学揭示的背景），真实游戏贴图 512×512 */
export const RESUME_BG = '/res/ui/extra/Img_Gacha_BG_Resume.png';

/** 稀有度主色（★1 蓝灰 / ★2 紫 / ★3 金）——结果页卡框、星级、台词卡统一取色 */
export const STAR_COLOR: Record<1 | 2 | 3, string> = { 1: '#8d9dab', 2: '#9b74d8', 3: '#f0a11a' };

/**
 * 学园枚举标签（契约书「社团」行）。
 * 仅收录经 students_full.json 交叉验证的值：星野/白子=1(阿拜多斯)、未花/玛丽/渚=2(三一)、
 * 日奈/亚子=3(格黑娜)、优香/桃井=4(千禧)、切里诺/兰娜=5(红冬)。
 * 其余枚举值（7/8/9/10/…）样本交叉不一致，无法可靠映射，如实显示「—」不伪造。
 */
export const SCHOOL_LABEL: Record<number, string> = {
  1: '阿拜多斯',
  2: '三一',
  3: '格黑娜',
  4: '千禧',
  5: '红冬',
};

// ------------------------------------------------------------ SE 播放链
// 名字全部在 data/se_index.json 里核对过：UI_Gacha_* 全实存 resources/se/。

/** 转场 */
export const SE_TRANSITION = 'UI_Gacha_Transition_ST_01';
/** 普通抽卡机器链（抽签拉杆） */
export const SE_NORMAL_HANDLE = 'UI_Gacha_Normal_02';
export const SE_NORMAL_DROP = 'UI_Gacha_Normal_04';
export const SE_NORMAL_BURST = 'UI_Gacha_Explosion';
/** SSR 专属链（AroPla = 阿罗娜/普拉娜） */
export const SE_SSR_WIND = 'UI_Gacha_AroPla_SSR_Wind';
export const SE_SSR_CHIME = 'UI_Gacha_AroPla_SSR_Chime';
export const SE_SSR_IMPACT = 'UI_Gacha_AroPla_SSR_Impact';
export const SE_SSR_SIGN = 'UI_Gacha_AroPla_SSR_Sign';
export const SE_SSR_TAIL = 'UI_Gacha_AroPla_SSR_Tail_01';
/** 揭示按稀有度 */
export const SE_FLIP: Record<1 | 2 | 3, string> = {
  1: 'UI_Gacha_Sqr_R',
  2: 'UI_Gacha_Sqr_SR',
  3: 'UI_Gacha_Sqr_SSR',
};
/** 结果页 */
export const SE_RESULT_IN: Record<1 | 10, string> = {
  1: 'UI_Gacha_Result1_01',
  10: 'UI_Gacha_Result10_01',
};
export const SE_RESULT_BG = 'UI_Gacha_Result_BG_01';
export const SE_RESULT_SSR = 'UI_Gacha_Result_SSR';

/**
 * 节拍（毫秒）—— D3 逐张揭示时序
 * 单卡背→翻→面→彩虹环的各段见 GachaSingleCard 内部 STEP 常量（组件内聚），
 * 这里只放总控层用到的段落。
 */
export const T = {
  ENTER: 1800, // 阿罗娜/普拉娜抽签进场
  DRAW: 1500, // 抽签拉出 → 光球爆发
  HERO_TAIL: 260, // hero 演出结束后的台词卡前缓冲
  TALK: 1250, // 深蓝台词卡停驻
  TALK_GAP: 160, // 台词卡与下一张卡之间
  REVEAL_TAIL: 500, // 新★3 入学演出 → 结果页的收尾缓冲
} as const;

/** 有限池（限定/FES）用普拉娜，其余用阿罗娜 —— 与游戏一致 */
export function isPlanaPool(limited: boolean): boolean {
  return limited;
}

/** 本批结果的最高稀有度 */
export function bestStar(results: { star: 1 | 2 | 3 }[]): 1 | 2 | 3 {
  return results.reduce<1 | 2 | 3>((m, r) => (r.star > m ? r.star : m), 1);
}

// ------------------------------------------------------------ 数据加载（模块级缓存）

/** students_meta.json：招募 UI 最小字段件（id → cv/武器/学园枚举）。
 *  由 students_full.json 派生（30MB 全件不进运行时），工具脚本 gen_meta.py 产出。 */
export interface StudentMeta {
  id: number;
  /** CV 声优名（D2 招募主页立绘 CV 名条；315/513 有值，缺省如实不显示） */
  cv: string;
  /** 武器类型（SG/AR/HG/SMG/SR/MG…，契约书「武器」行） */
  weaponType: string;
  /** 学园枚举（契约书「社团」行，SCHOOL_LABEL 映射；未收录值显示「—」） */
  school: number | null;
}

let metaCache: Promise<Map<number, StudentMeta>> | null = null;
export function loadStudentsMeta(): Promise<Map<number, StudentMeta>> {
  if (!metaCache) {
    metaCache = fetch('/data/students_meta.json')
      .then((r) => (r.ok ? (r.json() as Promise<StudentMeta[]>) : Promise.reject(new Error(String(r.status)))))
      .then((list) => new Map(list.map((m) => [m.id, m])))
      .catch(() => new Map<number, StudentMeta>()); // 缺失按无 CV/武器/学园处理，不阻塞招募
  }
  return metaCache;
}

/** card_art.json：studentId → 卡面立绘本地路径（素材轨产出 193 条）。 */
let artCache: Promise<Record<string, string>> | null = null;
export function loadCardArt(): Promise<Record<string, string>> {
  if (!artCache) {
    artCache = fetch('/data/card_art.json')
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : {}))
      .catch(() => ({})); // 图源未就位：空表，走头像回退
  }
  return artCache;
}

/** hero/结果卡立绘图源：卡面立绘（card_art）→ 档案头像（avatar）兜底。 */
export function artOf(
  st: { id: number; avatar: string } | null,
  cardArt: Record<string, string>
): string | undefined {
  if (!st) return undefined;
  return cardArt[String(st.id)] || st.avatar || undefined;
}

/** 台词卡文本：优先档案签名（真数据），缺省摘档案简介首句；无档案时用招募通用句。
 *  DOM 上由调用方打 data-fallback-reason 标注「真机台词字幕无文本数据源，用档案真文本」 */
export function talkLineOf(st: { signature: string; intro: string } | null): string {
  if (!st) return '签约确认完毕。';
  const sig = (st.signature || '').trim();
  if (sig) return sig;
  const intro = (st.intro || '').trim().split(/\n|。/)[0]?.trim();
  return intro || '欢迎来到夏莱。';
}

/** hero 演出语音：取该生 voices 里第一条 Lobby 族（desc 形如 Hoshino_Lobby_1.ogg）。 */
export function lobbyVoiceOf(st: { voices: { file: string; desc: string; path: string }[] } | null):
  { path: string; label: string } | null {
  if (!st || !Array.isArray(st.voices)) return null;
  const v = st.voices.find((x) => /lobby/i.test(x.desc)) ?? st.voices[0];
  if (!v) return null;
  // 字幕条：真机显示台词文本，但语音台词文本无数据源（voice_id 为 CRC hash 型未破解），
  // 如实显示语音族标签，DOM 上另打 data-fallback-reason
  const seg = /([A-Za-z]+_)[Ll]obby_(\d+)/.exec(v.desc);
  const label = seg ? `语音 Lobby_${seg[2]}` : '招募语音';
  return { path: v.path, label };
}

// ------------------------------------------------------------ 官方概率披露原文（C-5）

/** 官方披露表行：{稀有度, 合计, UP 分项备注} —— 文案对齐官方公示口径 */
export interface ProbRow {
  star: string;
  rate: string;
  note: string;
}

/** 常驻/复刻池披露（报告一第五章多源交叉验证口径） */
export const PROB_NORMAL: ProbRow[] = [
  { star: '★★★', rate: '3.0%', note: '其中当期 Pick UP 0.7%' },
  { star: '★★', rate: '18.5%', note: '十连第 10 抽保底 ★2 以上' },
  { star: '★', rate: '78.5%', note: '—' },
];

/** FES 池披露（★3 翻倍 6%：当期 UP 0.7% + 其他 FES 0.9% + 常驻 4.4%；★1 降为 75.5%） */
export const PROB_FES: ProbRow[] = [
  { star: '★★★', rate: '6.0%', note: '当期 Pick UP 0.7% / 其他 FES 学生 0.9% / 常驻 4.4%' },
  { star: '★★', rate: '18.5%', note: '十连第 10 抽保底 ★2 以上' },
  { star: '★', rate: '75.5%', note: 'FES 池一星概率下调' },
];

/** 保底规则原文（按池模式） */
export const PITY_TEXT = {
  classic:
    '经典模式：每招募 1 次累计 1 点招募点数，满 200 点必得当期 Pick UP 学生且点数归零；中途歪出 UP 不清零，点数可跨池继承（同模式）。',
  charge:
    '充能模式：每招募 1 次 +1 充能，第 100 抽未出 UP 则必得 ★3（其中 50% 为 UP），第 200 抽必得当期 UP；获得 UP 立刻清零，一般池与限定池充能互不相通、不跨池继承。',
} as const;

/** 招募点数交换所规则原文（经典池，C-5） */
export const EXCHANGE_TEXT = [
  '经典池每招募 1 次获得 1 点招募点数。',
  '累计 200 点可直接兑换当期 Pick UP 学生（200 抽天井，达到后自动触发）。',
  '招募点数不可跨池继承：卡池结束后剩余点数将按 1:1 转化为制造石碎片。',
  '充能池（限定/FES）不产生招募点数，其保底走充能进度。',
] as const;

/** 新手池（starter）特判说明（C-12） */
export const STARTER_TEXT = '新手招募：十连招募必得 ★3 学生（每个账号限一次）。';
