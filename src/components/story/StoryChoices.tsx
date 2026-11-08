/**
 * StoryChoices — 剧情选项（真分支）
 *
 * 数据轨交付的 choice 节点：{op:'choice', options:[{text, nextGroup}]}
 * nextGroup = choice 之后 branch === nextGroup 的连续节点段；'' = 单选项直接继续。
 * 按钮 data-testid="story-choice-btn" + data-choice-text 供 e2e 稳定点击。
 *
 * 按钮底板用已提取的通用按钮原件 TBG/Common_Btn_BG（68x70，九宫格切边
 * [32,25,32,40]）——BA 图集精灵是白色遮罩，这里 fillCenter=false + CSS
 * 上白色，与引擎 NGUI mColor 上色行为一致。
 */
import { NineSlice } from '../NineSlice';
import type { StoryChoiceOption } from '../../types';

export interface StoryChoicesProps {
  options: StoryChoiceOption[];
  onSelect: (option: StoryChoiceOption, index: number) => void;
}

export function StoryChoices({ options, onSelect }: StoryChoicesProps) {
  if (options.length === 0) return null;
  return (
    <div
      className="choice-overlay"
      data-testid="story-choices"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt, i) => (
        <NineSlice
          key={i}
          as="button"
          name="TBG/Common_Btn_BG"
          className="story-choice-btn"
          fillCenter={false}
          fallbackClassName="story-choice-btn-fallback"
          fallbackStyle={{
            background: 'rgba(255,255,255,0.94)',
            borderRadius: 11,
            border: '2px solid rgba(63,159,224,0.85)',
          }}
          style={{ backgroundColor: '#ffffff' }}
          onClick={() => onSelect(opt, i)}
        >
          <span className="story-choice-text" data-choice-text={opt.text}>
            {opt.text}
          </span>
        </NineSlice>
      ))}
    </div>
  );
}
