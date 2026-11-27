import type { UnitTier } from '../core/types';

export interface TierBaseStats {
  hp: number;
  atk: number;
  aspd: number;
  critChance: number;
  range: number;
  moveCooldown: number;
}

export const GRID_ROWS = 6;
export const ALLY_COLS = 6;
export const ENEMY_COLS = 6;
export const TOTAL_GRID_COLS = ALLY_COLS + ENEMY_COLS; // 12

export const MAX_GRID_LOGICAL_TILES = 12;
export const MAX_TOTAL_LOGICAL_TILES = 14;
export const INITIAL_BENCH_CAPACITY = 6;
export const MAX_BENCH_CAPACITY = 12;
export const INITIAL_LIVES = 3;
export const DRAWS_PER_ROUND = 6;

export const CRIT_MULTIPLIER = 1.5;
export const MAX_BASE_ASPD_MULTIPLIER = 2.0; // 기본 공격속도 최대 2배
export const SHUNTSU_PIERCE_RATIO = 0.6;     // 직선 관통 피해 60%
export const KAN_SPLASH_RATIO = 0.5;         // 3x3 스플래시 피해 50%

export const HEAD_AURA_YAKUHAI_BONUS = 0.10; // 역패 머리 +10%
export const HEAD_AURA_NORMAL_BONUS = 0.05;  // 그 외 머리 +5%

export const COMBAT_TICK_RATE = 30;
export const COMBAT_DT = 1 / COMBAT_TICK_RATE;
export const COMBAT_TIMEOUT_SEC = 60;

export const TIER_BASE_STATS: Record<UnitTier, TierBaseStats> = {
  ISOLATED: {
    hp: 120,
    atk: 18,
    aspd: 1.0,
    critChance: 0.05,
    range: 2,
    moveCooldown: 0.6,
  },
  TOITSU: {
    hp: 162,
    atk: 24,
    aspd: 1.05,
    critChance: 0.05,
    range: 2,
    moveCooldown: 0.6,
  },
  SHUNTSU: {
    hp: 180,
    atk: 30,
    aspd: 1.2,
    critChance: 0.1,
    range: 2,
    moveCooldown: 0.55,
  },
  KOUTSU: {
    hp: 270,
    atk: 37,
    aspd: 0.95,
    critChance: 0.05,
    range: 2,
    moveCooldown: 0.65,
  },
  MINKAN: {
    hp: 1134,
    atk: 155,
    aspd: 0.95,
    critChance: 0.05,
    range: 2,
    moveCooldown: 0.7,
  },
  KAKAN: {
    hp: 1134,
    atk: 155,
    aspd: 0.95,
    critChance: 0.05,
    range: 2,
    moveCooldown: 0.7,
  },
  ANKAN: {
    hp: 1296,
    atk: 177,
    aspd: 1.0,
    critChance: 0.08,
    range: 2,
    moveCooldown: 0.7,
  },
};

export const YAKU_CATEGORY_BUFFS = {
  SPEED_CRIT: { aspdPerHan: 0.12, critPerHan: 0.06 },
  TANK_POWER: { hpPerHan: 0.18, atkPerHan: 0.12 },
  FINAL_AMP: { ampPerHan: 0.14 },
  YAKUHAI: { selfAllStat: 0.35, teamAtk: 0.06 },
  COMMON: { menzenMult: 0.08, doraPerTile: 0.08 },
} as const;
