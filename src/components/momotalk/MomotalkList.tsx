/**
 * MomoTalk 会话列表页（竖屏全宽，页栈栈底；报告一 M-6、报告二 C2）。
 *
 * 顶部按真机形态重做（对照 6 原版截图 + PDF2 C2 条目）：
 *   粉色横幅顶栏（白色 MomoTalk logo + 音量喇叭）
 *   + 「未读消息(N)」计数条 + 排序下拉「最新▼」+ 筛选按钮（≡↓）。
 * 自创元素（搜索框、会话计数徽标）已按审计 M-6 移除。
 *
 * 列表行：圆形头像 + 粉圈未读数 + 名字 + 单行预览截断 + 生日挂件
 * （星星 + 「生日」标签；萌百机制描述原版为彩带装饰，无样式证据，
 * 保留现状实现并如实标注，行高/字号按 1080×1920 竖屏比例校准，
 * source: estimated）。
 */
import { useState } from 'react';
import { UIIcon } from '../NineSlice';
import { MOMO_SPRITES, type MomoStudentRef } from './types';

/** 排序模式：最新（默认，最近互动优先）/ 未读（未读段数优先） */
export type MomoSortMode = 'recent' | 'unread';

export interface MomoListEntry {
  ref: MomoStudentRef;
  /** 最近一条消息预览（未加载到记录时为 null） */
  preview: string | null;
  previewFrom: 'student' | 'teacher' | null;
  unread: number;
  /** 今天生日 */
  birthday: boolean;
  /** 最后互动时间戳（无则 0） */
  ts: number;
}

export interface MomotalkListProps {
  entries: MomoListEntry[];
  activeId: number | null;
  loading: boolean;
  /** 全部会话未读段数合计（「未读消息(N)」计数条） */
  unreadTotal: number;
  sort: MomoSortMode;
  onSort: (m: MomoSortMode) => void;
  onOpen: (cid: number) => void;
  /** 真机筛选按钮（未实装；点击由页面 toast） */
  onFilter: () => void;
}

const SORT_LABEL: Record<MomoSortMode, string> = { recent: '最新', unread: '未读' };

export function MomotalkList({
  entries,
  activeId,
  loading,
  unreadTotal,
  sort,
  onSort,
  onOpen,
  onFilter,
}: MomotalkListProps) {
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <div className="mt-list">
      {/* 粉色横幅顶栏：白色音量喇叭 + MomoTalk logo（对照 6 原版形制） */}
      <div className="mt-banner">
        <span className="mt-banner-speaker" data-ui-source="css-fallback" aria-hidden>
          <svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor">
            <path d="M3.5 9.4v5.2h4.1l5.2 4.6V4.8L7.6 9.4H3.5z" />
            <path d="M15.7 8.5a5.1 5.1 0 0 1 0 7l1.5 1.4a7.2 7.2 0 0 0 0-9.8l-1.5 1.4z" />
            <path d="M18.3 5.9a9 9 0 0 1 0 12.2l1.4 1.3a10.9 10.9 0 0 0 0-14.8l-1.4 1.3z" />
          </svg>
        </span>
        <UIIcon
          name={MOMO_SPRITES.momo}
          size={52}
          className="mt-banner-icon"
          fallback={<span className="mt-banner-glyph">◈</span>}
        />
        <b>MomoTalk</b>
      </div>

      {/* 未读消息(N) 计数条 + 排序下拉 + 筛选按钮（真机同行排布） */}
      <div className="mt-unread-row">
        <span className="mt-unread-bar">未读消息({unreadTotal})</span>
        <div className={`mt-sort${sortOpen ? ' open' : ''}`}>
          <button
            className="mt-sort-btn"
            onClick={() => setSortOpen((v) => !v)}
            title="排序方式"
          >
            {SORT_LABEL[sort]}
            <i className="mt-sort-caret">▼</i>
          </button>
          {sortOpen && (
            <div className="mt-sort-menu" role="listbox" aria-label="排序方式">
              {(Object.keys(SORT_LABEL) as MomoSortMode[]).map((m) => (
                <button
                  key={m}
                  className={m === sort ? 'on' : ''}
                  onClick={() => {
                    onSort(m);
                    setSortOpen(false);
                  }}
                >
                  {SORT_LABEL[m]}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="mt-filter-btn" onClick={onFilter} title="筛选">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 6.5h10M4 12h7M4 17.5h10" />
            <path d="M17.5 8v9m0 0-3-3m3 3 3-3" />
          </svg>
        </button>
      </div>

      {/* 会话列表 */}
      <div className="mt-rows">
        {entries.map((e) => (
          <button
            key={e.ref.characterId}
            className={`mt-row-item${activeId === e.ref.characterId ? ' on' : ''}${e.birthday ? ' birthday' : ''}`}
            onClick={() => onOpen(e.ref.characterId)}
          >
            <span className="mt-item-avatar">
              {e.ref.avatar && <img src={e.ref.avatar} alt="" loading="lazy" />}
              {e.unread > 0 && (
                <span className="mt-unread" data-unread={e.unread}>
                  {e.unread > 9 ? '9+' : e.unread}
                </span>
              )}
            </span>
            <span className="mt-item-txt">
              <b>
                {e.ref.name}
                {e.birthday && (
                  <UIIcon
                    name={MOMO_SPRITES.star}
                    size={22}
                    fallback={<span className="mt-star-fb">✦</span>}
                    className="mt-bday-star"
                  />
                )}
              </b>
              <span className={`mt-item-preview${e.previewFrom === 'teacher' ? ' mine' : ''}`}>
                {e.preview ?? (loading ? '…' : `${e.ref.threads} 段对话`)}
              </span>
            </span>
            {e.birthday && <span className="mt-bday-tag">生日</span>}
          </button>
        ))}
        {entries.length === 0 && (
          <div className="mt-empty">{loading ? '正在载入 MomoTalk…' : '没有会话'}</div>
        )}
      </div>
      {loading && <div className="mt-loading-bar" />}
    </div>
  );
}
