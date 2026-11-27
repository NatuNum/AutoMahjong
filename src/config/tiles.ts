import type { Suit, TileCode, WindCode } from '../core/types';

export interface TileMeta {
  code: TileCode;
  suit: Suit;
  rank: number;
  shortLabel: string;
  hanja: string;
  koreanName: string;
  color: string;
  accentBg: string;
  isTerminal: boolean;
  isHonor: boolean;
  isTerminalOrHonor: boolean;
  isGreen: boolean;
}

export const TOTAL_TILE_TYPES = 34;
export const COPIES_PER_TILE = 4;
export const TOTAL_WALL_TILES = 136;

export const WIND_CODES: readonly WindCode[] = [27, 28, 29, 30] as const;
export const DRAGON_CODES: readonly TileCode[] = [31, 32, 33] as const;

export const SUIT_COLORS: Record<Suit, string> = {
  MAN: '#dc2626',   // 만수 = 빨강
  PIN: '#2563eb',   // 통수 = 파랑
  SOU: '#16a34a',   // 삭수 = 초록
  HONOR: '#7c3aed', // 자패 = 보라 (삼원패 중 발/중은 전용 강조색)
};

const HANJA_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_INFO: Record<number, { hanja: string; short: string; ko: string; color: string }> = {
  27: { hanja: '東', short: '동', ko: '동풍', color: '#4f46e5' },
  28: { hanja: '南', short: '남', ko: '남풍', color: '#4f46e5' },
  29: { hanja: '西', short: '서', ko: '서풍', color: '#4f46e5' },
  30: { hanja: '北', short: '북', ko: '북풍', color: '#4f46e5' },
  31: { hanja: '白', short: '백', ko: '백', color: '#475569' },
  32: { hanja: '發', short: '발', ko: '발', color: '#15803d' },
  33: { hanja: '中', short: '중', ko: '중', color: '#b91c1c' },
};

const GREEN_SET = new Set<TileCode>([19, 20, 21, 23, 25, 32]); // 2,3,4,6,8삭 + 발

export const TILE_META: readonly TileMeta[] = Array.from({ length: TOTAL_TILE_TYPES }, (_, code) => {
  if (code < 9) {
    const rank = code + 1;
    const isTerminal = rank === 1 || rank === 9;
    return {
      code,
      suit: 'MAN' as const,
      rank,
      shortLabel: `${rank}만`,
      hanja: `${HANJA_NUMS[rank]}萬`,
      koreanName: `${rank}만`,
      color: SUIT_COLORS.MAN,
      accentBg: '#fef2f2',
      isTerminal,
      isHonor: false,
      isTerminalOrHonor: isTerminal,
      isGreen: false,
    };
  }
  if (code < 18) {
    const rank = code - 8;
    const isTerminal = rank === 1 || rank === 9;
    return {
      code,
      suit: 'PIN' as const,
      rank,
      shortLabel: `${rank}통`,
      hanja: `${rank}筒`,
      koreanName: `${rank}통`,
      color: SUIT_COLORS.PIN,
      accentBg: '#eff6ff',
      isTerminal,
      isHonor: false,
      isTerminalOrHonor: isTerminal,
      isGreen: false,
    };
  }
  if (code < 27) {
    const rank = code - 17;
    const isTerminal = rank === 1 || rank === 9;
    return {
      code,
      suit: 'SOU' as const,
      rank,
      shortLabel: `${rank}삭`,
      hanja: `${rank}索`,
      koreanName: `${rank}삭`,
      color: SUIT_COLORS.SOU,
      accentBg: '#f0fdf4',
      isTerminal,
      isHonor: false,
      isTerminalOrHonor: isTerminal,
      isGreen: GREEN_SET.has(code),
    };
  }
  const info = HONOR_INFO[code];
  return {
    code,
    suit: 'HONOR' as const,
    rank: code - 26,
    shortLabel: info.short,
    hanja: info.hanja,
    koreanName: info.ko,
    color: info.color,
    accentBg: '#f5f3ff',
    isTerminal: false,
    isHonor: true,
    isTerminalOrHonor: true,
    isGreen: GREEN_SET.has(code),
  };
});

export function getTileMeta(code: TileCode): TileMeta {
  return TILE_META[code];
}

export function isSuupai(code: TileCode): boolean {
  return code >= 0 && code < 27;
}

export function suitOfCode(code: TileCode): Suit {
  if (code < 9) return 'MAN';
  if (code < 18) return 'PIN';
  if (code < 27) return 'SOU';
  return 'HONOR';
}

export function rankOfCode(code: TileCode): number {
  if (code < 9) return code + 1;
  if (code < 18) return code - 8;
  if (code < 27) return code - 17;
  return code - 26;
}
