import React, { useState } from 'react';
import { COMBAT_TIMEOUT_SEC } from '../config/stats';
import { TILE_META } from '../config/tiles';
import type { FuroCandidate, GameState, KanCandidate } from '../core/types';
import { TileCard } from './TileCard';

interface DrawFuroBarProps {
  state: GameState;
  furoCandidates: FuroCandidate[];
  kanCandidates: KanCandidate[];
  selectedReplaceTileId: string | null;
  combatSpeed: 1 | 2 | 3;
  combatElapsedSec: number;
  aliveAllies: number;
  aliveEnemies: number;
  onStartDrawLoop: () => void;
  onOpenShop: () => void;
  onPlaceTsumoGrid: () => void;
  onPlaceTsumoBench: () => void;
  onDiscardTsumo: () => void;
  onDragStartTsumo: (e: React.DragEvent) => void;
  onExecuteKan: (cand: KanCandidate) => void;
  onResolveReplace: (dest: 'BENCH' | 'DISCARD') => void;
  onCancelReplace: () => void;
  onExecuteFuro: (candId: string) => void;
  onPassFuro: () => void;
  onStartCombat: () => void;
  onChangeCombatSpeed: (speed: 1 | 2 | 3) => void;
}

export const DrawFuroBar: React.FC<DrawFuroBarProps> = ({
  state,
  furoCandidates,
  kanCandidates,
  selectedReplaceTileId,
  combatSpeed,
  combatElapsedSec,
  aliveAllies,
  aliveEnemies,
  onStartDrawLoop,
  onOpenShop,
  onPlaceTsumoGrid,
  onPlaceTsumoBench,
  onDiscardTsumo,
  onDragStartTsumo,
  onExecuteKan,
  onResolveReplace,
  onCancelReplace,
  onExecuteFuro,
  onPassFuro,
  onStartCombat,
  onChangeCombatSpeed,
}) => {
  const [chiPickerDiscardIdx, setChiPickerDiscardIdx] = useState<number | null>(null);

  if (state.phase === 'PRE_SHOP') {
    return (
      <div className="action-bar">
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fde047' }}>
            라운드 {state.round} 사전 준비 (PRE_SHOP)
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            상점에서 대기필드 확장, 소모품, 영구 버프를 구매하거나 보드를 정리한 뒤 쯔모를 시작하세요.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={onOpenShop}>
            🛒 상점 열기 ({state.points} 점봉)
          </button>
          <button className="btn btn-emerald" onClick={onStartDrawLoop}>
            ▶ 쯔모 시작 (6회)
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'POST_SHOP_PREP') {
    return (
      <div className="action-bar">
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#6ee7b7' }}>
            최종 편성 &amp; 후반 상점 (POST_SHOP_PREP)
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            가로·세로 1직선 인접으로 슌쯔·커쯔를 배치하고, 후로 블록은 우클릭/R키로 회전할 수 있습니다.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-sky" onClick={onOpenShop}>
            🛒 후반 상점 ({state.points} 점봉)
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 18, padding: '12px 28px' }}
            onClick={onStartCombat}
          >
            ⚔️ 전투 시작!
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'COMBAT') {
    const remaining = Math.max(0, COMBAT_TIMEOUT_SEC - combatElapsedSec);
    return (
      <div className="action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fca5a5' }}>⚔️ 자동 전투 진행 중</div>
          <div className="hud-pill">아군 생존: <b style={{ color: '#4ade80' }}>{aliveAllies}</b></div>
          <div className="hud-pill">적군 생존: <b style={{ color: '#f87171' }}>{aliveEnemies}</b></div>
          <div className={`hud-pill ${remaining <= 15 ? 'danger' : ''}`}>
            ⏱ 제한시간: <b>{remaining.toFixed(1)}초</b>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#94a3b8', marginRight: 4 }}>배속:</span>
          {([1, 2, 3] as const).map((sp) => (
            <button
              key={sp}
              className={`btn ${combatSpeed === sp ? 'btn-primary' : ''}`}
              onClick={() => onChangeCombatSpeed(sp)}
            >
              {sp}x
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (state.phase === 'DRAW_LOOP') {
    if (state.drawSubPhase === 'GRID_REPLACE' && state.pendingPlacement) {
      const canBench =
        state.tiles.filter((t) => t.location === 'BENCH').length < state.benchCapacity;
      const isFuroOverflow = state.pendingPlacement.source === 'FURO_OVERFLOW';
      return (
        <div className="action-bar" style={{ borderColor: '#38bdf8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {!isFuroOverflow && <TileCard code={state.pendingPlacement.tile.code} />}
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#38bdf8' }}>
                {isFuroOverflow
                  ? '후로 후 전투 필드 12패 초과 — 내보낼 패를 선택하세요'
                  : '전투 필드 교체 — 내보낼 비고정 패를 그리드에서 클릭하세요'}
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
                {selectedReplaceTileId
                  ? '선택된 패를 대기필드로 보낼지, 무료 버릴지 선택하세요.'
                  : '파란 테두리로 표시된 아군 전투 그리드 패 중 1장을 클릭하세요.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-sky"
              disabled={!selectedReplaceTileId || !canBench}
              onClick={() => onResolveReplace('BENCH')}
            >
              대기필드로 이동
            </button>
            <button
              className="btn btn-danger"
              disabled={!selectedReplaceTileId}
              onClick={() => onResolveReplace('DISCARD')}
            >
              무료 버리기
            </button>
            {state.pendingPlacement.source === 'TSUMO' && (
              <button className="btn" onClick={onCancelReplace}>
                취소
              </button>
            )}
          </div>
        </div>
      );
    }

    if (state.drawSubPhase === 'FURO_SKIP_WAIT') {
      return (
        <div className="action-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#94a3b8' }}>시스템 버림패:</span>
            {state.currentDiscards.map((code, i) => (
              <TileCard key={i} code={code} />
            ))}
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 700 }}>
            후로 가능한 조합 없음 — 자동 스킵 중...
          </div>
        </div>
      );
    }

    if (state.drawSubPhase === 'FURO_CHECK') {
      const chiOptionsForPicker =
        chiPickerDiscardIdx !== null
          ? furoCandidates.filter(
              (c) => c.type === 'CHI' && c.discardIndex === chiPickerDiscardIdx,
            )
          : [];

      return (
        <div className="action-bar" style={{ borderColor: '#f59e0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fde047' }}>
                후로 찬스! (최대 1장 선택)
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>남은 쯔모: {state.drawRemaining}회</div>
            </div>

            {state.currentDiscards.map((code, dIdx) => {
              const forThis = furoCandidates.filter((c) => c.discardIndex === dIdx);
              const chis = forThis.filter((c) => c.type === 'CHI');
              const pon = forThis.find((c) => c.type === 'PON');
              const minkan = forThis.find((c) => c.type === 'MINKAN');

              return (
                <div
                  key={dIdx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 10,
                    background:
                      forThis.length > 0 ? 'rgba(250, 204, 21, 0.14)' : 'rgba(15, 23, 42, 0.5)',
                    border:
                      forThis.length > 0
                        ? '1px solid rgba(250, 204, 21, 0.6)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                  }}
                >
                  <TileCard code={code} />
                  {forThis.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {chis.length === 1 && (
                        <button
                          className="btn btn-emerald"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          onClick={() => onExecuteFuro(chis[0].id)}
                        >
                          치
                        </button>
                      )}
                      {chis.length > 1 && (
                        <button
                          className="btn btn-emerald"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          onClick={() => setChiPickerDiscardIdx(dIdx)}
                        >
                          치 ({chis.length}조합)
                        </button>
                      )}
                      {pon && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          onClick={() => onExecuteFuro(pon.id)}
                        >
                          퐁
                        </button>
                      )}
                      {minkan && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          onClick={() => onExecuteFuro(minkan.id)}
                        >
                          밍깡
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="btn" onClick={onPassFuro}>
            패스 ⏭
          </button>

          {chiPickerDiscardIdx !== null && chiOptionsForPicker.length > 1 && (
            <div className="modal-backdrop" onClick={() => setChiPickerDiscardIdx(null)}>
              <div
                className="modal-box"
                style={{ maxWidth: 520 }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ margin: 0, color: '#6ee7b7' }}>치(Chi) 조합 선택</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {chiOptionsForPicker.map((opt) => (
                    <button
                      key={opt.id}
                      className="btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                      }}
                      onClick={() => {
                        setChiPickerDiscardIdx(null);
                        onExecuteFuro(opt.id);
                      }}
                    >
                      <div style={{ display: 'flex', gap: 6 }}>
                        {opt.resultCodes.map((c, idx) => (
                          <TileCard key={idx} code={c} mini />
                        ))}
                      </div>
                      <span style={{ color: '#6ee7b7' }}>
                        {opt.resultCodes.map((c) => TILE_META[c].shortLabel).join(' - ')} 선택
                      </span>
                    </button>
                  ))}
                </div>
                <button className="btn" onClick={() => setChiPickerDiscardIdx(null)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // TSUMO subphase
    const canBench =
      state.tiles.filter((t) => t.location === 'BENCH').length < state.benchCapacity;

    return (
      <div className="action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fde047' }}>
              쯔모 (남은 횟수: {state.drawRemaining}회)
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              패를 그리드·대기필드로 드래그하거나 버튼으로 배치/버리기
            </div>
          </div>

          {state.currentTsumo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <TileCard
                code={state.currentTsumo.code}
                isDora={state.doraIndicators.includes(state.currentTsumo.code)}
                draggable
                onDragStart={onDragStartTsumo}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {kanCandidates.map((kc, idx) => (
            <button
              key={idx}
              className="btn btn-primary"
              onClick={() => onExecuteKan(kc)}
              title="깡 실행 시 거대 유닛화 + 영구 도라 +1 + 보너스 추가 쯔모"
            >
              ⚡ {kc.type === 'ANKAN' ? '안깡' : '가깡'} ({TILE_META[kc.tileCode].shortLabel})
            </button>
          ))}
          <button className="btn btn-emerald" onClick={onPlaceTsumoGrid}>
            전투 필드에 배치
          </button>
          <button className="btn btn-sky" disabled={!canBench} onClick={onPlaceTsumoBench}>
            대기필드에 보관
          </button>
          <button className="btn btn-danger" onClick={onDiscardTsumo}>
            무료 버리기
          </button>
        </div>
      </div>
    );
  }

  return <div className="action-bar" />;
};
