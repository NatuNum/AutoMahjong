import { describe, expect, it } from 'vitest';
import { getBenchExpandPrice, getRerollCost } from '../config/shop';
import { COMBAT_TIMEOUT_SEC } from '../config/stats';
import { createCombatSimulation, runCombatToCompletion, stepCombatTick } from '../core/combatEngine';
import { detectFuroCandidates, detectSelfKanCandidates } from '../core/furoDetector';
import {
  allocateLineForFuro,
  countLogicalGridTiles,
  moveLockedGroup,
  moveTileToBench,
  rotateLockedGroup,
} from '../core/gridOps';
import { evaluateHand } from '../core/handEvaluator';
import { SeededRng } from '../core/prng';
import {
  beginYakuTrigger,
  buyShopOffer,
  createInitialRun,
  discardOwnedTile,
  discardTsumo,
  enterCombatPhase,
  executeFuro,
  executeSelfKan,
  finishCombatAndApplyResult,
  getMagicalDrawAvailability,
  passOrFinishFuro,
  placeTsumoToBench,
  proceedAfterRoundResult,
  rerollShop,
  resolveGridReplace,
  useDismantleTicket,
  useMagicalDraw,
  useRankShiftTicket,
} from '../core/runController';
import type { LockedGroup, TileInstance } from '../core/types';
import { buildRoundWall, countTileCodes, createTileInstance, dealInitial14Tiles } from '../core/wall';

const ZERO_BUFFS = { atkAdd: 0, hpAdd: 0, aspdAdd: 0 };

function makeGridTile(id: string, code: number, row: number, col: number, lockGroupId: string | null = null): TileInstance {
  return createTileInstance(id, code, 'GRID', { row, col }, null, null, lockGroupId);
}

function makeHeadPair(code: number): TileInstance[] {
  return [
    createTileInstance('h0', code, 'HEAD', null, null, 0),
    createTileInstance('h1', code, 'HEAD', null, null, 1),
  ];
}

describe('Wall & Initial 14-Tile Deal', () => {
  it('guarantees at least 1 pair in Head and 12 tiles on 6x6 Grid', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new SeededRng(seed);
      let seq = 1;
      const tiles = dealInitial14Tiles(rng, () => `t_${seq++}`);
      expect(tiles.length).toBe(14);
      const head = tiles.filter((t) => t.location === 'HEAD');
      const grid = tiles.filter((t) => t.location === 'GRID');
      expect(head.length).toBe(2);
      expect(head[0].code).toBe(head[1].code);
      expect(grid.length).toBe(12);
    }
  });

  it('world wall excludes 4-copy owned tiles completely', () => {
    const owned = [
      makeGridTile('a1', 4, 0, 0),
      makeGridTile('a2', 4, 0, 1),
      makeGridTile('a3', 4, 0, 2),
      makeGridTile('a4', 4, 0, 3),
    ];
    const wall = buildRoundWall(owned, new SeededRng(42));
    expect(wall.length).toBe(132);
    expect(wall.filter((c) => c === 4).length).toBe(0);
  });
});

describe('6x6 Grid Ops, Straight-Line Mentsu & Hand Evaluator', () => {
  it('recognizes horizontal/vertical straight-line mentsu only and rejects L-shape', () => {
    // L-shape 1m(0,0), 2m(0,1), 3m(1,1) -> should NOT form Shuntsu!
    const lTiles = [
      makeGridTile('t1', 0, 0, 0),
      makeGridTile('t2', 1, 0, 1),
      makeGridTile('t3', 2, 1, 1),
      ...makeHeadPair(31),
    ];
    const evalL = evaluateHand(lTiles, [], [], 27, 27, ZERO_BUFFS);
    expect(evalL.groups.some((g) => g.kind === 'SHUNTSU')).toBe(false);

    // Straight line 1m(0,0), 2m(0,1), 3m(0,2) -> forms Shuntsu!
    const lineTiles = [
      makeGridTile('t1', 0, 0, 0),
      makeGridTile('t2', 1, 0, 1),
      makeGridTile('t3', 2, 0, 2),
      ...makeHeadPair(31),
    ];
    const evalLine = evaluateHand(lineTiles, [], [], 27, 27, ZERO_BUFFS);
    expect(evalLine.groups.filter((g) => g.kind === 'SHUNTSU').length).toBe(1);
    // Yakuhai head (백=31) -> +10% head aura
    expect(evalLine.statModifiers.headAuraBonus).toBeCloseTo(0.1);
  });

  it('evaluates Pinfu (Menzen all Shuntsu), Chinitsu suppressing Honitsu, Dora as exact tile, and 4 Kans = 14 logical slots', () => {
    // 4 straight-line Manzu Shuntsu + 5m Head -> Chinitsu(6) + Pinfu(1) + Menzen(1) + Iipeikou(1) + Dora(5m x 2 = 2)
    const tiles = [
      makeGridTile('t1', 0, 0, 0), makeGridTile('t2', 1, 0, 1), makeGridTile('t3', 2, 0, 2), // 123m
      makeGridTile('t4', 0, 1, 0), makeGridTile('t5', 1, 1, 1), makeGridTile('t6', 2, 1, 2), // 123m (Iipeikou)
      makeGridTile('t7', 3, 2, 0), makeGridTile('t8', 4, 2, 1), makeGridTile('t9', 5, 2, 2), // 456m
      makeGridTile('t10', 6, 3, 0), makeGridTile('t11', 7, 3, 1), makeGridTile('t12', 8, 3, 2), // 789m (Ittsu!)
      ...makeHeadPair(4), // 5m x2 (also 456m has one 5m -> 3 dora total!)
    ];
    const ev = evaluateHand(tiles, [], [4], 27, 27, ZERO_BUFFS);
    const ids = ev.normalYaku.map((y) => y.id);
    expect(ids).toContain('PINFU');
    expect(ids).toContain('CHINITSU');
    expect(ids).not.toContain('HONITSU'); // superior suppresses inferior
    expect(ids).toContain('ITTSU');
    expect(ids).toContain('IIPEIKOU');
    expect(ids).toContain('MENZEN_COMPLETE');
    expect(ev.doraCount).toBe(3);
    expect(ev.statModifiers.headAuraBonus).toBeCloseTo(0.05);

    // 4 Ankan (16 physical tiles) + 2 Head = 12 logical grid + 2 head = 14 logical slots & Suukantsu + Suuankou stacked!
    const kanTiles: TileInstance[] = [...makeHeadPair(27)];
    const kanGroups: LockedGroup[] = [];
    const kanCodes = [0, 8, 12, 31];
    kanCodes.forEach((code, idx) => {
      const gid = `kan_${idx}`;
      const idsForKan: string[] = [];
      for (let k = 0; k < 4; k++) {
        const id = `k_${idx}_${k}`;
        idsForKan.push(id);
        kanTiles.push(makeGridTile(id, code, idx, 0, gid));
      }
      kanGroups.push({
        groupId: gid,
        type: 'ANKAN',
        tileIds: idsForKan,
        tileCodes: [code, code, code, code],
        isMenzen: true,
        claimedTileId: null,
        anchorGridPos: { row: idx, col: 0 },
        orientation: 'HORIZONTAL',
      });
    });
    expect(countLogicalGridTiles(kanTiles, kanGroups)).toBe(12);
    const kanEval = evaluateHand(kanTiles, kanGroups, [31], 27, 27, ZERO_BUFFS);
    expect(kanEval.isMenzen).toBe(true);
    const yakumanIds = kanEval.yakuman.map((y) => y.id);
    expect(yakumanIds).toContain('SUUKANTSU');
    expect(yakumanIds).toContain('SUUANKOU'); // Yakuman stacking!
    expect(kanEval.normalYaku.length).toBe(0);
    expect(kanEval.doraCount).toBe(4); // Dora maintained during Yakuman
  });

  it('prevents removing the last unit from the combat grid', () => {
    const tiles = [makeGridTile('only_one', 0, 2, 2)];
    expect(moveTileToBench(tiles, [], 'only_one', 0, 6)).toBe(false);
  });

  it('pushes isolated tiles aside when allocating a straight line for Furo and supports locked block move/rotate', () => {
    // Fill row 0..5 col 0..5 partially so row 0 has unlocked isolated tiles
    const tiles = [
      makeGridTile('iso1', 10, 0, 0),
      makeGridTile('iso2', 11, 0, 1),
      makeGridTile('iso3', 12, 0, 2),
    ];
    const line = allocateLineForFuro(tiles, [], new Set(), 6);
    expect(line).not.toBeNull();

    // Test locked group block move & rotate
    const gTiles = [
      makeGridTile('g1', 0, 0, 0, 'lg1'),
      makeGridTile('g2', 1, 0, 1, 'lg1'),
      makeGridTile('g3', 2, 0, 2, 'lg1'),
    ];
    const lg: LockedGroup = {
      groupId: 'lg1',
      type: 'CHI',
      tileIds: ['g1', 'g2', 'g3'],
      tileCodes: [0, 1, 2],
      isMenzen: false,
      claimedTileId: 'g3',
      anchorGridPos: { row: 0, col: 0 },
      orientation: 'HORIZONTAL',
    };
    expect(moveLockedGroup(gTiles, [lg], 'lg1', { row: 2, col: 1 })).toBe(true);
    expect(gTiles[0].gridPos).toEqual({ row: 2, col: 1 });
    expect(gTiles[2].gridPos).toEqual({ row: 2, col: 3 });

    expect(rotateLockedGroup(gTiles, [lg], 'lg1')).toBe(true);
    expect(lg.orientation).toBe('VERTICAL');
    expect(gTiles[2].gridPos).toEqual({ row: 4, col: 1 });
  });
});

describe('Furo, Kan, Shop, Rollback & Run Controller', () => {
  it('detects CHI across all 3 discards, multiple CHI combinations, and includes Head tiles in scan', () => {
    const tiles = [
      makeGridTile('m2', 1, 0, 0), // 2m
      makeGridTile('m4', 3, 0, 1), // 4m
      makeGridTile('m5', 4, 0, 2), // 5m
      ...makeHeadPair(31),         // 백 in Head!
    ];
    const candidates = detectFuroCandidates(tiles, [20, 31, 2]); // 3s, 백(idx 1), 3m(idx 2)
    const chiFor3m = candidates.filter((c) => c.type === 'CHI' && c.discardIndex === 2);
    expect(chiFor3m.length).toBe(2); // [2m,3m,4m] and [3m,4m,5m]
    const ponForHaku = candidates.filter((c) => c.type === 'PON' && c.discardIndex === 1);
    expect(ponForHaku.length).toBe(1);
  });

  it('Ankan keeps Menzen + triggers FURO_CHECK after bonus draw; Minkan/Kakan breaks Menzen + skips FURO_CHECK; POST_SHOP blocks Kan', () => {
    let state = createInitialRun(12345);
    expect(state.phase).toBe('DRAW_LOOP');
    expect(state.drawSubPhase).toBe('TSUMO');
    const initialDoraCount = state.doraIndicators.length;

    // Inject 3 copies of 1m on grid + 1m as currentTsumo to trigger Ankan
    state.tiles[2].code = 0; state.tiles[2].rank = 1; state.tiles[2].suit = 'MAN';
    state.tiles[3].code = 0; state.tiles[3].rank = 1; state.tiles[3].suit = 'MAN';
    state.tiles[4].code = 0; state.tiles[4].rank = 1; state.tiles[4].suit = 'MAN';
    state.currentTsumo!.code = 0; state.currentTsumo!.rank = 1; state.currentTsumo!.suit = 'MAN';

    const kanCands = detectSelfKanCandidates(state.tiles, state.lockedGroups, state.currentTsumo);
    const ankan = kanCands.find((c) => c.type === 'ANKAN' && c.tileCode === 0);
    expect(ankan).toBeDefined();

    const afterAnkan = executeSelfKan(state, ankan!);
    expect(afterAnkan.res.ok).toBe(true);
    state = afterAnkan.state;
    expect(state.lockedGroups[0].isMenzen).toBe(true);
    expect(state.doraIndicators.length).toBe(initialDoraCount + 1); // Permanent Dora +1
    expect(state.skipNextFuroCheck).toBe(false); // Ankan WILL run FURO_CHECK after bonus draw!
    expect(state.currentTsumo).not.toBeNull();

    // Discard bonus draw -> must go to FURO_CHECK or FURO_SKIP_WAIT (not skip straight to TSUMO)
    state = discardTsumo(state).state;
    expect(['FURO_CHECK', 'FURO_SKIP_WAIT']).toContain(state.drawSubPhase);

    // Finish furo step and verify POST_SHOP_PREP forbids Kan
    state = passOrFinishFuro(state).state;
    state.phase = 'POST_SHOP_PREP';
    expect(executeSelfKan(state, ankan!).res.ok).toBe(false);
  });

  it('Dismantle ticket restores Menzen; Rank shift forbids 1->0, 9->10, honor, locked; Magical Draw blocks exhausted tiles', () => {
    let state = createInitialRun(777);
    // Force a PON furo group + give tickets in inventory
    state.phase = 'POST_SHOP_PREP';
    state.points = 100;
    state.tiles[2].lockGroupId = 'lg_pon';
    state.tiles[3].lockGroupId = 'lg_pon';
    state.tiles[4].lockGroupId = 'lg_pon';
    state.lockedGroups = [
      {
        groupId: 'lg_pon',
        type: 'PON',
        tileIds: [state.tiles[2].id, state.tiles[3].id, state.tiles[4].id],
        tileCodes: [state.tiles[2].code, state.tiles[2].code, state.tiles[2].code],
        isMenzen: false,
        claimedTileId: state.tiles[4].id,
        anchorGridPos: { row: 1, col: 1 },
        orientation: 'HORIZONTAL',
      },
    ];
    state.inventory = [
      { instanceId: 'inv_dismantle', itemId: 'DISMANTLE_TICKET' },
      { instanceId: 'inv_shift', itemId: 'RANK_SHIFT_TICKET' },
      { instanceId: 'inv_mag', itemId: 'MAGICAL_DRAW' },
    ];

    // Locked tile cannot be rank-shifted
    expect(useRankShiftTicket(state, 'inv_shift', state.tiles[2].id, 1).res.ok).toBe(false);

    // Honor tile cannot be rank-shifted; 1m -1 and 9m +1 cannot wrap
    state.tiles[5].code = 27; state.tiles[5].suit = 'HONOR'; state.tiles[5].rank = 1;
    expect(useRankShiftTicket(state, 'inv_shift', state.tiles[5].id, 1).res.ok).toBe(false);
    state.tiles[6].code = 0; state.tiles[6].suit = 'MAN'; state.tiles[6].rank = 1;
    expect(useRankShiftTicket(state, 'inv_shift', state.tiles[6].id, -1).res.ok).toBe(false);
    state.tiles[7].code = 8; state.tiles[7].suit = 'MAN'; state.tiles[7].rank = 9;
    expect(useRankShiftTicket(state, 'inv_shift', state.tiles[7].id, 1).res.ok).toBe(false);

    // Dismantle PON -> isMenzen becomes true!
    const disRes = useDismantleTicket(state, 'inv_dismantle', 'lg_pon');
    expect(disRes.res.ok).toBe(true);
    state = disRes.state;
    expect(state.lockedGroups.length).toBe(0);
    expect(evaluateHand(state.tiles, state.lockedGroups, [], 27, 27, ZERO_BUFFS).isMenzen).toBe(true);

    // Magical Draw blocks any tile code with 0 remaining in wall
    state.wall = state.wall.filter((c) => c !== 15);
    expect(getMagicalDrawAvailability(state)[15]).toBe(0);
    expect(useMagicalDraw(state, 'inv_mag', 15).res.ok).toBe(false);

    // Magical Draw succeeds for an available tile code and never creates >4 copies
    const availableCode = state.wall[0];
    const magRes = useMagicalDraw(state, 'inv_mag', availableCode);
    expect(magRes.res.ok).toBe(true);
    expect(countTileCodes(magRes.state.tiles)[availableCode]).toBeLessThanOrEqual(4);
  });

  it('Shop uses Fibonacci reroll and 2x bench expansion; defeat rolls back completely with new draw order', () => {
    expect([0, 1, 2, 3, 4, 5].map(getRerollCost)).toEqual([2, 3, 5, 8, 13, 21]);
    expect([0, 1, 2, 3].map(getBenchExpandPrice)).toEqual([10, 20, 40, 80]);

    let state = createInitialRun(999);
    const firstAttemptWallTop = [...state.wall.slice(-5)];
    const firstTsumoCode = state.currentTsumo!.code;

    // Mutate board during draw loop (place to bench + finish draws)
    state = placeTsumoToBench(state).state;
    // Fast-forward to POST_SHOP_PREP
    while (state.phase === 'DRAW_LOOP') {
      if (state.drawSubPhase === 'TSUMO') state = discardTsumo(state).state;
      else if (state.drawSubPhase === 'FURO_CHECK' || state.drawSubPhase === 'FURO_SKIP_WAIT') {
        state = passOrFinishFuro(state).state;
      } else if (state.drawSubPhase === 'GRID_REPLACE') {
        const gTile = state.tiles.find((t) => t.location === 'GRID' && !t.lockGroupId)!;
        state = resolveGridReplace(state, gTile.id, 'DISCARD').state;
      }
    }
    expect(state.phase).toBe('POST_SHOP_PREP');

    // Test shop reroll Fibonacci deduction
    state.points = 20;
    state = rerollShop(state).state;
    expect(state.points).toBe(18); // -2
    state = rerollShop(state).state;
    expect(state.points).toBe(15); // -3

    // Enter combat and lose -> lives -1, 0 consolation points, rollback to roundStartSnapshot with DIFFERENT draw order!
    state = beginYakuTrigger(state).state;
    state = enterCombatPhase(state).state;
    state = finishCombatAndApplyResult(state, {
      won: false,
      timedOut: false,
      round: 1,
      enemyWave: 'SWARM',
      totalHan: 0,
      yakumanCount: 0,
      durationSec: 12,
      totalAllyDamage: 500,
      survivingAllies: 0,
    }).state;
    expect(state.lives).toBe(2);
    expect(state.lastRoundResult?.pointsEarned).toBe(0);

    state = proceedAfterRoundResult(state).state;
    expect(state.phase).toBe('DRAW_LOOP');
    expect(state.round).toBe(1);
    expect(state.points).toBe(0); // Rolled back pre-shop points too!
    expect(state.tiles.length).toBe(14); // Rolled back to initial 14 tiles!
    const retryWallTop = [...state.wall.slice(-5)];
    const retryTsumoCode = state.currentTsumo!.code;
    expect(
      retryTsumoCode !== firstTsumoCode ||
        retryWallTop.some((v, idx) => v !== firstAttemptWallTop[idx]),
    ).toBe(true);
  });

  it('blocks free discard of the last tile on grid', () => {
    const state = createInitialRun(55);
    state.phase = 'POST_SHOP_PREP';
    const gridTiles = state.tiles.filter((t) => t.location === 'GRID');
    let cur = state;
    for (let i = 0; i < gridTiles.length - 1; i++) {
      cur = discardOwnedTile(cur, gridTiles[i].id).state;
    }
    const lastRes = discardOwnedTile(cur, gridTiles[gridTiles.length - 1].id);
    expect(lastRes.res.ok).toBe(false);
  });

  it('buys shop offer and handles buyShopOffer', () => {
    const state = createInitialRun(42);
    state.phase = 'POST_SHOP_PREP';
    state.points = 100;
    state.shopOffers = [
      { offerId: 'o1', itemId: 'BENCH_EXPAND', price: 10, purchased: false },
    ];
    const res = buyShopOffer(state, 'o1');
    expect(res.res.ok).toBe(true);
    expect(res.state.benchCapacity).toBe(7);
    expect(res.state.points).toBe(90);
  });

  it('executes Furo and resolves overflow cleanly', () => {
    let state = createInitialRun(33);
    state.drawSubPhase = 'FURO_CHECK';
    const code = state.tiles[2].code;
    state.tiles[3].code = code; state.tiles[3].suit = state.tiles[2].suit; state.tiles[3].rank = state.tiles[2].rank;
    state.currentDiscards = [code, 0, 1];
    const cands = detectFuroCandidates(state.tiles, state.currentDiscards);
    const pon = cands.find((c) => c.type === 'PON' && c.discardIndex === 0)!;
    expect(pon).toBeDefined();
    const res = executeFuro(state, pon.id);
    expect(res.res.ok).toBe(true);
    state = res.state;
    expect(state.lockedGroups.length).toBe(1);
    expect(state.lockedGroups[0].type).toBe('PON');
  });
});

describe('12x6 2D Grid Combat Simulator', () => {
  it('runs deterministically, enforces 60s timeout as defeat, and deploys Head tiles for Chiitoitsu', () => {
    const state = createInitialRun(2026);
    // Construct Chiitoitsu (6 pairs on grid + 1 pair in head = 14 tiles)
    state.tiles = [
      ...makeHeadPair(0),
      makeGridTile('p1a', 1, 0, 0), makeGridTile('p1b', 1, 0, 1),
      makeGridTile('p2a', 2, 1, 0), makeGridTile('p2b', 2, 1, 1),
      makeGridTile('p3a', 9, 2, 0), makeGridTile('p3b', 9, 2, 1),
      makeGridTile('p4a', 10, 3, 0), makeGridTile('p4b', 10, 3, 1),
      makeGridTile('p5a', 18, 4, 0), makeGridTile('p5b', 18, 4, 1),
      makeGridTile('p6a', 31, 5, 0), makeGridTile('p6b', 31, 5, 1),
    ];
    state.lockedGroups = [];
    const ev = evaluateHand(state.tiles, [], [], 27, 27, ZERO_BUFFS);
    expect(ev.deployHeadTiles).toBe(true);

    const sim1 = createCombatSimulation(state, ev);
    const allyCount = sim1.units.filter((u) => u.side === 'PLAYER').length;
    expect(allyCount).toBe(14); // Head 2 tiles deployed!

    runCombatToCompletion(sim1);
    const sim2 = createCombatSimulation(state, ev);
    runCombatToCompletion(sim2);
    expect(sim1.won).toBe(sim2.won);
    expect(sim1.tickCount).toBe(sim2.tickCount);

    // Timeout check: make an immortal enemy & ally so battle hits 60s
    const simTimeout = createCombatSimulation(state, ev);
    simTimeout.units.forEach((u) => {
      u.hp = 1_000_000_000;
      u.maxHp = 1_000_000_000;
    });
    while (!simTimeout.finished) {
      stepCombatTick(simTimeout);
    }
    expect(simTimeout.timedOut).toBe(true);
    expect(simTimeout.won).toBe(false);
    expect(simTimeout.elapsedSec).toBeGreaterThanOrEqual(COMBAT_TIMEOUT_SEC);
  });

  it('Sniper targets backline (lowest col) ally first, and Boss triggers enrage after 20s', () => {
    const state = createInitialRun(101);
    state.round = 5;
    state.currentWaveArchetype = 'SNIPER';
    state.tiles = [
      makeGridTile('front', 0, 2, 5), // frontline col 5
      makeGridTile('back', 1, 2, 0),  // backline col 0
    ];
    const ev = evaluateHand(state.tiles, [], [], 27, 27, ZERO_BUFFS);
    const sim = createCombatSimulation(state, ev);
    // Keep snipers in range of col 0 and give allies enough HP so backline doesn't die mid-salvo
    sim.units.forEach((u) => {
      if (u.side === 'PLAYER') {
        u.hp = 1000;
        u.maxHp = 1000;
      } else if (u.archetype === 'SNIPER') {
        u.col = 6;
        u.range = 10;
      } else {
        u.alive = false;
      }
    });
    for (let i = 0; i < 40; i++) stepCombatTick(sim);
    const backAlly = sim.units.find((u) => u.sourceTileIds[0] === 'back')!;
    const frontAlly = sim.units.find((u) => u.sourceTileIds[0] === 'front')!;
    expect(backAlly.hp).toBeLessThan(backAlly.maxHp);
    expect(frontAlly.hp).toBe(frontAlly.maxHp);

    // Boss enrage after 20s
    state.currentWaveArchetype = 'BOSS';
    const bossSim = createCombatSimulation(state, ev);
    bossSim.units.forEach((u) => {
      u.hp = 999999;
      u.maxHp = 999999;
    });
    for (let i = 0; i < 21 * 30; i++) stepCombatTick(bossSim);
    const boss = bossSim.units.find((u) => u.archetype === 'BOSS')!;
    expect(boss.enrageStacks).toBeGreaterThanOrEqual(1);
    expect(boss.atk).toBeGreaterThan(boss.baseAtk);
  });
});
