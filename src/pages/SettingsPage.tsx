import { useEffect, useState } from 'react';
import { useApp } from '../core/AppContext';
import { store, useSave } from '../core/store';
import {
  LOCALES,
  LOCALE_LABEL,
  VOICE_LANGS,
  VOICE_LABEL,
  DEFAULT_LOCALE,
  DEFAULT_VOICE,
  resetSettings,
  type Locale,
  type VoiceLang,
} from '../core/config';
import { coverage, t } from '../core/i18n';
import { countEstimates } from '../core/game-ui-spec';
import type { View } from '../core/AppContext';

export default function SettingsPage({ onGo }: { onGo: (v: View) => void }) {
  const { assets, resourceDir, toast, uiAtlas } = useApp();
  const save = useSave();
  const [resDir, setResDir] = useState(resourceDir);

  // BGM/SE 有没有落地：HEAD 探几个代表文件，探不到就按「未同步」显示，不弹错误
  const [audioOk, setAudioOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const probes = [
      '/res/bgm/Theme_01.ogg',
      '/res/se/SE_DoorOpen_01.ogg',
      '/res/bgm/Theme_10.ogg',
    ];
    void (async () => {
      for (const p of probes) {
        try {
          const r = await fetch(p, { method: 'HEAD' });
          if (r.ok) {
            if (alive) setAudioOk(true);
            return;
          }
        } catch {
          /* 换下一个候选 */
        }
      }
      if (alive) setAudioOk(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setResDir(resourceDir), [resourceDir]);

  const set = <K extends keyof typeof save.settings>(key: K, value: (typeof save.settings)[K]) => {
    store.update((d) => {
      d.settings[key] = value;
    });
  };

  const spec = countEstimates();
  const spriteCount = Object.keys(uiAtlas.sprites).length;

  return (
    <div className="settings-grid">
      <div className="panel">
        <h4>{t('settings.language')}</h4>
        <div className="warn" style={{ marginBottom: 10 }}>
          {t('settings.defaultHint')}
        </div>
        <div className="field">
          <span>{t('settings.uiLanguage')}</span>
          <select
            value={save.settings.locale}
            onChange={(e) => set('locale', e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABEL[l]}
                {l === DEFAULT_LOCALE ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>{t('settings.voiceLanguage')}</span>
          <select
            value={save.settings.voice}
            onChange={(e) => set('voice', e.target.value as VoiceLang)}
          >
            {VOICE_LANGS.map((v) => (
              <option key={v} value={v}>
                {VOICE_LABEL[v]}
                {v === DEFAULT_VOICE ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>词条覆盖率</span>
          <div className="muted" style={{ fontSize: 12 }}>
            当前语言 {Math.round(coverage(save.settings.locale) * 100)}%（缺词条显示「未同步」，不回退英文）
          </div>
        </div>
        <div className="field">
          <span>{t('settings.restoreDefault')}</span>
          <button
            className="btn ghost sm"
            onClick={() => {
              const d = resetSettings();
              store.update((s) => {
                s.settings = { ...d };
              });
              toast('已恢复默认：简体中文 + 日语语音');
            }}
          >
            {t('settings.restoreDefault')}
          </button>
        </div>
      </div>

      <div className="panel">
        <h4>界面表现</h4>
        <div className="field">
          <span>{t('settings.intro')}</span>
          <input
            type="checkbox"
            checked={save.settings.playIntro}
            onChange={(e) => set('playIntro', e.target.checked)}
          />
        </div>
        <div className="field">
          <span>主题</span>
          <select
            value={save.settings.theme}
            onChange={(e) => set('theme', e.target.value as 'dark-game' | 'light')}
          >
            <option value="dark-game">深色游戏风（默认）</option>
            <option value="light">浅色网页风</option>
          </select>
        </div>
        <div className="field">
          <span>{t('settings.cursor')}</span>
          <input
            type="checkbox"
            checked={save.settings.useCustomCursor}
            onChange={(e) => set('useCustomCursor', e.target.checked)}
          />
        </div>
        <div className="field">
          <span>文字速度（字/秒）</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={10}
              max={120}
              value={save.settings.textSpeed}
              onChange={(e) => set('textSpeed', Number(e.target.value))}
            />
            <span className="muted" style={{ width: 34, textAlign: 'right' }}>
              {save.settings.textSpeed}
            </span>
          </div>
        </div>
        <div className="field">
          <span>自动播放间隔（毫秒）</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={600}
              max={4000}
              step={100}
              value={save.settings.autoDelay}
              onChange={(e) => set('autoDelay', Number(e.target.value))}
            />
            <span className="muted" style={{ width: 44, textAlign: 'right' }}>
              {save.settings.autoDelay}
            </span>
          </div>
        </div>
        <div className="field">
          <span>BGM 音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(save.settings.bgmVolume * 100)}
            onChange={(e) => set('bgmVolume', Number(e.target.value) / 100)}
          />
        </div>
        <div className="field">
          <span>音效 / 语音音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(save.settings.seVolume * 100)}
            onChange={(e) => set('seVolume', Number(e.target.value) / 100)}
          />
        </div>
      </div>

      <div className="panel">
        <h4>UI 还原进度</h4>
        <div className="field">
          <span>游戏内 UI 图集</span>
          <div className="muted" style={{ fontSize: 12 }}>
            {uiAtlas.source === 'assetbundle'
              ? `已提取 ${spriteCount} 个原件（AssetBundle）`
              : uiAtlas.source === 'screenshot_crop'
                ? `已切图 ${spriteCount} 个（截图还原，非原始图集）`
                : '未提取（当前使用兜底样式，控件均标记 data-ui-source="css-fallback"）'}
          </div>
        </div>
        <div className="field">
          <span>{t('settings.calibration')}</span>
          <div className="muted" style={{ fontSize: 12 }}>
            {t('settings.calibrated', save.settings.locale, {
              done: spec.total - spec.estimate,
              total: spec.total,
            })}
            {spec.estimate > 0 && `，剩 ${spec.estimate} 项为估算值`}
          </div>
        </div>
        <div className="field">
          <span>{t('settings.audio')}</span>
          <div className="muted" style={{ fontSize: 12 }}>
            {audioOk === null ? '检测中…' : audioOk ? '已检测到本地音频文件' : t('settings.audioUnsynced')}
          </div>
        </div>
        <div className="field">
          <span>Spine 运行时</span>
          <div className="muted" style={{ fontSize: 12 }}>
            spine-webgl 4.2.120（素材头 4.2.33 ~ 4.2.43）
          </div>
        </div>
        <div className="warn" style={{ marginTop: 8 }}>
          回忆大厅素材是 4.2 的二进制 <code>.skel</code>，3.8 运行时读不了，所以不做可切换项。
          要支持游戏原始 <code>assets-_mx-spinelobbies</code> 里的 3.8 资源，得另外内置 3.8 运行时，
          当前版本没有。
        </div>
      </div>

      <div className="panel">
        <h4>{t('settings.assets')}</h4>
        <div className="field">
          <div>
            素材目录
            <div className="muted" style={{ fontSize: 11.5 }}>{resDir}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn ghost sm"
              onClick={async () => {
                const next = await window.baApi.setResourceDir();
                if (next) {
                  setResDir(next);
                  toast('素材目录已更新，重启软件后生效');
                }
              }}
            >
              选择目录
            </button>
            <button className="btn ghost sm" onClick={() => void window.baApi.openResourceDir()}>
              打开
            </button>
          </div>
        </div>
        <div className="field">
          <div>已加载素材</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {assets.map.counts.spines} 个 Spine · {assets.map.counts.images} 张图 ·{' '}
            {assets.storyIndex.length} 集剧情 · {assets.students.length} 名学生
          </div>
        </div>
        <div className="field">
          <span>一键补给 120,000 青辉石 + 5,000,000 信用点（测试用）</span>
          <button
            className="btn ghost sm"
            onClick={() => {
              store.update((d) => {
                // 补给到固定水位而非累加：反复点击结果一致（幂等），e2e 依赖该按钮补回抽卡预算
                d.currency.pyroxene = Math.max(d.currency.pyroxene, 120_000);
                d.currency.credit = Math.max(d.currency.credit ?? 0, 5_000_000);
              });
              toast('已补给 120,000 青辉石 + 5,000,000 信用点（测试用）');
            }}
          >
            重置
          </button>
        </div>
        <div className="field">
          <span>清空全部存档</span>
          <button
            className="btn ghost sm"
            onClick={async () => {
              if (!window.confirm('将清空签到、剧情进度、抽卡记录与咖啡厅布置，确定吗？')) return;
              await store.reset();
              toast('存档已清空');
              onGo('home');
            }}
          >
            清空
          </button>
        </div>
      </div>

      <div className="panel">
        <h4>{t('settings.about')}</h4>
        <div className="warn">
          本软件为非官方、非商业同人作品，与 NAT GAMES / NEXON / Yostar 无任何关联。
          <br />
          《蔚蓝档案》全部美术、音乐、剧情文本版权归 NAT GAMES / NEXON 所有。
          <br />
          本软件不包含任何游戏数据库解密功能，不接入真实货币、支付渠道或账号系统；
          抽卡模拟完全离线，仅使用软件内生成的虚拟资源。
          <br />
          鼠标指针来自 makipom/BlueArchive-Cursors（MIT, © 2023 Maki）。
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <span>数据来源</span>
          <div className="muted" style={{ fontSize: 12 }}>
            kivo.wiki（基沃托斯古书馆）· bluearchive.wiki
          </div>
        </div>
      </div>
    </div>
  );
}
