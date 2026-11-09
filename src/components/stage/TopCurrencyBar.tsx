/**
 * P0-1 通用货币顶栏 —— 内页标准顶栏（报告二 A2）
 *
 * 原版形态：顶栏只有货币（体力/信用点/青辉石）+ 右侧商店/菜单图标 +
 * 左上返回；页面标题与签到胶囊都不在顶栏（签到内容归登录奖励弹窗，
 * 项目内暂无该弹窗，故不渲染任何签到元素）。
 *
 * 组件保持纯展示：数值全部来自 props，由 App.tsx（或页面轨）从 store 取值
 * 后传入。所有区块均可选——不传就不渲染，方便剧情播放器这类自带顶栏的
 * 页面按需组合。
 */
import type { ReactNode } from 'react';
import { UIIcon } from '../NineSlice';
import { Glyph } from '../Glyph';
import { TOP_CURRENCY_ICONS } from '../../core/game-ui-spec';

export interface TopCurrencyBarProps {
  /** 体力（AP）：value/max；不传则不显示体力块 */
  ap?: { value: number; max: number; title?: string };
  /** 信用点；不传则不显示 */
  credit?: number;
  /** 青辉石；不传则不显示 */
  pyroxene?: number;
  /** 货币数值的悬浮说明（如青辉石的获取途径提示） */
  currencyHint?: string;
  /** 左上返回钮文案；默认「大厅」（回到主界面）。不传 onBack 则不渲染返回钮 */
  backLabel?: string;
  /** 左上返回动作；内页标准行为是 go('home') */
  onBack?: () => void;
  /** 返回钮追加类名（e2e/页面轨定位用） */
  backClassName?: string;
  /** 页面标题（可选；原版顶栏没有标题，仅特殊页需要时使用） */
  title?: string;
  /** 右侧商店图标动作；不传则不渲染 */
  onShop?: () => void;
  /** 右侧菜单图标动作；不传则不渲染 */
  onMenu?: () => void;
  /** 顶栏右侧扩展位（追加自定义元素，排在货币之后） */
  right?: ReactNode;
  /** 货币图标尺寸（逻辑 px），默认 26 */
  iconSize?: number;
}

export default function TopCurrencyBar({
  ap,
  credit,
  pyroxene,
  currencyHint,
  backLabel = '大厅',
  onBack,
  backClassName,
  title,
  onShop,
  onMenu,
  right,
  iconSize = 26,
}: TopCurrencyBarProps) {
  return (
    <header className="tc-bar" data-top-currency-bar>
      {onBack && (
        <button
          className={`tc-back${backClassName ? ` ${backClassName}` : ''}`}
          onClick={onBack}
          title={backLabel}
        >
          <span className="tc-back-arrow" aria-hidden="true">
            ‹
          </span>
          {backLabel}
        </button>
      )}
      {title && <b className="tc-title">{title}</b>}
      <div className="tc-spacer" />
      <div className="tc-res">
        {ap && (
          <div className="tc-chip" title={ap.title ?? '体力'}>
            <UIIcon name={TOP_CURRENCY_ICONS.stamina.value} size={iconSize} fallback="⚡" />
            <b>
              {ap.value}/{ap.max}
            </b>
          </div>
        )}
        {credit != null && (
          <div className="tc-chip" title="信用点">
            <UIIcon name={TOP_CURRENCY_ICONS.credit.value} size={iconSize} fallback="◈" />
            <b>{credit.toLocaleString()}</b>
          </div>
        )}
        {pyroxene != null && (
          <div className="tc-chip" title={currencyHint ?? '青辉石'}>
            <UIIcon name={TOP_CURRENCY_ICONS.pyroxene.value} size={iconSize} fallback="✦" />
            <b>{pyroxene.toLocaleString()}</b>
          </div>
        )}
        {right}
      </div>
      {onShop && (
        <button
          className="tc-iconbtn"
          onClick={onShop}
          title="商店"
          data-ui-sprite="Common/Common_Icon_Shop"
        >
          <UIIcon name="Common/Common_Icon_Shop" size={iconSize + 4} fallback={<Glyph name="item" size={iconSize + 4} />} />
        </button>
      )}
      {onMenu && (
        <button
          className="tc-iconbtn"
          onClick={onMenu}
          title="菜单"
          data-ui-sprite="Common/Common_Icon_Option"
        >
          <UIIcon name="Common/Common_Icon_Option" size={iconSize + 4} fallback={<Glyph name="menu" size={iconSize + 4} />} />
        </button>
      )}
    </header>
  );
}
