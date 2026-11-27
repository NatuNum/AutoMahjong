import type { EnemyArchetype, GridPos } from '../core/types';

export interface EnemyBaseSpec {
  archetype: EnemyArchetype;
  name: string;
  hp: number;
  atk: number;
  aspd: number;
  range: number;
  moveCooldown: number;
  color: string;
  accentColor: string;
}

export const ENEMY_SPECS: Record<EnemyArchetype, EnemyBaseSpec> = {
  SWARM: {
    archetype: 'SWARM',
    name: '묵화 요괴',
    hp: 140,
    atk: 12,
    aspd: 1.15,
    range: 1,
    moveCooldown: 0.45,
    color: '#334155',
    accentColor: '#94a3b8',
  },
  BRUISER: {
    archetype: 'BRUISER',
    name: '기하 골렘',
    hp: 520,
    atk: 34,
    aspd: 0.7,
    range: 1,
    moveCooldown: 0.8,
    color: '#78350f',
    accentColor: '#f59e0b',
  },
  SNIPER: {
    archetype: 'SNIPER',
    name: '그림자 궁수',
    hp: 220,
    atk: 26,
    aspd: 0.85,
    range: 6,
    moveCooldown: 0.75,
    color: '#4c1d95',
    accentColor: '#c084fc',
  },
  BOSS: {
    archetype: 'BOSS',
    name: '심연의 대요괴',
    hp: 1575,
    atk: 38,
    aspd: 0.85,
    range: 2,
    moveCooldown: 0.75,
    color: '#7f1d1d',
    accentColor: '#ef4444',
  },
};

export interface WaveSpawnEntry {
  archetype: EnemyArchetype;
  pos: GridPos;
}

export const WAVE_COMPOSITIONS: Record<EnemyArchetype, readonly WaveSpawnEntry[]> = {
  SWARM: [
    { archetype: 'SWARM', pos: { row: 0, col: 6 } },
    { archetype: 'SWARM', pos: { row: 1, col: 7 } },
    { archetype: 'SWARM', pos: { row: 2, col: 6 } },
    { archetype: 'SWARM', pos: { row: 3, col: 6 } },
    { archetype: 'SWARM', pos: { row: 4, col: 7 } },
    { archetype: 'SWARM', pos: { row: 5, col: 6 } },
    { archetype: 'SWARM', pos: { row: 2, col: 8 } },
    { archetype: 'SWARM', pos: { row: 3, col: 8 } },
  ],
  BRUISER: [
    { archetype: 'BRUISER', pos: { row: 1, col: 6 } },
    { archetype: 'BRUISER', pos: { row: 3, col: 6 } },
    { archetype: 'BRUISER', pos: { row: 4, col: 7 } },
  ],
  SNIPER: [
    { archetype: 'SWARM', pos: { row: 1, col: 6 } },
    { archetype: 'SWARM', pos: { row: 3, col: 6 } },
    { archetype: 'SWARM', pos: { row: 4, col: 6 } },
    { archetype: 'SNIPER', pos: { row: 0, col: 10 } },
    { archetype: 'SNIPER', pos: { row: 2, col: 11 } },
    { archetype: 'SNIPER', pos: { row: 3, col: 11 } },
    { archetype: 'SNIPER', pos: { row: 5, col: 10 } },
  ],
  BOSS: [
    { archetype: 'BOSS', pos: { row: 2, col: 8 } },
    { archetype: 'BRUISER', pos: { row: 3, col: 7 } },
    { archetype: 'SNIPER', pos: { row: 0, col: 11 } },
    { archetype: 'SNIPER', pos: { row: 5, col: 11 } },
  ],
};

export const NORMAL_WAVE_POOL: readonly EnemyArchetype[] = ['SWARM', 'BRUISER', 'SNIPER'] as const;

export const BOSS_SLAM_INTERVAL_SEC = 6.0;
export const BOSS_SLAM_TELEGRAPH_SEC = 0.8;
export const BOSS_SLAM_ATK_MULT = 1.6;
export const BOSS_ENRAGE_START_SEC = 20.0;
export const BOSS_ENRAGE_TICK_SEC = 5.0;
export const BOSS_ENRAGE_ATK_BONUS = 0.25;
export const BOSS_ENRAGE_ASPD_BONUS = 0.15;

export function getEnemyHpScale(round: number): number {
  const tier = Math.floor((round - 1) / 5);
  return (1 + 0.25 * (round - 1)) * Math.pow(1.15, tier);
}

export function getEnemyAtkScale(round: number): number {
  const tier = Math.floor((round - 1) / 5);
  return (1 + 0.16 * (round - 1)) * Math.pow(1.08, tier);
}

export function isBossRound(round: number): boolean {
  return round > 0 && round % 5 === 0;
}
