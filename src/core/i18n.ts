/**
 * 极简 i18n
 *
 * 词条表放在 data/i18n/ 下：
 *   zh-CN.json  完整表（唯一必须齐全的语言）
 *   en / ja / zh-TW.json  可选覆盖，缺的键显示「未同步」
 *
 * 用静态 JSON import 而不是 fetch：页面模块顶层就会调用 t()（例如底部导航的 label），
 * 异步加载会拿到空串。JSON 在构建期被打进 bundle，仍然是同步的。
 *
 * 规则（来自重构要求）：
 *   - 默认 zh-CN，不得回退英文；
 *   - 某个语言缺词条时显示「未同步」，而不是拿英文顶上。
 */

import zhCN from '../../data/i18n/zh-CN.json';
import zhTW from '../../data/i18n/zh-TW.json';
import ja from '../../data/i18n/ja.json';
import en from '../../data/i18n/en.json';
import { DEFAULT_LOCALE, type Locale } from './config';

type Dict = Record<string, string>;

/** 覆盖表里用 "_note" 写说明，不算词条 */
function stripNote(d: Dict): Dict {
  const { _note, ...rest } = d as Dict & { _note?: string };
  return rest;
}

const DICTS: Record<Locale, Dict> = {
  'zh-CN': stripNote(zhCN as Dict),
  'zh-TW': stripNote(zhTW as Dict),
  ja: stripNote(ja as Dict),
  en: stripNote(en as Dict),
};

let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 词条里的 {name} 占位符替换 */
function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * 取词条。当前语言缺该词条时返回「未同步」占位，不回退英文。
 * zh-CN 自己缺键时直接返回 key，方便开发期发现漏翻。
 */
export function t(
  key: string,
  locale: Locale = current,
  params?: Record<string, string | number>
): string {
  const hit = DICTS[locale][key];
  if (hit) return interpolate(hit, params);
  return locale === 'zh-CN' ? key : '未同步';
}

/** 该语言是否已有该词条（用于设置页提示「未同步」比例） */
export function hasKey(key: string, locale: Locale): boolean {
  return Boolean(DICTS[locale][key]);
}

/** 词条覆盖率，设置页展示用 */
export function coverage(locale: Locale): number {
  const base = DICTS['zh-CN'];
  const total = Object.keys(base).length;
  const dict = DICTS[locale];
  const n = Object.keys(base).filter((k) => dict[k]).length;
  return total === 0 ? 0 : n / total;
}

/** 完整词条表（供测试断言用） */
export function keysOf(locale: Locale): string[] {
  return Object.keys(DICTS[locale]);
}
