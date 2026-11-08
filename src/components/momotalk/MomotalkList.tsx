/**
 * MomoTalk 会话列表：头像 + 名字 + 最近一条消息预览 + 未读红点。
 *
 * 排序：今天生日的学生带星星置顶（游戏内生日拉炮行为的列表侧），
 * 其余按最近互动时间倒序，没互动过按解锁进度/characterId 稳定排序。
 */
import { UIIcon } from '../NineSlice';
import { MOMO_SPRITES, type MomoStudentRef } from './types';

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
  query: string;
  loading: boolean;
  onQuery: (q: string) => void;
  onOpen: (cid: number) => void;
}

export function MomotalkList({ entries, activeId, query, loading, onQuery, onOpen }: MomotalkListProps) {
  return (
    <div className="mt-list">
      <div className="mt-list-head">
        <UIIcon
          name={MOMO_SPRITES.momo}
          size={30}
          fallback={<span className="mt-list-head-glyph">◉</span>}
        />
        <b>MomoTalk</b>
        <span className="mt-list-count">{entries.length}</span>
      </div>
      <div className="mt-search">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="搜索学生…" />
      </div>
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
                    size={14}
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
        {entries.length === 0 && <div className="mt-empty">没有匹配的会话</div>}
      </div>
    </div>
  );
}
