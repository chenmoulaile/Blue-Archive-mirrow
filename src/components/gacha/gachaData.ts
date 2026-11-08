/**
 * 招募演出用的素材与音效常量
 *
 * 所有 file 均来自 data/ui_atlas.json（origin: assetbundle，2497 条里抽出的 gacha 相关项），
 * 所有 SE 均来自 data/se_index.json（resources/se/*.wav 实测存在）。
 * 没有真素材的部分用 CSS 兜底，DOM 上打 data-ui-source="css-fallback" 标记，见各组件。
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

/** 阿罗娜半身像（真素材，预合成）；1=常态 2=笑（按 FES 用途拆的两张） */
export const ARONA_IMG = '/res/ui/extra/Image_Char_Arona.png';
export const ARONA_IMG_SMILE = '/res/ui/extra/Image_Char_Arona2.png';

/** 白色光球（加算贴图，黑底；CSS 里配 mix-blend-mode: screen 在暗底上等效 Unity additive） */
export const BALL_FX = '/res/ui/extra/FX_TEX_GachaBall9.png';

/** 阿罗娜眼部特效（真 alpha 的辉光贴图），SSR 时刻用 */
export const EYE_FX = '/res/ui/extra/FX_TEX_GT_Aronaeye1.png';

/** 招募申请表纸（新学生揭示用），真实游戏贴图 830×1064 */
export const SUBINFO_PAPER = '/res/ui/extra/Gacha_SubInfo.png';

/** 结果底纹（新学生揭示的背景），真实游戏贴图 512×512 */
export const RESUME_BG = '/res/ui/extra/Img_Gacha_BG_Resume.png';

// ------------------------------------------------------------ SE 播放链
// 名字全部在 data/se_index.json 里核对过：UI_Gacha_* 共 34 条，文件实存 resources/se/。

/** 转场 */
export const SE_TRANSITION = 'UI_Gacha_Transition_ST_01';
/** 普通抽卡机器链 */
export const SE_NORMAL_HANDLE = 'UI_Gacha_Normal_02';
export const SE_NORMAL_DROP = 'UI_Gacha_Normal_04';
export const SE_NORMAL_BURST = 'UI_Gacha_Explosion';
/** SSR 专属链（AroPla = 阿罗娜/普拉娜） */
export const SE_SSR_WIND = 'UI_Gacha_AroPla_SSR_Wind';
export const SE_SSR_CHIME = 'UI_Gacha_AroPla_SSR_Chime';
export const SE_SSR_IMPACT = 'UI_Gacha_AroPla_SSR_Impact';
export const SE_SSR_SIGN = 'UI_Gacha_AroPla_SSR_Sign';
export const SE_SSR_TAIL = 'UI_Gacha_AroPla_SSR_Tail_01';
/** 翻卡按稀有度 */
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

// ------------------------------------------------------------ 节拍（毫秒）
export const T = {
  ENTER: 1500, // 登场
  PULL: 1500, // 拉杆→爆发
  FLIP_STEP: 240, // 翻卡间隔
  FLIP_CARD: 520, // 单张翻转时长
  FLIP_TAIL: 700, // 最后一张后的停留
  REVEAL: 3200, // 新学生揭示
} as const;

/** 有限池（限定/FES）用普拉娜，其余用阿罗娜 —— 与游戏一致 */
export function isPlanaPool(limited: boolean): boolean {
  return limited;
}

/** 本批结果的最高稀有度 */
export function bestStar(results: { star: 1 | 2 | 3 }[]): 1 | 2 | 3 {
  return results.reduce<1 | 2 | 3>((m, r) => (r.star > m ? r.star : m), 1);
}
