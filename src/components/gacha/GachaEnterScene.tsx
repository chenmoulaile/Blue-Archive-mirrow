/**
 * 招募演出 · 第一幕：系统室登场 + 拉杆爆发
 *
 * 场景 = UIWorkAronaSceneBG_Day（真素材）上，阿罗娜（Image_Char_Arona，真素材）
 * 或普拉娜（无预合成素材，CSS 剪影兜底并标注）从左侧滑入；
 * 第二拍拉杆 → 光球爆发（FX_TEX_GachaBall9，加算贴图用 screen 混合）。
 */
import { ARONA_IMG, ARONA_IMG_SMILE, BALL_FX, EYE_FX, ROOM_BG } from './gachaData';

export type EnterPhase = 'enter' | 'pull';

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

      {/* 角色：有真素材用真素材，普拉娜没有预合成图，走 CSS 剪影兜底 */}
      <div className={`gcs-char gcs-char-${phase}`} data-ui-source={plana ? 'css-fallback' : 'assetbundle'}>
        {plana ? (
          <div className="gcs-plana" data-ui-source="css-fallback" data-fallback-reason="Plana_Original_* 为 mesh 图集，缺少 rect 无法合成，未伪造">
            <i className="gcs-plana-halo" />
            <i className="gcs-plana-body" />
            <i className="gcs-plana-eye gcs-plana-eye-l" />
            <i className="gcs-plana-eye gcs-plana-eye-r" />
          </div>
        ) : (
          <img
            className="gcs-arona"
            src={phase === 'pull' ? ARONA_IMG_SMILE : ARONA_IMG}
            alt="阿罗娜"
            data-ui-source="assetbundle"
          />
        )}
        {hasStar3 && phase === 'pull' && (
          <img className="gcs-eye-fx" src={EYE_FX} alt="" data-ui-source="assetbundle" />
        )}
      </div>

      {/* 爆发光球：加算贴图在暗底上用 screen 混合 */}
      {phase === 'pull' && (
        <div className={`gcs-burst-wrap${hasStar3 ? ' ssr' : ''}`}>
          <img className="gcs-burst" src={BALL_FX} alt="" data-ui-source="assetbundle" />
          <i className={`gcs-flash${hasStar3 ? ' ssr' : ''}`} />
        </div>
      )}
    </div>
  );
}
