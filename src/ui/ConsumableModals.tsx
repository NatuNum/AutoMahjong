import React from 'react';
import { TILE_META } from '../config/tiles';
import type { TileCode, TileInstance } from '../core/types';
import { TileCard } from './TileCard';

interface MagicalDrawModalProps {
  availability: Uint8Array;
  onSelect: (code: TileCode) => void;
  onClose: () => void;
}

const SUIT_GROUPS: { title: string; codes: number[] }[] = [
  { title: '만수 (빨강)', codes: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  { title: '통수 (파랑)', codes: [9, 10, 11, 12, 13, 14, 15, 16, 17] },
  { title: '삭수 (초록)', codes: [18, 19, 20, 21, 22, 23, 24, 25, 26] },
  { title: '자패 (풍·삼원)', codes: [27, 28, 29, 30, 31, 32, 33] },
];

export const MagicalDrawModal: React.FC<MagicalDrawModalProps> = ({
  availability,
  onSelect,
  onClose,
}) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, color: '#fde047' }}>✨ 매지컬 드로우 — 패산에서 패 선택</h2>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              패산에 남아있는 패만 가져올 수 있습니다. (이미 4장이 모두 사용·폐기된 패는 선택 불가)
            </div>
          </div>
          <button className="btn" onClick={onClose}>
            취소 ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {SUIT_GROUPS.map((grp) => (
            <div key={grp.title}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#cbd5e1', marginBottom: 6 }}>
                {grp.title}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {grp.codes.map((code) => {
                  const rem = availability[code];
                  const disabled = rem <= 0;
                  return (
                    <button
                      key={code}
                      disabled={disabled}
                      onClick={() => onSelect(code)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.25 : 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <TileCard code={code} />
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: disabled ? '#64748b' : '#fde047',
                        }}
                      >
                        잔여 {rem}장
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface RankShiftModalProps {
  tile: TileInstance;
  onShift: (delta: 1 | -1) => void;
  onClose: () => void;
}

export const RankShiftModal: React.FC<RankShiftModalProps> = ({ tile, onShift, onClose }) => {
  const meta = TILE_META[tile.code];
  const canMinus = tile.rank > 1;
  const canPlus = tile.rank < 9;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, color: '#fde047', textAlign: 'center' }}>패 숫자 ±1 변경권</h2>
        <div style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>
          선택된 패: <b>{meta.koreanName}</b> (1→-1, 9→+1 순환 불가)
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22, padding: '12px 0' }}>
          <button
            className="btn btn-sky"
            disabled={!canMinus}
            onClick={() => onShift(-1)}
            style={{ minWidth: 110 }}
          >
            -1 ({canMinus ? TILE_META[tile.code - 1].shortLabel : '불가'})
          </button>
          <TileCard code={tile.code} />
          <button
            className="btn btn-primary"
            disabled={!canPlus}
            onClick={() => onShift(1)}
            style={{ minWidth: 110 }}
          >
            +1 ({canPlus ? TILE_META[tile.code + 1].shortLabel : '불가'})
          </button>
        </div>
        <button className="btn" onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
};
