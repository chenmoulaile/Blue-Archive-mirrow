/**
 * 语言/语音默认值断言
 *
 * 重构要求：UI 默认简体中文、语音默认日语，且「恢复默认」必须回到这两个值。
 * 用法：node scripts/test-config.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const TMP = 'scripts/.tmp-cfg';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

await build({
  entryPoints: ['src/core/config.ts', 'src/core/i18n.ts'],
  outdir: TMP,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'node20',
  logLevel: 'error',
});

const C = await import(pathToFileURL(path.resolve(TMP, 'config.js')).href);
const I = await import(pathToFileURL(path.resolve(TMP, 'i18n.js')).href);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('\n[语言 / 语音默认值]');
check('默认 UI 语言 = zh-CN', C.DEFAULT_LOCALE === 'zh-CN', C.DEFAULT_LOCALE);
check('默认语音 = ja', C.DEFAULT_VOICE === 'ja', C.DEFAULT_VOICE);
check('DEFAULT_SETTINGS.locale = zh-CN', C.DEFAULT_SETTINGS.locale === 'zh-CN');
check('DEFAULT_SETTINGS.voice = ja', C.DEFAULT_SETTINGS.voice === 'ja');
check('默认主题 = dark-game', C.DEFAULT_SETTINGS.theme === 'dark-game', C.DEFAULT_SETTINGS.theme);
check('assertDefaults 不抛错', (() => {
  try {
    C.assertDefaults();
    return true;
  } catch {
    return false;
  }
})());

console.log('\n[恢复默认]');
const r = C.resetSettings();
check('resetSettings 返回 zh-CN', r.locale === 'zh-CN');
check('resetSettings 返回 ja', r.voice === 'ja');
r.locale = 'en';
check('resetSettings 是深拷贝（改动不污染默认值）', C.DEFAULT_SETTINGS.locale === 'zh-CN');

console.log('\n[i18n]');
I.setLocale('zh-CN');
check('zh-CN 有词条', I.t('nav.story') === '剧情', I.t('nav.story'));
I.setLocale('en');
check('缺失词条显示「未同步」而不是英文', I.t('nav.story') === '未同步', I.t('nav.story'));
check('zh-CN 覆盖率 100%', Math.round(I.coverage('zh-CN') * 100) === 100, `${Math.round(I.coverage('zh-CN') * 100)}%`);
check('en 覆盖率为 0（尚未翻译）', I.coverage('en') === 0, `${Math.round(I.coverage('en') * 100)}%`);

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项未通过`}\n`);
rmSync(TMP, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
