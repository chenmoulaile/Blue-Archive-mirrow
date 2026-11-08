/**
 * StoryHistory — 对话回看面板
 *
 * 行结构：speaker + text；选项行标记「▶ 选择了：」；分支行标记分支号。
 * 支持分支上下文（choice 与所选分支都进日志）。
 */
export interface HistoryRow {
  kind: 'say' | 'info' | 'mark' | 'choice';
  speaker: string;
  text: string;
  /** choice 行记录用户所选分支内容 */
  chosen?: string;
}

export function StoryHistory({ rows, onClose }: { rows: HistoryRow[]; onClose: () => void }) {
  return (
    <div
      className="history-panel"
      data-testid="story-history"
      onClick={onClose}
    >
      <h4>对话回看（点击空白处关闭）</h4>
      {rows.length === 0 && <div className="muted">还没有记录</div>}
      {rows.map((h, i) => (
        <div className="history-row" key={i}>
          {h.kind === 'say' && <b>{h.speaker}</b>}
          {h.kind === 'choice' && (
            <b className="history-choice-tag">选项</b>
          )}
          {h.kind === 'choice' ? `选择了：${h.chosen ?? ''}` : h.text}
        </div>
      ))}
    </div>
  );
}
