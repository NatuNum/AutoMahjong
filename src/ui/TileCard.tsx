import React from 'react';
import { TILE_META } from '../config/tiles';
import type { TileCode, UnitTier } from '../core/types';

interface TileCardProps {
  code: TileCode;
  tier?: UnitTier;
  isDora?: boolean;
  isLocked?: boolean;
  isClaimedRotated?: boolean;
  lockLabel?: string;
  mini?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const TIER_LABELS: Partial<Record<UnitTier, { text: string; bg: string }>> = {
  TOITSU: { text: '또이쯔', bg: '#0284c7' },
  SHUNTSU: { text: '슌쯔', bg: '#059669' },
  KOUTSU: { text: '커쯔', bg: '#ea580c' },
  ANKAN: { text: '안깡', bg: '#b45309' },
  MINKAN: { text: '밍깡', bg: '#c2410c' },
  KAKAN: { text: '가깡', bg: '#c2410c' },
};

export const TileCard: React.FC<TileCardProps> = React.memo(
  ({
    code,
    tier,
    isDora,
    isLocked,
    isClaimedRotated,
    lockLabel,
    mini,
    draggable,
    onDragStart,
    onClick,
    onContextMenu,
  }) => {
    const meta = TILE_META[code];
    const tierTag = tier && !mini ? TIER_LABELS[tier] : undefined;

    const classes = [
      'tile-card',
      mini ? 'mini' : '',
      tier && !mini ? `tier-${tier}` : '',
      isDora ? 'is-dora' : '',
      isClaimedRotated ? 'claimed-rotated' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        className={classes}
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={`${meta.koreanName}${isDora ? ' (도라)' : ''}${isLocked ? ' [후로/깡 고정]' : ''}`}
      >
        {tierTag && (
          <span className="tile-tier-tag" style={{ background: tierTag.bg }}>
            {tierTag.text}
          </span>
        )}
        {!meta.isHonor && (
          <span className="tile-num-badge" style={{ color: meta.color }}>
            {meta.rank}
          </span>
        )}
        <span className="tile-hanja" style={{ color: meta.color }}>
          {meta.hanja}
        </span>
        <span className="tile-sublabel">{meta.shortLabel}</span>
        {isLocked && !mini && (
          <span className="tile-lock-badge">🔒 {lockLabel ?? '후로'}</span>
        )}
      </div>
    );
  },
);
