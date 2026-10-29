/**
 * 音频管理
 *
 * BGM / SE 在公开 wiki 上没有可下载的文件，因此这里做「有则播放、无则静音」的降级：
 * 用户在 resources/bgm/ 或 resources/se/ 放入同名文件（如 Theme_10.ogg）即可生效。
 * 找不到时只尝试一次，之后不再重复请求，避免控制台刷 404。
 */

const EXT = ['ogg', 'mp3', 'wav'];

class AudioManager {
  private bgmEl: HTMLAudioElement | null = null;
  private currentBgm = '';
  private missing = new Set<string>();
  private bgmVolume = 0.5;
  private seVolume = 0.6;
  private sePool: HTMLAudioElement[] = [];

  setVolumes(bgm: number, se: number): void {
    this.bgmVolume = bgm;
    this.seVolume = se;
    if (this.bgmEl) this.bgmEl.volume = bgm;
  }

  /** 播放 BGM；同一首重复调用不会重头开始 */
  playBgm(id: string): void {
    if (!id || this.currentBgm === id) return;
    this.stopBgm();
    this.currentBgm = id;
    if (this.missing.has(id)) return;

    const el = new Audio();
    el.loop = true;
    el.volume = this.bgmVolume;
    let idx = 0;
    const tryNext = () => {
      if (idx >= EXT.length) {
        this.missing.add(id);
        return;
      }
      el.src = `/res/bgm/${id}.${EXT[idx++]}`;
      el.play().catch(() => {
        /* 交给 error 事件推进 */
      });
    };
    el.addEventListener('error', tryNext);
    this.bgmEl = el;
    tryNext();
  }

  stopBgm(): void {
    if (this.bgmEl) {
      this.bgmEl.pause();
      this.bgmEl.src = '';
      this.bgmEl = null;
    }
    this.currentBgm = '';
  }

  /**
   * SE 名字映射：剧情用 SE_DoorOpen_01，实际文件是 SFX_xxx（见 tools/fetch/map_se.py）。
   * 加载一次，缺失时退回原名。
   */
  private seMap: Record<string, { target: string }> | null = null;
  private async loadSeMap(): Promise<void> {
    if (this.seMap) return;
    try {
      const r = await fetch('/data/se_map.json');
      const j = (await r.json()) as { map?: Record<string, { target: string }> };
      this.seMap = j.map ?? {};
    } catch {
      this.seMap = {};
    }
  }

  playSe(id: string): void {
    if (!id || this.missing.has(id)) return;
    void this.loadSeMap().then(() => {
      const mapped = this.seMap?.[id]?.target ?? id;
      this.playSeFile(id, mapped);
    });
  }

  private playSeFile(id: string, file: string): void {
    let idx = 0;
    const el = new Audio();
    el.volume = this.seVolume;
    const tryNext = () => {
      if (idx >= EXT.length) {
        this.missing.add(id);
        return;
      }
      el.src = `/res/se/${file}.${EXT[idx++]}`;
      el.play().catch(() => {});
    };
    el.addEventListener('error', tryNext);
    this.sePool.push(el);
    if (this.sePool.length > 12) this.sePool.shift();
    tryNext();
  }

  /** 播放语音（有真实文件，必能播） */
  playVoice(path: string): void {
    if (!path) return;
    const el = new Audio(path);
    el.volume = this.seVolume;
    el.play().catch(() => {});
  }

  /** 音频缺失统计，设置页展示用 */
  get missingCount(): number {
    return this.missing.size;
  }
}

export const audio = new AudioManager();
