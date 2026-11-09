/**
 * 招募演出 · 第一幕：抽签进场（D3）+ 拉杆爆发
 *
 * 场景 = UIWorkAronaSceneBG_Day（真素材）上，阿罗娜（Image_Char_Arona，真素材）
 * 或普拉娜（C-10：Plana_Composite.png，素材轨 mesh 蒙皮合成真件；Tablet/Sack
 * 蒙皮悬空已剔除，来源差异以 data-fallback-reason 标注）从左侧滑入；
 * 第二拍抽签拉出 → 光球爆发（FX_TEX_GachaBall9，加算贴图用 screen 混合）。
 */
import { ARONA_IMG, ARONA_IMG_SMILE, BALL_FX, EYE_FX, PLANA_IMG, ROOM_BG } from './gachaData';

export type EnterPhase = 'enter' | 'draw';

export function GachaEnterScene({
  plana,
  hasStar3,
  phase,
}: {
  plana: boolean;
  hasStar3: boolean;
  phase: EnterPhase;
}) {
  return (
    <div className="gcs-stage" data-gacha-scene="enter">
      <img className="gcs-room" src={ROOM_BG} alt="" data-ui-source="assetbundle" />
      <div className="gcs-room-dim" />

      {/* 角色：阿罗娜/普拉娜都走真素材（C-10 普拉娜已由素材轨合成） */}
      <div className={`gcs-char gcs-char-${phase}`} data-ui-source="assetbundle">
        {plana ? (
          <img
            className="gcs-plana"
            src={PLANA_IMG}
            alt="普拉娜"
            data-ui-source="assetbundle(合成)"
            data-fallback-reason="Plana_Composite 为素材轨 mesh 蒙皮合成件：Tablet_01/010 与 Sack 蒙皮后悬空已剔除，不含平板背包；伞为分离摆放"
          />
        ) : (
          <img
            className="gcs-arona"
            src={phase === 'draw' ? ARONA_IMG_SMILE : ARONA_IMG}
            alt="阿罗娜"
            data-ui-source="assetbundle"
          />
        )}
        {hasStar3 && phase === 'draw' && (
          <img className="gcs-eye-fx" src={EYE_FX} alt="" data-ui-source="assetbundle" />
        )}
      </div>

      {/* 抽签提示：真机十连开始前「阿罗娜抽签进场」的语义标注（纯 UI 文案） */}
      <div className="gcs-enter-hint">{plana ? '系统提示 · 抽签中' : '阿罗娜 · 抽签中'}</div>

      {/* 爆发光球：加算贴图（黑底）靠 mix-blend-mode: screen 抠掉黑底。
          必须是 .gcs-stage 的直接子节点 —— 中间任何带 transform/动画的包裹层
          会形成 stacking context 把混合隔离掉，黑底就会穿帮。 */}
      {phase === 'draw' && (
        <>
          <img className="gcs-burst" src={BALL_FX} alt="" data-ui-source="assetbundle" />
          <i className={`gcs-flash${hasStar3 ? ' ssr' : ''}`} />
        </>
      )}
    </div>
  );
}
