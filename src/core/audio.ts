/**
 * 音频管理
 *
 * BGM / SE 的物理文件与扩展名都有索引表可查（2026-11-09 走查⑥）：
 *   * SE：data/se_map.json（剧情 SE 名 → 实际文件名）+ data/se_index.json
 *     （实际文件名 → /res/se/xx.wav 完整 URL，1198 条）。
 *   * BGM：data/bgm_map.json（契约 id → {source: "Audio/BGM/xx.ogg", extracted}，
 *     extracted=true 表示已拆到 resources/bgm/）。
 * 查表命中 → 直接按唯一 URL 播放（0 次探测 404）；查表失败（id 不在表 /
 * extracted=false 的上游缺失件）→ 退回旧的 ogg→mp3→wav 盲试兜底。
 * 「有则播放、无则静音」的降级语义与 missing 缓存不变。
 */

const EXT = ['ogg', 'mp3', 'wav'];

interface BgmEntry {
  source: string;
  extracted: boolean;
}

interface AudioMaps {
  /** se_index.json files：实际文件名 → 完整 URL（含扩展名） */
  seFiles: Record<string, string>;
  /** se_map.json map：剧情 SE 名 → 实际文件名 */
  seMap: Record<string, { target: string }>;
  /** bgm_map.json ids：契约 id → {source, extracted} */
  bgmIds: Record<string, BgmEntry>;
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url);
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

class AudioManager {
  private bgmEl: HTMLAudioElement | null = null;
  private currentBgm = '';
  private missing = new Set<string>();
  private bgmVolume = 0.5;
  private seVolume = 0.6;
  private sePool: HTMLAudioElement[] = [];
  private maps: Promise<AudioMaps> | null = null;

  setVolumes(bgm: number, se: number): void {
    this.bgmVolume = bgm;
    this.seVolume = se;
    if (this.bgmEl) this.bgmEl.volume = bgm;
  }

  /** 一次性拉取三张索引表（并行，任一 404/失败按空表降级） */
  private loadMaps(): Promise<AudioMaps> {
    if (!this.maps) {
      this.maps = Promise.all([
        fetchJson<Record<string, string>>('/data/se_index.json', {}).then((j) =>
          (j as { files?: Record<string, string> }).files ?? j
        ),
        fetchJson<{ map?: Record<string, { target: string }> }>('/data/se_map.json', {}).then(
          (j) => j.map ?? {}
        ),
        fetchJson<{ ids?: Record<string, BgmEntry> }>('/data/bgm_map.json', {}).then(
          (j) => j.ids ?? {}
        ),
      ]).then(([seFiles, seMap, bgmIds]) => ({ seFiles, seMap, bgmIds }));
    }
    return this.maps;
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
    void this.loadMaps().then(({ bgmIds }) => {
      // 已被 stopBgm / 换曲：不再出手
      if (this.currentBgm !== id) return;
      const entry = bgmIds[id];
      const ext = entry?.extracted ? entry.source.split('.').pop() : null;
      if (ext) {
        // 查表命中：单一扩展名直接命中，失败即缺失（不再盲试其它扩展名刷 404）
        el.src = `/res/bgm/${id}.${ext}`;
        el.addEventListener('error', () => this.missing.add(id), { once: true });
        el.play().catch(() => {
          /* 交给 error 事件 */
        });
        this.bgmEl = el;
      } else {
        // 表里没有（或 extracted=false 上游缺失）：旧盲试兜底（网络轨补件后仍可播）
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
    });
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
   * SE 名字链：剧情用 SE_DoorOpen_01 → se_map 映射实际名 → se_index 查完整 URL。
   * 查表任一步命中即直接播放（0 次探测 404）；全 miss 退回盲试兜底。
   */
  playSe(id: string): void {
    if (!id || this.missing.has(id)) return;
    void this.loadMaps().then(({ seFiles, seMap }) => {
      const mapped = seMap[id]?.target ?? id;
      const direct = seFiles[mapped] ?? seFiles[id];
      if (direct) {
        this.playSeUrl(id, direct);
      } else {
        this.playSeFile(id, mapped);
      }
    });
  }

  /** 查表命中的直连播放（URL 含真实扩展名） */
  private playSeUrl(id: string, url: string): void {
    const el = new Audio(url);
    el.volume = this.seVolume;
    el.addEventListener('error', () => this.missing.add(id), { once: true });
    this.sePool.push(el);
    if (this.sePool.length > 12) this.sePool.shift();
    el.play().catch(() => {});
  }

  /** 盲试兜底（表里查不到时的旧行为） */
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

  /**
   * 立刻停掉所有在播/排队中的 SE（招募演出跳过用）。
   * 只动 sePool，不影响 BGM 与语音。
   */
  stopSeAll(): void {
    for (const el of this.sePool) {
      try {
        el.pause();
        el.removeAttribute('src');
      } catch {
        /* 元素可能已释放 */
      }
    }
    this.sePool.length = 0;
  }

  /** 音频缺失统计，设置页展示用 */
  get missingCount(): number {
    return this.missing.size;
  }
}

export const audio = new AudioManager();
