/**
 * 羁绊剧情触发卡片：数据 story 字段渲染成消息流里的附件卡。
 * 点「观看」→ navState.pendingStoryId = String(scenarioGroup) → go('story')，
 * StoryPage 用 storyIndex.find(s => s.id === pendingStoryId) 接住
 * （bond 条目 id 就等于 scenarioGroup，已验证 864 处 0 断链）。
 */
import { NineSlice } from '../NineSlice';
import { MOMO_SPRITES } from './types';
import { Glyph } from '../Glyph';

export interface StoryCardProps {
  title: string | null;
  favorRank: number;
  watched: boolean;
  /** M-9：流式区入场弹出动画（已读直显区不播） */
  animate?: boolean;
  onWatch: () => void;
}

export function StoryCard({ title, favorRank, watched, animate, onWatch }: StoryCardProps) {
  return (
    <div className={`mt-storycard-wrap${animate ? ' anim' : ''}`}>
      <NineSlice name={MOMO_SPRITES.storyCard} className="mt-storycard" fillCenter={false}>
        <span className="mt-storycard-label">
          <Glyph name="story" size={16} />
          羁绊剧情 · 好感度 {favorRank} 解锁
        </span>
        <b className="mt-storycard-title">{title ?? '未知剧情'}</b>
        <button
          className={`mt-storycard-btn${watched ? ' watched' : ''}`}
          onClick={(e) => {
            e.stopPropagation(); // 不触发消息区的快进
            onWatch();
          }}
        >
          {watched ? '重看剧情' : '观看剧情'}
        </button>
      </NineSlice>
    </div>
  );
}
