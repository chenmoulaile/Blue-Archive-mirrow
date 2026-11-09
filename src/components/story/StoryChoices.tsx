/**
 * StoryChoices — 剧情选项（真分支）
 *
 * 数据轨交付的 choice 节点：{op:'choice', options:[{text, nextGroup}]}
 * nextGroup = choice 之后 branch === nextGroup 的连续节点段；'' = 单选项直接继续。
 * 按钮 data-testid="story-choice-btn" + data-choice-text 供 e2e 稳定点击。
 *
 * S-9（报告二对照）：真机选项为居中竖排半透明白色圆角按钮——底板改为
 * rgba 白（原 TBG/Common_Btn_BG 白模上纯白改为半透明白，形制对齐对照截图；
 * 素材缺失时 fallback 同款半透明白）。
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
            background: 'rgba(255,255,255,0.82)',
            borderRadius: 14,
            border: '2px solid rgba(255,255,255,0.65)',
          }}
          style={{ backgroundColor: 'rgba(255,255,255,0.82)' }}
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
