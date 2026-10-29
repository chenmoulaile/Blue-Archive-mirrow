/**
 * 全局配置与默认值
 *
 * 语言与语音的默认值是硬性要求，不允许被其他地方覆盖：
 *   UI 语言：简体中文（zh-CN）
 *   语音语言：日语（ja）
 *
 * 设置页可以切换，但「恢复默认」必须回到这两个值。
 * 单元测试见 scripts/test-config.mjs。
 */

export const LOCALES = ['zh-CN', 'zh-TW', 'ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const VOICE_LANGS = ['ja', 'zh-CN'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

/** UI 默认语言：简体中文 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';
/** 语音默认语言：日语 */
export const DEFAULT_VOICE: VoiceLang = 'ja';

export const LOCALE_LABEL: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  en: 'English',
};

export const VOICE_LABEL: Record<VoiceLang, string> = {
  ja: '日语',
  'zh-CN': '中文',
};

export interface Settings {
  locale: Locale;
  voice: VoiceLang;
  textSpeed: number;
  autoDelay: number;
  bgmVolume: number;
  seVolume: number;
  skipUnread: boolean;
  /** 是否播放启动流程（splash → 标题 → 加载） */
  playIntro: boolean;
  /** 是否使用 BA 主题鼠标指针 */
  useCustomCursor: boolean;
  /** 主题：dark-game = 深色游戏风（默认），light = 浅色网页风 */
  theme: 'dark-game' | 'light';
}

export const DEFAULT_SETTINGS: Settings = {
  locale: DEFAULT_LOCALE,
  voice: DEFAULT_VOICE,
  textSpeed: 45,
  autoDelay: 1600,
  bgmVolume: 0.5,
  seVolume: 0.6,
  skipUnread: false,
  playIntro: true,
  useCustomCursor: true,
  theme: 'dark-game',
};

/** 恢复默认时用的对象（深拷贝，避免被改） */
export function resetSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

/** 断言默认值没有被误改 */
export function assertDefaults(): void {
  if (DEFAULT_SETTINGS.locale !== 'zh-CN') {
    throw new Error(`默认 UI 语言必须是 zh-CN，当前 ${DEFAULT_SETTINGS.locale}`);
  }
  if (DEFAULT_SETTINGS.voice !== 'ja') {
    throw new Error(`默认语音必须是 ja，当前 ${DEFAULT_SETTINGS.voice}`);
  }
}
