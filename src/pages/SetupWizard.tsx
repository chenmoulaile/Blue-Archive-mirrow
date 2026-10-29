/**
 * 首次启动向导
 *
 * 只做一件事：确认素材从哪来。
 *   路径 1：游戏解包目录 → 之后可以跑 tools/fetch/extract_ui.py 提 UI 图集 / TMP 字体 / BGM
 *   路径 2：跳过 → 走 screenshot_crop 兜底，界面用中性占位图标
 *
 * 选择结果写 .userdata/config.json（主进程负责校验目录存在性），
 * 之后在设置页还能改。任何一步失败都只是提示，不阻塞启动。
 */
import { useState } from 'react';
import { t } from '../core/i18n';
import type { AppConfig, AppInfo } from '../types';

export default function SetupWizard({
  info,
  onDone,
}: {
  info: AppInfo;
  onDone: (cfg: AppConfig) => void;
}) {
  const [gameDir, setGameDir] = useState<string | null>(info.config.gameDir);
  const [wikiDir, setWikiDir] = useState<string | null>(info.config.wikiDir);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (which: 'game' | 'wiki'): Promise<void> => {
    setErr('');
    try {
      const dir = await window.baApi.pickDir(
        which === 'game' ? t('setup.gameDir') : t('setup.wikiDir')
      );
      if (!dir) return;
      if (which === 'game') setGameDir(dir);
      else setWikiDir(dir);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const finish = async (skip: boolean): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const cfg = await window.baApi.patchConfig({
        setupDone: true,
        ...(skip ? { gameDir: null } : { gameDir, wikiDir }),
      });
      onDone(cfg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <div className="setup-mark">BA</div>
          <div>
            <h2>{t('setup.title')}</h2>
            <p>{t('setup.lead')}</p>
          </div>
        </div>

        <section className="setup-row">
          <div className="setup-row-main">
            <b>{t('setup.gameDir')}</b>
            <p>{t('setup.gameHint')}</p>
            <code className={gameDir ? 'setup-path on' : 'setup-path'}>
              {gameDir ?? t('setup.notSet')}
            </code>
          </div>
          <button className="btn ghost sm" onClick={() => void pick('game')} disabled={busy}>
            {t('setup.pick')}
          </button>
        </section>

        <section className="setup-row">
          <div className="setup-row-main">
            <b>{t('setup.wikiDir')}</b>
            <p>{t('setup.wikiHint')}</p>
            <code className={wikiDir ? 'setup-path on' : 'setup-path'}>
              {wikiDir ?? info.defaultResourceDir}
            </code>
          </div>
          <button className="btn ghost sm" onClick={() => void pick('wiki')} disabled={busy}>
            {t('setup.pick')}
          </button>
        </section>

        {err && <div className="warn setup-err">{err}</div>}

        <footer className="setup-foot">
          <button className="btn ghost" onClick={() => void finish(true)} disabled={busy}>
            {t('setup.skip')}
          </button>
          <button className="btn" onClick={() => void finish(false)} disabled={busy}>
            {t('setup.done')}
          </button>
        </footer>
      </div>
    </div>
  );
}
