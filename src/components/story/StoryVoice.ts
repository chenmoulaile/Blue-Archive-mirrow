/**
 * StoryVoice — 剧情台词语音播放器（S-2，报告一 S-2 / 任务书④）
 *
 * 数据轨契约：script 节点带 voiceId（CRC hash 数字）+ voiceKr/voiceJp（可读
 * 路径，如 Audio/VOC_JP/JP_Main/Main_11000_001）。本地素材（resources/voice/，
 * http 挂 /res/voice/）：全库实测 voiceJp 唯一名 263 个、JP_Main 270 文件命中
 * 95.1%（Main_11000 系列）；KR_Main/11/ 也有同集 270 个。其余 17300+ 句剧情
 * 语音（KR_Main 全量）未入库（Steam 分卷容器未拆，572MiB）——按「有则播放、
 * 无则静音」的降级语义处理，不伪造。
 *
 * 停止语义（任务书④）：快进（skip）/ 回退（上一句）/ 跳过本集 / 关闭播放器
 * / LOG 打开时都 stop()。语音与 BGM/SE 通道独立（不动 core/audio.ts，领地外）。
 */

/** voiceJp/voiceKr 路径 → 本地 /res/voice/ URL；映射不出返回 null */
function voiceUrl(path: string | undefined): string | null {
  if (!path) return null;
  // "Audio/VOC_JP/JP_Main/Main_11000_001" -> "/res/voice/VOC_JP/JP_Main/Main_11000_001.ogg"
  const m = /^Audio\/(VOC_[A-Z]+\/.+)$/.exec(path.trim());
  if (!m) return null;
  return `/res/voice/${m[1]}.ogg`;
}

class StoryVoicePlayer {
  private el: HTMLAudioElement | null = null;
  private current = '';
  /** 探测过缺失的路径（错误事件只触发一次，之后直接跳过不刷 404） */
  private missing = new Set<string>();
  /** 成功播过的路径（跳过探测直接播） */
  private known = new Set<string>();

  /** 播一句台词语音；无素材或已缺失时静默（返回是否真正发起了播放） */
  play(voiceJp?: string, voiceKr?: string): boolean {
    this.stop();
    const candidates = [voiceJp, voiceKr].map(voiceUrl).filter((u): u is string => Boolean(u));
    const url = candidates.find((u) => !this.missing.has(u)) ?? null;
    if (!url) return false;
    const el = new Audio(url);
    el.volume = 0.9;
    el.addEventListener('error', () => this.missing.add(url), { once: true });
    el.addEventListener('playing', () => this.known.add(url), { once: true });
    this.el = el;
    this.current = url;
    void el.play().catch(() => {
      /* 自动播放策略或文件缺失：error 事件/静默兜底 */
    });
    return true;
  }

  /** 停止当前语音（快进/回退/跳过/关闭时调用） */
  stop(): void {
    if (this.el) {
      try {
        this.el.pause();
        this.el.removeAttribute('src');
      } catch {
        /* 元素可能已释放 */
      }
      this.el = null;
    }
    this.current = '';
  }

  get playing(): boolean {
    return Boolean(this.el);
  }

  get currentUrl(): string {
    return this.current;
  }

  /** 调试统计（设置页/开发模式可展示） */
  get stats(): { missing: number; known: number } {
    return { missing: this.missing.size, known: this.known.size };
  }
}

export const storyVoice = new StoryVoicePlayer();
