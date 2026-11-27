import {
  BOSS_ENRAGE_ASPD_BONUS,
  BOSS_ENRAGE_ATK_BONUS,
  BOSS_ENRAGE_START_SEC,
  BOSS_ENRAGE_TICK_SEC,
  BOSS_SLAM_ATK_MULT,
  BOSS_SLAM_INTERVAL_SEC,
  BOSS_SLAM_TELEGRAPH_SEC,
  ENEMY_SPECS,
  WAVE_COMPOSITIONS,
  getEnemyAtkScale,
  getEnemyHpScale,
} from '../config/enemies';
import {
  ALLY_COLS,
  COMBAT_DT,
  COMBAT_TIMEOUT_SEC,
  CRIT_MULTIPLIER,
  GRID_ROWS,
  KAN_SPLASH_RATIO,
  MAX_BASE_ASPD_MULTIPLIER,
  SHUNTSU_PIERCE_RATIO,
  TIER_BASE_STATS,
  TOTAL_GRID_COLS,
} from '../config/stats';
import { findHeadDeployPositions, isKanGroup } from './gridOps';
import { SeededRng } from './prng';
import type {
  CombatUnit,
  EnemyArchetype,
  GameState,
  LockedGroup,
  TileInstance,
  UnitTier,
  YakuEvaluation,
} from './types';

export interface CombatVisualEvent {
  id: number;
  kind:
    | 'PROJECTILE'
    | 'PIERCE_BEAM'
    | 'SPLASH_RING'
    | 'DAMAGE_TEXT'
    | 'BOSS_SLAM'
    | 'YAKUMAN_FX';
  fromRow?: number;
  fromCol?: number;
  toRow: number;
  toCol: number;
  value?: number;
  isCrit?: boolean;
  label?: string;
  color: string;
  ttl: number;
  maxTtl: number;
}

export interface BossTelegraph {
  bossId: string;
  row: number;
  remainingSec: number;
  totalSec: number;
}

export interface CombatSimulation {
  round: number;
  waveArchetype: EnemyArchetype;
  evaluation: YakuEvaluation;
  units: CombatUnit[];
  rng: SeededRng;
  elapsedSec: number;
  tickCount: number;
  finished: boolean;
  won: boolean;
  timedOut: boolean;
  events: CombatVisualEvent[];
  telegraphs: BossTelegraph[];
  combatLog: string[];
  nextEventId: number;
  /** Yakuman periodic timers */
  chuurenTimer: number;
  daisangenTimer: number;
  tsuuiisouTimer: number;
  ryuuiisouTimer: number;
  kokushiFired: boolean;
  bossEnrageTimer: number;
  hasChuuren: boolean;
  hasDaisangen: boolean;
  hasSuuankou: boolean;
  hasKokushi: boolean;
  hasTsuuiisou: boolean;
  hasRyuuiisou: boolean;
  hasChinroutou: boolean;
  hasShousuushii: boolean;
  hasDaisuushii: boolean;
  hasSuukantsu: boolean;
}

function chebyshevDist(r1: number, c1: number, r2: number, c2: number): number {
  const dr = Math.abs(r1 - r2);
  const dc = Math.abs(c1 - c2);
  return dr > dc ? dr : dc;
}

function pushEvent(sim: CombatSimulation, ev: Omit<CombatVisualEvent, 'id'>): void {
  sim.events.push({ ...ev, id: sim.nextEventId++ });
}

function createAllyUnit(
  unitId: string,
  sourceTileIds: string[],
  tier: UnitTier,
  tile: TileInstance,
  row: number,
  col: number,
  evaluation: YakuEvaluation,
  yakumanIds: ReadonlySet<string>,
): CombatUnit {
  const base = TIER_BASE_STATS[tier];
  const mod = evaluation.statModifiers;
  const hasYakuman = yakumanIds.size > 0;
  const isKan = tier === 'ANKAN' || tier === 'MINKAN' || tier === 'KAKAN';

  let maxHp: number;
  let atk: number;
  let aspd: number;
  let critChance: number;
  let shield = 0;
  let invulnTimer = 0;
  let isGiant = isKan;

  if (!hasYakuman) {
    const selfBonus = mod.yakuhaiSelfBonus[tile.code] ?? 0;
    const hpAdd = 1 + mod.hpAdd + selfBonus;
    const atkAdd = 1 + mod.atkAdd + selfBonus;
    const aspdAdd = 1 + mod.aspdAdd + selfBonus;
    const menzenMult = mod.menzenBonus ? 1.08 : 1.0;

    maxHp = Math.round(base.hp * hpAdd * menzenMult * mod.doraMult);
    atk = base.atk * atkAdd;
    aspd = Math.min(base.aspd * MAX_BASE_ASPD_MULTIPLIER, base.aspd * aspdAdd);
    critChance = Math.min(1.0, base.critChance + mod.critAdd);
  } else {
    // Yakuman keeps ONLY shop permanent buffs + Dora + stackable Yakuman multipliers
    const hpAdd = 1 + mod.hpAdd;
    const atkAdd = 1 + mod.atkAdd;
    const aspdAdd = 1 + mod.aspdAdd;

    maxHp = Math.round(base.hp * hpAdd * mod.doraMult);
    atk = base.atk * atkAdd;
    aspd = base.aspd * aspdAdd;
    critChance = base.critChance;

    let uncapAspd = mod.uncapAspd;

    if (yakumanIds.has('KOKUSHI_MUSOU')) {
      maxHp = Math.round(maxHp * 2.5);
      atk *= 2.5;
      aspd *= 2.5;
      uncapAspd = true;
    }
    if (yakumanIds.has('CHINROUTOU')) {
      maxHp *= 3;
    }
    if (yakumanIds.has('SUUKANTSU') && isKan) {
      maxHp *= 3;
      atk *= 3;
      aspd *= 3;
      uncapAspd = true;
    }
    if (yakumanIds.has('DAISUUSHII')) {
      aspd *= 3.5;
      uncapAspd = true;
    } else if (yakumanIds.has('SHOUSUUSHII')) {
      aspd *= 2.5;
      uncapAspd = true;
    }
    if (!uncapAspd) {
      aspd = Math.min(base.aspd * MAX_BASE_ASPD_MULTIPLIER, aspd);
    }
    if (yakumanIds.has('SUUANKOU')) {
      isGiant = true;
      shield = maxHp * 2;
    }
    if (yakumanIds.has('CHUUREN_POUTOU')) {
      invulnTimer = 5.0;
    }
  }

  return {
    unitId,
    side: 'PLAYER',
    sourceTileIds,
    tier,
    suit: tile.suit,
    tileCode: tile.code,
    row,
    col,
    prevRow: row,
    prevCol: col,
    hp: maxHp,
    maxHp,
    atk,
    baseAtk: atk,
    aspd,
    baseAspd: aspd,
    range: base.range,
    moveCooldown: base.moveCooldown,
    critChance,
    shield,
    maxShield: shield,
    cooldowns: {
      attack: 0.25,
      move: 0.15,
      bossSlam: 0,
      quakeStunIcd: 0,
    },
    alive: true,
    freezeTimer: 0,
    stunTimer: 0,
    invulnTimer,
    enrageStacks: 0,
    isGiant,
    totalDamageDealt: 0,
  };
}

export function createCombatSimulation(
  state: GameState,
  evaluation: YakuEvaluation,
): CombatSimulation {
  const yakumanIds = new Set(evaluation.yakuman.map((y) => y.id));
  const units: CombatUnit[] = [];
  const tileById = new Map<string, TileInstance>();
  for (let i = 0; i < state.tiles.length; i++) {
    tileById.set(state.tiles[i].id, state.tiles[i]);
  }
  const lockGroupById = new Map<string, LockedGroup>();
  for (let i = 0; i < state.lockedGroups.length; i++) {
    lockGroupById.set(state.lockedGroups[i].groupId, state.lockedGroups[i]);
  }

  const occupiedAlly = new Uint8Array(GRID_ROWS * ALLY_COLS);
  let unitSeq = 1;

  // Spawn ally units from evaluated groups
  for (let i = 0; i < evaluation.groups.length; i++) {
    const g = evaluation.groups[i];
    if (g.kind === 'ANKAN' || g.kind === 'MINKAN' || g.kind === 'KAKAN') {
      const lg = g.lockGroupId ? lockGroupById.get(g.lockGroupId) : null;
      const firstTile = tileById.get(g.tileIds[0]);
      if (!firstTile) continue;
      const pos = lg ? lg.anchorGridPos : firstTile.gridPos!;
      occupiedAlly[pos.row * ALLY_COLS + pos.col] = 1;
      units.push(
        createAllyUnit(
          `ally_${unitSeq++}`,
          [...g.tileIds],
          g.kind,
          firstTile,
          pos.row,
          pos.col,
          evaluation,
          yakumanIds,
        ),
      );
      continue;
    }

    const tier: UnitTier = g.kind;
    for (let j = 0; j < g.tileIds.length; j++) {
      const tile = tileById.get(g.tileIds[j]);
      if (!tile || tile.location !== 'GRID' || !tile.gridPos) continue;
      occupiedAlly[tile.gridPos.row * ALLY_COLS + tile.gridPos.col] = 1;
      units.push(
        createAllyUnit(
          `ally_${unitSeq++}`,
          [tile.id],
          tier,
          tile,
          tile.gridPos.row,
          tile.gridPos.col,
          evaluation,
          yakumanIds,
        ),
      );
    }
  }

  // Chiitoitsu / Kokushi Musou: Head tiles deploy onto nearest 2x1 cells on the 6x6 ally grid
  if (evaluation.deployHeadTiles) {
    const headTiles = state.tiles.filter((t) => t.location === 'HEAD');
    if (headTiles.length === 2) {
      const [p0, p1] = findHeadDeployPositions(occupiedAlly);
      const tier: UnitTier = yakumanIds.has('KOKUSHI_MUSOU') ? 'ISOLATED' : 'TOITSU';
      units.push(
        createAllyUnit(`ally_${unitSeq++}`, [headTiles[0].id], tier, headTiles[0], p0.row, p0.col, evaluation, yakumanIds),
      );
      units.push(
        createAllyUnit(`ally_${unitSeq++}`, [headTiles[1].id], tier, headTiles[1], p1.row, p1.col, evaluation, yakumanIds),
      );
    }
  }

  // Spawn enemy wave
  const waveArchetype = state.currentWaveArchetype;
  const hpScale = getEnemyHpScale(state.round);
  const atkScale = getEnemyAtkScale(state.round);
  const enemySlowFactor = yakumanIds.has('DAISUUSHII')
    ? 0.4
    : yakumanIds.has('SHOUSUUSHII')
      ? 0.6
      : 1.0;

  const spawns = WAVE_COMPOSITIONS[waveArchetype];
  for (let i = 0; i < spawns.length; i++) {
    const sp = spawns[i];
    const spec = ENEMY_SPECS[sp.archetype];
    const maxHp = Math.round(spec.hp * hpScale);
    const atk = spec.atk * atkScale;
    const aspd = spec.aspd * enemySlowFactor;
    const moveCd = spec.moveCooldown / enemySlowFactor;

    units.push({
      unitId: `enemy_${i + 1}`,
      side: 'ENEMY',
      sourceTileIds: [],
      tier: 'ISOLATED',
      suit: null,
      tileCode: null,
      archetype: sp.archetype,
      row: sp.pos.row,
      col: sp.pos.col,
      prevRow: sp.pos.row,
      prevCol: sp.pos.col,
      hp: maxHp,
      maxHp,
      atk,
      baseAtk: atk,
      aspd,
      baseAspd: aspd,
      range: spec.range,
      moveCooldown: moveCd,
      critChance: 0,
      shield: 0,
      maxShield: 0,
      cooldowns: {
        attack: 0.35,
        move: 0.25,
        bossSlam: sp.archetype === 'BOSS' ? BOSS_SLAM_INTERVAL_SEC : 0,
        quakeStunIcd: 0,
      },
      alive: true,
      freezeTimer: 0,
      stunTimer: 0,
      invulnTimer: 0,
      enrageStacks: 0,
      isGiant: sp.archetype === 'BOSS',
      totalDamageDealt: 0,
    });
  }

  const combatRng = new SeededRng(state.rngState ^ Math.imul(state.round, 0x517cc1b7));

  return {
    round: state.round,
    waveArchetype,
    evaluation,
    units,
    rng: combatRng,
    elapsedSec: 0,
    tickCount: 0,
    finished: false,
    won: false,
    timedOut: false,
    events: [],
    telegraphs: [],
    combatLog: [`라운드 ${state.round} 전투 개시! (${waveArchetype} 웨이브)`],
    nextEventId: 1,
    chuurenTimer: 1.5,
    daisangenTimer: 0, // fires immediately at t=0
    tsuuiisouTimer: 1.0,
    ryuuiisouTimer: 1.0,
    kokushiFired: false,
    bossEnrageTimer: BOSS_ENRAGE_START_SEC,
    hasChuuren: yakumanIds.has('CHUUREN_POUTOU'),
    hasDaisangen: yakumanIds.has('DAISANGEN'),
    hasSuuankou: yakumanIds.has('SUUANKOU'),
    hasKokushi: yakumanIds.has('KOKUSHI_MUSOU'),
    hasTsuuiisou: yakumanIds.has('TSUUIISOU'),
    hasRyuuiisou: yakumanIds.has('RYUUIISOU'),
    hasChinroutou: yakumanIds.has('CHINROUTOU'),
    hasShousuushii: yakumanIds.has('SHOUSUUSHII'),
    hasDaisuushii: yakumanIds.has('DAISUUSHII'),
    hasSuukantsu: yakumanIds.has('SUUKANTSU'),
  };
}

function computeAllyHitDamage(
  sim: CombatSimulation,
  attacker: CombatUnit,
  rawMultiplier = 1.0,
): { damage: number; isCrit: boolean } {
  const mod = sim.evaluation.statModifiers;
  const isCrit = sim.rng.nextFloat() < attacker.critChance;
  const critMult = isCrit ? CRIT_MULTIPLIER : 1.0;
  const menzenMult = mod.menzenBonus ? 1.08 : 1.0;
  const dmg = Math.max(
    1,
    Math.round(attacker.atk * rawMultiplier * critMult * mod.ampMult * menzenMult * mod.doraMult),
  );
  return { damage: dmg, isCrit };
}

function applyDamage(
  sim: CombatSimulation,
  attacker: CombatUnit | null,
  defender: CombatUnit,
  rawDamage: number,
  isCrit: boolean,
  allowReflect = true,
): number {
  if (!defender.alive || rawDamage <= 0) return 0;
  if (defender.invulnTimer > 0) return 0;

  let dmg = rawDamage;
  // Tsuuiisou: allies take 60% less damage
  if (defender.side === 'PLAYER' && sim.hasTsuuiisou) {
    dmg = Math.max(1, Math.round(dmg * 0.4));
  }

  let remaining = dmg;
  if (defender.shield > 0) {
    const absorbed = Math.min(defender.shield, remaining);
    defender.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    defender.hp = Math.max(0, defender.hp - remaining);
  }
  if (attacker) {
    attacker.totalDamageDealt += dmg;
  }

  // Ryuuiisou: allies lifesteal 40% of all damage dealt
  if (attacker && attacker.side === 'PLAYER' && sim.hasRyuuiisou && attacker.alive) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.4));
  }

  pushEvent(sim, {
    kind: 'DAMAGE_TEXT',
    toRow: defender.row,
    toCol: defender.col,
    value: dmg,
    isCrit,
    color: defender.side === 'ENEMY' ? (isCrit ? '#facc15' : '#ffffff') : '#f87171',
    ttl: 0.45,
    maxTtl: 0.45,
  });

  if (defender.hp <= 0) {
    defender.alive = false;
  }

  // Chinroutou: reflect 150% of damage taken back to attacker
  if (
    allowReflect &&
    defender.side === 'PLAYER' &&
    sim.hasChinroutou &&
    attacker &&
    attacker.alive
  ) {
    const reflectDmg = Math.round(dmg * 1.5);
    applyDamage(sim, defender, attacker, reflectDmg, false, false);
  }

  return dmg;
}

function findTarget(sim: CombatSimulation, unit: CombatUnit): CombatUnit | null {
  let best: CombatUnit | null = null;
  let bestPrimary = Infinity;
  let bestSecondary = Infinity;
  let bestTertiary = Infinity;

  const wantSide = unit.side === 'PLAYER' ? 'ENEMY' : 'PLAYER';
  const isSniper = unit.side === 'ENEMY' && unit.archetype === 'SNIPER';

  for (let i = 0; i < sim.units.length; i++) {
    const cand = sim.units[i];
    if (!cand.alive || cand.side !== wantSide) continue;

    if (isSniper) {
      // Sniper prioritizes backline ally (lowest col), then lowest HP, then nearest
      const p1 = cand.col;
      const p2 = cand.hp;
      const p3 = chebyshevDist(unit.row, unit.col, cand.row, cand.col);
      if (
        p1 < bestPrimary ||
        (p1 === bestPrimary && p2 < bestSecondary) ||
        (p1 === bestPrimary && p2 === bestSecondary && p3 < bestTertiary)
      ) {
        best = cand;
        bestPrimary = p1;
        bestSecondary = p2;
        bestTertiary = p3;
      }
    } else {
      // Standard: closest Chebyshev distance, same row preferred, lowest HP
      const p1 = chebyshevDist(unit.row, unit.col, cand.row, cand.col);
      const p2 = cand.row === unit.row ? 0 : 1;
      const p3 = cand.hp;
      if (
        p1 < bestPrimary ||
        (p1 === bestPrimary && p2 < bestSecondary) ||
        (p1 === bestPrimary && p2 === bestSecondary && p3 < bestTertiary)
      ) {
        best = cand;
        bestPrimary = p1;
        bestSecondary = p2;
        bestTertiary = p3;
      }
    }
  }
  return best;
}

const STEP_DIRS: readonly [number, number][] = [
  // Cardinal first (per plan.md), then diagonals
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function tryMoveToward(
  unit: CombatUnit,
  target: CombatUnit,
  occupied: Uint8Array,
): void {
  const curDist = chebyshevDist(unit.row, unit.col, target.row, target.col);
  let bestR = -1;
  let bestC = -1;
  let bestDist = curDist;
  let bestManh = Math.abs(unit.row - target.row) + Math.abs(unit.col - target.col);
  let bestIsDiag = 1;

  for (let i = 0; i < STEP_DIRS.length; i++) {
    const [dr, dc] = STEP_DIRS[i];
    const nr = unit.row + dr;
    const nc = unit.col + dc;
    if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= TOTAL_GRID_COLS) continue;
    if (occupied[nr * TOTAL_GRID_COLS + nc] === 1) continue;

    const d = chebyshevDist(nr, nc, target.row, target.col);
    const manh = Math.abs(nr - target.row) + Math.abs(nc - target.col);
    const isDiag = dr !== 0 && dc !== 0 ? 1 : 0;

    if (
      d < bestDist ||
      (d === bestDist && manh < bestManh) ||
      (d === bestDist && manh === bestManh && isDiag < bestIsDiag)
    ) {
      bestDist = d;
      bestManh = manh;
      bestIsDiag = isDiag;
      bestR = nr;
      bestC = nc;
    }
  }

  if (bestR !== -1) {
    occupied[unit.row * TOTAL_GRID_COLS + unit.col] = 0;
    occupied[bestR * TOTAL_GRID_COLS + bestC] = 1;
    unit.row = bestR;
    unit.col = bestC;
    unit.cooldowns.move = unit.moveCooldown;
  }
}

function processYakumanEffects(sim: CombatSimulation): void {
  const allies = sim.units.filter((u) => u.alive && u.side === 'PLAYER');
  const enemies = sim.units.filter((u) => u.alive && u.side === 'ENEMY');
  if (allies.length === 0 || enemies.length === 0) return;

  // Kokushi Musou: instant opening salvo (ATK x 3.0)
  if (sim.hasKokushi && !sim.kokushiFired) {
    sim.kokushiFired = true;
    const doraMult = sim.evaluation.statModifiers.doraMult;
    for (let i = 0; i < allies.length; i++) {
      const liveEnemies = sim.units.filter((u) => u.alive && u.side === 'ENEMY');
      if (liveEnemies.length === 0) break;
      const target = liveEnemies[sim.rng.nextInt(liveEnemies.length)];
      const dmg = Math.round(allies[i].atk * 3.0 * doraMult);
      applyDamage(sim, allies[i], target, dmg, true);
      pushEvent(sim, {
        kind: 'PROJECTILE',
        fromRow: allies[i].row,
        fromCol: allies[i].col,
        toRow: target.row,
        toCol: target.col,
        color: '#f59e0b',
        ttl: 0.25,
        maxTtl: 0.25,
      });
    }
    sim.combatLog.push('국사무쌍 일제 사격 발동!');
  }

  // Chuuren Poutou: every 1.5s golden beam across all 6 rows
  if (sim.hasChuuren) {
    sim.chuurenTimer -= COMBAT_DT;
    if (sim.chuurenTimer <= 0) {
      sim.chuurenTimer += 1.5;
      let totalAtk = 0;
      for (let i = 0; i < allies.length; i++) totalAtk += allies[i].atk;
      const avgAtk = totalAtk / allies.length;
      for (let r = 0; r < GRID_ROWS; r++) {
        pushEvent(sim, {
          kind: 'PIERCE_BEAM',
          fromRow: r,
          fromCol: 0,
          toRow: r,
          toCol: TOTAL_GRID_COLS - 1,
          color: '#fbbf24',
          ttl: 0.35,
          maxTtl: 0.35,
        });
      }
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const dmg = Math.round(avgAtk * 2.5 + e.maxHp * 0.08);
        applyDamage(sim, allies[0], e, dmg, false);
      }
    }
  }

  // Daisangen: at t=0 and every 5s: Freeze 1.8s -> Full Heal -> Fire AoE (totalAllyAtk * 1.2)
  if (sim.hasDaisangen) {
    sim.daisangenTimer -= COMBAT_DT;
    if (sim.daisangenTimer <= 0) {
      sim.daisangenTimer += 5.0;
      let totalAtk = 0;
      for (let i = 0; i < allies.length; i++) {
        allies[i].hp = allies[i].maxHp;
        totalAtk += allies[i].atk;
      }
      const fireDmg = Math.round(totalAtk * 1.2);
      for (let i = 0; i < enemies.length; i++) {
        enemies[i].freezeTimer = Math.max(enemies[i].freezeTimer, 1.8);
        applyDamage(sim, allies[0], enemies[i], fireDmg, false);
      }
      pushEvent(sim, {
        kind: 'YAKUMAN_FX',
        toRow: 2,
        toCol: 8,
        label: '대삼원 연쇄!',
        color: '#ef4444',
        ttl: 0.7,
        maxTtl: 0.7,
      });
    }
  }

  // Tsuuiisou: every 1s chain lightning on up to 3 random enemies (totalAllyAtk * 0.8)
  if (sim.hasTsuuiisou) {
    sim.tsuuiisouTimer -= COMBAT_DT;
    if (sim.tsuuiisouTimer <= 0) {
      sim.tsuuiisouTimer += 1.0;
      let totalAtk = 0;
      for (let i = 0; i < allies.length; i++) totalAtk += allies[i].atk;
      const dmg = Math.round(totalAtk * 0.8);
      const pool = [...enemies];
      sim.rng.shuffleInPlace(pool);
      const count = Math.min(3, pool.length);
      for (let i = 0; i < count; i++) {
        applyDamage(sim, allies[0], pool[i], dmg, false);
        pushEvent(sim, {
          kind: 'YAKUMAN_FX',
          toRow: pool[i].row,
          toCol: pool[i].col,
          color: '#a855f7',
          ttl: 0.3,
          maxTtl: 0.3,
        });
      }
    }
  }

  // Ryuuiisou: every 1s poison mist deals 6% maxHP to all enemies
  if (sim.hasRyuuiisou) {
    sim.ryuuiisouTimer -= COMBAT_DT;
    if (sim.ryuuiisouTimer <= 0) {
      sim.ryuuiisouTimer += 1.0;
      for (let i = 0; i < enemies.length; i++) {
        const dmg = Math.max(1, Math.round(enemies[i].maxHp * 0.06));
        applyDamage(sim, allies[0], enemies[i], dmg, false);
      }
    }
  }
}

/**
 * Advances the combat simulation by exactly 1 deterministic tick (1/30s).
 */
export function stepCombatTick(sim: CombatSimulation): void {
  if (sim.finished) return;

  sim.tickCount++;
  sim.elapsedSec += COMBAT_DT;

  // Decay visual events
  for (let i = sim.events.length - 1; i >= 0; i--) {
    sim.events[i].ttl -= COMBAT_DT;
    if (sim.events[i].ttl <= 0) {
      sim.events.splice(i, 1);
    }
  }

  // Save previous grid positions for smooth Canvas lerp
  const occupied = new Uint8Array(GRID_ROWS * TOTAL_GRID_COLS);
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    if (!u.alive) continue;
    u.prevRow = u.row;
    u.prevCol = u.col;
    occupied[u.row * TOTAL_GRID_COLS + u.col] = 1;
  }

  // Timeout check (60s -> defeat)
  if (sim.elapsedSec >= COMBAT_TIMEOUT_SEC) {
    sim.finished = true;
    sim.won = false;
    sim.timedOut = true;
    sim.combatLog.push('전투 제한 시간(60초) 초과 — 패배!');
    return;
  }

  // Periodic Yakuman effects
  processYakumanEffects(sim);

  // Boss enrage check (20s start, every 5s: ATK +25%, ASPD +15%)
  if (sim.elapsedSec >= sim.bossEnrageTimer) {
    let triggered = false;
    for (let i = 0; i < sim.units.length; i++) {
      const u = sim.units[i];
      if (u.alive && u.side === 'ENEMY' && u.archetype === 'BOSS') {
        u.enrageStacks++;
        u.atk = u.baseAtk * (1 + BOSS_ENRAGE_ATK_BONUS * u.enrageStacks);
        u.aspd = u.baseAspd * (1 + BOSS_ENRAGE_ASPD_BONUS * u.enrageStacks);
        triggered = true;
      }
    }
    if (triggered) {
      sim.combatLog.push(`보스 광폭화 중첩! (공격력/공속 증가)`);
    }
    sim.bossEnrageTimer += BOSS_ENRAGE_TICK_SEC;
  }

  // Process active boss slam telegraphs
  for (let i = sim.telegraphs.length - 1; i >= 0; i--) {
    const tel = sim.telegraphs[i];
    tel.remainingSec -= COMBAT_DT;
    if (tel.remainingSec <= 0) {
      sim.telegraphs.splice(i, 1);
      const boss = sim.units.find((u) => u.unitId === tel.bossId && u.alive);
      if (boss) {
        const slamDmg = Math.round(boss.atk * BOSS_SLAM_ATK_MULT);
        pushEvent(sim, {
          kind: 'BOSS_SLAM',
          fromRow: tel.row,
          fromCol: 0,
          toRow: tel.row,
          toCol: ALLY_COLS - 1,
          color: '#ef4444',
          ttl: 0.35,
          maxTtl: 0.35,
        });
        for (let j = 0; j < sim.units.length; j++) {
          const ally = sim.units[j];
          if (ally.alive && ally.side === 'PLAYER' && ally.row === tel.row) {
            applyDamage(sim, boss, ally, slamDmg, false);
          }
        }
      }
    }
  }

  // Unit actions
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    if (!u.alive) continue;

    if (u.invulnTimer > 0) u.invulnTimer = Math.max(0, u.invulnTimer - COMBAT_DT);
    if (u.cooldowns.quakeStunIcd > 0) {
      u.cooldowns.quakeStunIcd = Math.max(0, u.cooldowns.quakeStunIcd - COMBAT_DT);
    }
    if (u.freezeTimer > 0) {
      u.freezeTimer = Math.max(0, u.freezeTimer - COMBAT_DT);
      continue;
    }
    if (u.stunTimer > 0) {
      u.stunTimer = Math.max(0, u.stunTimer - COMBAT_DT);
      continue;
    }

    if (u.cooldowns.attack > 0) u.cooldowns.attack -= COMBAT_DT;
    if (u.cooldowns.move > 0) u.cooldowns.move -= COMBAT_DT;

    const target = findTarget(sim, u);
    if (!target) continue;

    // Boss row slam cooldown
    if (u.side === 'ENEMY' && u.archetype === 'BOSS') {
      u.cooldowns.bossSlam -= COMBAT_DT;
      if (u.cooldowns.bossSlam <= 0) {
        u.cooldowns.bossSlam = BOSS_SLAM_INTERVAL_SEC;
        sim.telegraphs.push({
          bossId: u.unitId,
          row: target.row,
          remainingSec: BOSS_SLAM_TELEGRAPH_SEC,
          totalSec: BOSS_SLAM_TELEGRAPH_SEC,
        });
      }
    }

    const dist = chebyshevDist(u.row, u.col, target.row, target.col);
    if (dist > u.range) {
      if (u.cooldowns.move <= 0) {
        tryMoveToward(u, target, occupied);
      }
      continue;
    }

    // Attack!
    if (u.cooldowns.attack <= 0) {
      u.cooldowns.attack = 1 / Math.max(0.1, u.aspd);

      if (u.side === 'PLAYER') {
        const { damage, isCrit } = computeAllyHitDamage(sim, u);
        applyDamage(sim, u, target, damage, isCrit);

        pushEvent(sim, {
          kind: 'PROJECTILE',
          fromRow: u.row,
          fromCol: u.col,
          toRow: target.row,
          toCol: target.col,
          color: isCrit ? '#facc15' : '#38bdf8',
          ttl: 0.18,
          maxTtl: 0.18,
        });

        // SHUNTSU: straight-line pierce along target's row (60% damage)
        if (u.tier === 'SHUNTSU') {
          const pierceDmg = Math.max(1, Math.round(damage * SHUNTSU_PIERCE_RATIO));
          let hitBehind = false;
          for (let j = 0; j < sim.units.length; j++) {
            const other = sim.units[j];
            if (
              other.alive &&
              other.side === 'ENEMY' &&
              other.unitId !== target.unitId &&
              other.row === target.row &&
              other.col > target.col
            ) {
              applyDamage(sim, u, other, pierceDmg, false);
              hitBehind = true;
            }
          }
          if (hitBehind) {
            pushEvent(sim, {
              kind: 'PIERCE_BEAM',
              fromRow: target.row,
              fromCol: target.col,
              toRow: target.row,
              toCol: TOTAL_GRID_COLS - 1,
              color: '#34d399',
              ttl: 0.22,
              maxTtl: 0.22,
            });
          }
        }

        // KAN: 3x3 splash (50% damage)
        const isKan = u.tier === 'ANKAN' || u.tier === 'MINKAN' || u.tier === 'KAKAN';
        if (isKan) {
          const splashDmg = Math.max(1, Math.round(damage * KAN_SPLASH_RATIO));
          for (let j = 0; j < sim.units.length; j++) {
            const other = sim.units[j];
            if (
              other.alive &&
              other.side === 'ENEMY' &&
              other.unitId !== target.unitId &&
              chebyshevDist(target.row, target.col, other.row, other.col) <= 1
            ) {
              applyDamage(sim, u, other, splashDmg, false);
            }
          }
          pushEvent(sim, {
            kind: 'SPLASH_RING',
            toRow: target.row,
            toCol: target.col,
            color: '#fb923c',
            ttl: 0.25,
            maxTtl: 0.25,
          });
        }

        // SUUANKOU: all ally basic attacks emit 3x3 shockwave (75% damage)
        if (sim.hasSuuankou) {
          const shockDmg = Math.max(1, Math.round(damage * 0.75));
          for (let j = 0; j < sim.units.length; j++) {
            const other = sim.units[j];
            if (
              other.alive &&
              other.side === 'ENEMY' &&
              other.unitId !== target.unitId &&
              chebyshevDist(target.row, target.col, other.row, other.col) <= 1
            ) {
              applyDamage(sim, u, other, shockDmg, false);
            }
          }
          pushEvent(sim, {
            kind: 'SPLASH_RING',
            toRow: target.row,
            toCol: target.col,
            color: '#f59e0b',
            ttl: 0.25,
            maxTtl: 0.25,
          });
        }

        // SUUKANTSU: Kan attacks cause board-wide earthquake (ATK * 0.6) + 0.5s stun (2s ICD)
        if (sim.hasSuukantsu && isKan) {
          const quakeDmg = Math.max(1, Math.round(u.atk * 0.6));
          const applyStun = u.cooldowns.quakeStunIcd <= 0;
          if (applyStun) u.cooldowns.quakeStunIcd = 2.0;
          for (let j = 0; j < sim.units.length; j++) {
            const other = sim.units[j];
            if (other.alive && other.side === 'ENEMY') {
              applyDamage(sim, u, other, quakeDmg, false);
              if (applyStun && other.alive) {
                other.stunTimer = Math.max(other.stunTimer, 0.5);
              }
            }
          }
        }
      } else {
        // Enemy attack
        const dmg = Math.max(1, Math.round(u.atk));
        applyDamage(sim, u, target, dmg, false);
        pushEvent(sim, {
          kind: 'PROJECTILE',
          fromRow: u.row,
          fromCol: u.col,
          toRow: target.row,
          toCol: target.col,
          color: u.archetype === 'SNIPER' ? '#c084fc' : '#f87171',
          ttl: 0.2,
          maxTtl: 0.2,
        });
      }
    }
  }

  // Check victory / defeat
  let aliveAllies = 0;
  let aliveEnemies = 0;
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    if (!u.alive) continue;
    if (u.side === 'PLAYER') aliveAllies++;
    else aliveEnemies++;
  }

  if (aliveEnemies === 0) {
    sim.finished = true;
    sim.won = true;
    sim.combatLog.push(`승리! (${sim.elapsedSec.toFixed(1)}초)`);
  } else if (aliveAllies === 0) {
    sim.finished = true;
    sim.won = false;
    sim.combatLog.push(`아군 전멸 — 패배! (${sim.elapsedSec.toFixed(1)}초)`);
  }
}

export function buildCombatSummary(sim: CombatSimulation) {
  let totalAllyDamage = 0;
  let survivingAllies = 0;
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    if (u.side === 'PLAYER') {
      totalAllyDamage += u.totalDamageDealt;
      if (u.alive) survivingAllies++;
    }
  }
  return {
    won: sim.won,
    timedOut: sim.timedOut,
    round: sim.round,
    enemyWave: sim.waveArchetype,
    totalHan: sim.evaluation.totalHan,
    yakumanCount: sim.evaluation.yakuman.length,
    durationSec: Number(sim.elapsedSec.toFixed(2)),
    totalAllyDamage,
    survivingAllies,
  };
}

/** Runs simulation synchronously to completion (great for Vitest deterministic verification) */
export function runCombatToCompletion(sim: CombatSimulation): CombatSimulation {
  const maxTicks = COMBAT_TIMEOUT_SEC * 30 + 10;
  while (!sim.finished && sim.tickCount < maxTicks) {
    stepCombatTick(sim);
  }
  return sim;
}

// Re-export isKanGroup helper check unused warning avoidance
export { isKanGroup };
