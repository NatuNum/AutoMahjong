import {
  NORMAL_WAVE_POOL,
  isBossRound,
} from '../config/enemies';
import {
  ALL_SHOP_ITEM_IDS,
  SHOP_CATALOG,
  SHOP_SLOTS_COUNT,
  computeRoundWinPoints,
  getBenchExpandPrice,
  getRerollCost,
} from '../config/shop';
import {
  DRAWS_PER_ROUND,
  INITIAL_BENCH_CAPACITY,
  INITIAL_LIVES,
  MAX_BENCH_CAPACITY,
  MAX_GRID_LOGICAL_TILES,
} from '../config/stats';
import {
  TOTAL_TILE_TYPES,
  WIND_CODES,
  isSuupai,
  rankOfCode,
} from '../config/tiles';
import { detectFuroCandidates, detectSelfKanCandidates } from './furoDetector';
import {
  allocateLineForFuro,
  canAddUnlockedTileToGrid,
  countGridUnits,
  countLogicalGridTiles,
  findFirstEmptyBenchIndex,
  findNearestEmptyGridCell,
  isKanGroup,
  moveLockedGroup,
  movePairToHead,
  moveTileToBench,
  moveTileToGrid,
  rotateLockedGroup,
  syncLockedGroupPositions,
} from './gridOps';
import { evaluateHand } from './handEvaluator';
import { SeededRng, deriveRetrySeed } from './prng';
import { SAVE_VERSION } from './storage';
import type {
  BoardSnapshot,
  ConsumableItemId,
  EnemyArchetype,
  FuroCandidate,
  GameState,
  GridPos,
  KanCandidate,
  LockedGroup,
  Orientation,
  RoundResultSummary,
  ShopItemId,
  ShopOffer,
  TileCode,
  WindCode,
  YakuEvaluation,
} from './types';
import {
  buildRoundWall,
  countTileCodes,
  createTileInstance,
  dealInitial14Tiles,
  popFromWall,
  takeSpecificFromWall,
} from './wall';

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function allocId(state: GameState, prefix: string): string {
  const id = `${prefix}_${state.nextEntityId}`;
  state.nextEntityId++;
  return id;
}

function makeRng(state: GameState): SeededRng {
  const rng = new SeededRng(state.rngSeed);
  rng.setState(state.rngState);
  return rng;
}

function commitRng(state: GameState, rng: SeededRng): void {
  state.rngState = rng.getState();
}

export function getSeatWindForRound(round: number): WindCode {
  const idx = Math.floor((Math.max(1, round) - 1) / 3) % WIND_CODES.length;
  return WIND_CODES[idx];
}

function pickWaveArchetype(round: number, rng: SeededRng): EnemyArchetype {
  if (isBossRound(round)) return 'BOSS';
  return NORMAL_WAVE_POOL[rng.nextInt(NORMAL_WAVE_POOL.length)];
}

export function captureBoardSnapshot(state: GameState): BoardSnapshot {
  return structuredClone({
    tiles: state.tiles,
    lockedGroups: state.lockedGroups,
    benchCapacity: state.benchCapacity,
    benchUpgradeCount: state.benchUpgradeCount,
    inventory: state.inventory,
    permanentBuffs: state.permanentBuffs,
    doraIndicators: state.doraIndicators,
    points: state.points,
    seatWind: state.seatWind,
    nextEntityId: state.nextEntityId,
  });
}

function restoreBoardSnapshot(state: GameState, snap: BoardSnapshot): void {
  const copy = structuredClone(snap);
  state.tiles = copy.tiles;
  state.lockedGroups = copy.lockedGroups;
  state.benchCapacity = copy.benchCapacity;
  state.benchUpgradeCount = copy.benchUpgradeCount;
  state.inventory = copy.inventory;
  state.permanentBuffs = copy.permanentBuffs;
  state.doraIndicators = copy.doraIndicators;
  state.points = copy.points;
  state.seatWind = copy.seatWind;
  state.nextEntityId = copy.nextEntityId;
}

function addRandomPermanentDora(state: GameState, rng: SeededRng): TileCode | null {
  const existing = new Set<TileCode>(state.doraIndicators);
  const available: TileCode[] = [];
  for (let c = 0; c < TOTAL_TILE_TYPES; c++) {
    if (!existing.has(c)) available.push(c);
  }
  if (available.length === 0) return null;
  const chosen = available[rng.nextInt(available.length)];
  state.doraIndicators.push(chosen);
  return chosen;
}

function generateShopOffers(state: GameState, rng: SeededRng): ShopOffer[] {
  const eligible: ShopItemId[] = [];
  for (let i = 0; i < ALL_SHOP_ITEM_IDS.length; i++) {
    const id = ALL_SHOP_ITEM_IDS[i];
    if (id === 'BENCH_EXPAND' && state.benchCapacity >= MAX_BENCH_CAPACITY) continue;
    if (id === 'MAGICAL_DRAW' && state.magicalDrawBoughtThisRound) continue;
    if (id === 'OPEN_DORA' && state.doraIndicators.length >= TOTAL_TILE_TYPES) continue;
    eligible.push(id);
  }

  const offers: ShopOffer[] = [];
  let totalWeight = 0;
  for (let i = 0; i < eligible.length; i++) {
    totalWeight += SHOP_CATALOG[eligible[i]].weight;
  }

  const pickedUniqueInfra = new Set<ShopItemId>();
  for (let slot = 0; slot < SHOP_SLOTS_COUNT && eligible.length > 0; slot++) {
    let roll = rng.nextFloat() * totalWeight;
    let chosenId = eligible[0];
    for (let i = 0; i < eligible.length; i++) {
      roll -= SHOP_CATALOG[eligible[i]].weight;
      if (roll <= 0) {
        chosenId = eligible[i];
        break;
      }
    }
    // Avoid duplicating BENCH_EXPAND or MAGICAL_DRAW in the same shop roll
    if (
      (chosenId === 'BENCH_EXPAND' || chosenId === 'MAGICAL_DRAW') &&
      pickedUniqueInfra.has(chosenId)
    ) {
      const fallback = eligible.find(
        (id) => id !== 'BENCH_EXPAND' && id !== 'MAGICAL_DRAW',
      );
      if (fallback) chosenId = fallback;
    }
    pickedUniqueInfra.add(chosenId);

    const price =
      chosenId === 'BENCH_EXPAND'
        ? getBenchExpandPrice(state.benchUpgradeCount)
        : SHOP_CATALOG[chosenId].basePrice;

    offers.push({
      offerId: allocId(state, 'offer'),
      itemId: chosenId,
      price,
      purchased: false,
    });
  }
  return offers;
}

function openShop(state: GameState, rng: SeededRng): void {
  state.shopRerollCount = 0;
  state.shopOffers = generateShopOffers(state, rng);
}

/**
 * If Head slot has only 1 remaining tile (e.g. its partner was consumed in a Furo/Kan),
 * automatically moves that single tile to Bench (or empty Grid cell).
 */
function sanitizeOrphanHeadTile(state: GameState): void {
  const headTiles = state.tiles.filter((t) => t.location === 'HEAD');
  if (headTiles.length !== 1) return;
  const orphan = headTiles[0];
  const bIdx = findFirstEmptyBenchIndex(state.tiles, state.benchCapacity);
  if (bIdx !== null) {
    orphan.location = 'BENCH';
    orphan.headIndex = null;
    orphan.benchIndex = bIdx;
    return;
  }
  const gPos = findNearestEmptyGridCell(state.tiles, { row: 2, col: 0 });
  if (gPos) {
    orphan.location = 'GRID';
    orphan.headIndex = null;
    orphan.gridPos = gPos;
  }
}

function drawNextTsumoOrEnterPostShop(state: GameState, rng: SeededRng, isBonusDraw: boolean): void {
  if (!isBonusDraw) {
    if (state.drawRemaining <= 0) {
      state.phase = 'POST_SHOP_PREP';
      state.drawSubPhase = 'TSUMO';
      state.currentTsumo = null;
      state.currentDiscards = [];
      state.pendingPlacement = null;
      openShop(state, rng);
      return;
    }
    state.drawRemaining--;
  }

  const code = popFromWall(state.wall);
  if (code === null) {
    // Safety fallback if wall ever exhausts
    state.phase = 'POST_SHOP_PREP';
    state.currentTsumo = null;
    openShop(state, rng);
    return;
  }

  state.currentTsumo = createTileInstance(
    allocId(state, 'tile'),
    code,
    'BENCH',
    null,
    null,
    null,
  );
  state.drawSubPhase = 'TSUMO';
}

function enterDrawLoop(state: GameState, rng: SeededRng): void {
  state.phase = 'DRAW_LOOP';
  state.seatWind = getSeatWindForRound(state.round);
  state.drawRemaining = DRAWS_PER_ROUND;
  state.roundDiscards = [];
  state.currentDiscards = [];
  state.currentTsumo = null;
  state.pendingPlacement = null;
  state.skipNextFuroCheck = false;
  state.roundStartSnapshot = captureBoardSnapshot(state);
  state.wall = buildRoundWall(state.tiles, rng);
  state.currentWaveArchetype = pickWaveArchetype(state.round, rng);
  drawNextTsumoOrEnterPostShop(state, rng, false);
}

/**
 * Starts a brand-new Endless run (skips PRE_SHOP on Round 1 and goes straight to DRAW_LOOP).
 */
export function createInitialRun(seed?: number): GameState {
  const actualSeed = (seed ?? Date.now()) >>> 0;
  const rng = new SeededRng(actualSeed);
  const roundWind = WIND_CODES[rng.nextInt(WIND_CODES.length)];
  const initialDora = rng.nextInt(TOTAL_TILE_TYPES);

  const state: GameState = {
    version: SAVE_VERSION,
    round: 1,
    lives: INITIAL_LIVES,
    points: 0,
    phase: 'INIT_RUN',
    drawSubPhase: 'TSUMO',
    roundWind,
    seatWind: getSeatWindForRound(1),
    rngSeed: actualSeed,
    rngState: rng.getState(),
    drawRemaining: DRAWS_PER_ROUND,
    roundRetryCount: 0,
    wall: [],
    roundDiscards: [],
    currentTsumo: null,
    currentDiscards: [],
    skipNextFuroCheck: false,
    pendingPlacement: null,
    tiles: [],
    lockedGroups: [],
    benchCapacity: INITIAL_BENCH_CAPACITY,
    benchUpgradeCount: 0,
    inventory: [],
    shopOffers: [],
    shopRerollCount: 0,
    magicalDrawBoughtThisRound: false,
    permanentBuffs: { atkAdd: 0, hpAdd: 0, aspdAdd: 0 },
    doraIndicators: [initialDora],
    roundStartSnapshot: null,
    preCombatSnapshot: null,
    currentWaveArchetype: 'SWARM',
    lastRoundResult: null,
    stats: {
      roundsCleared: 0,
      highestHan: 0,
      yakumanTriggered: 0,
      totalKills: 0,
      totalPointsEarned: 0,
    },
    nextEntityId: 1,
  };

  state.tiles = dealInitial14Tiles(rng, () => allocId(state, 'tile'));
  enterDrawLoop(state, rng);
  commitRng(state, rng);
  return state;
}

export function evaluateCurrentHand(state: GameState): YakuEvaluation {
  return evaluateHand(
    state.tiles,
    state.lockedGroups,
    state.doraIndicators,
    state.roundWind,
    state.seatWind,
    state.permanentBuffs,
  );
}

export function getActiveFuroCandidates(state: GameState): FuroCandidate[] {
  if (state.phase !== 'DRAW_LOOP' || state.drawSubPhase !== 'FURO_CHECK') return [];
  return detectFuroCandidates(state.tiles, state.currentDiscards);
}

export function getActiveKanCandidates(state: GameState): KanCandidate[] {
  // Kan is strictly disallowed in POST_SHOP_PREP (only allowed in DRAW_LOOP TSUMO)
  if (state.phase !== 'DRAW_LOOP' || state.drawSubPhase !== 'TSUMO') return [];
  return detectSelfKanCandidates(state.tiles, state.lockedGroups, state.currentTsumo);
}

function proceedAfterTsumoAction(state: GameState, rng: SeededRng): void {
  if (state.skipNextFuroCheck) {
    state.skipNextFuroCheck = false;
    drawNextTsumoOrEnterPostShop(state, rng, false);
    return;
  }

  // Reveal 3 system discards
  const discards: TileCode[] = [];
  for (let i = 0; i < 3; i++) {
    const c = popFromWall(state.wall);
    if (c !== null) {
      discards.push(c);
      state.roundDiscards.push(c);
    }
  }
  state.currentDiscards = discards;

  const furoOptions = detectFuroCandidates(state.tiles, discards);
  if (furoOptions.length === 0) {
    state.drawSubPhase = 'FURO_SKIP_WAIT';
  } else {
    state.drawSubPhase = 'FURO_CHECK';
  }
}

export function startDrawLoopFromPreShop(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'PRE_SHOP') return { state: prev, res: { ok: false, reason: '사전 상점 상태가 아닙니다.' } };
  const state = cloneState(prev);
  const rng = makeRng(state);
  enterDrawLoop(state, rng);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

export function placeTsumoToBench(
  prev: GameState,
  preferredBenchIdx?: number,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'DRAW_LOOP' || prev.drawSubPhase !== 'TSUMO' || !prev.currentTsumo) {
    return { state: prev, res: { ok: false, reason: '쯔모 대기 상태가 아닙니다.' } };
  }
  const state = cloneState(prev);
  let targetIdx = preferredBenchIdx ?? null;
  if (targetIdx !== null) {
    const occupied = state.tiles.some((t) => t.location === 'BENCH' && t.benchIndex === targetIdx);
    if (occupied || targetIdx < 0 || targetIdx >= state.benchCapacity) {
      targetIdx = null;
    }
  }
  if (targetIdx === null) {
    targetIdx = findFirstEmptyBenchIndex(state.tiles, state.benchCapacity);
  }
  if (targetIdx === null) {
    return { state: prev, res: { ok: false, reason: '대기필드가 가득 찼습니다.' } };
  }

  const tsumo = state.currentTsumo!;
  tsumo.location = 'BENCH';
  tsumo.gridPos = null;
  tsumo.headIndex = null;
  tsumo.benchIndex = targetIdx;
  state.tiles.push(tsumo);
  state.currentTsumo = null;

  const rng = makeRng(state);
  proceedAfterTsumoAction(state, rng);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

export function discardTsumo(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'DRAW_LOOP' || prev.drawSubPhase !== 'TSUMO' || !prev.currentTsumo) {
    return { state: prev, res: { ok: false, reason: '쯔모 대기 상태가 아닙니다.' } };
  }
  const state = cloneState(prev);
  state.roundDiscards.push(state.currentTsumo!.code);
  state.currentTsumo = null;

  const rng = makeRng(state);
  proceedAfterTsumoAction(state, rng);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

/**
 * Places currentTsumo onto the 6x6 combat grid.
 * - If logical grid tiles < 12 and target cell is empty: places directly and moves on.
 * - If logical grid tiles >= 12 (or target cell is occupied by an unlocked tile):
 *   enters GRID_REPLACE subphase so player selects which grid tile to move to Bench or Discard.
 */
export function placeTsumoToGrid(
  prev: GameState,
  targetPos?: GridPos,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'DRAW_LOOP' || prev.drawSubPhase !== 'TSUMO' || !prev.currentTsumo) {
    return { state: prev, res: { ok: false, reason: '쯔모 대기 상태가 아닙니다.' } };
  }
  const state = cloneState(prev);
  const tsumo = state.currentTsumo!;

  if (targetPos) {
    const occ = state.tiles.find(
      (t) =>
        t.location === 'GRID' &&
        t.gridPos &&
        t.gridPos.row === targetPos.row &&
        t.gridPos.col === targetPos.col,
    );
    if (occ && occ.lockGroupId !== null) {
      return { state: prev, res: { ok: false, reason: '고정된 후로/깡 칸에는 배치할 수 없습니다.' } };
    }
    if (!occ && canAddUnlockedTileToGrid(state.tiles, state.lockedGroups)) {
      tsumo.location = 'GRID';
      tsumo.gridPos = { row: targetPos.row, col: targetPos.col };
      tsumo.benchIndex = null;
      tsumo.headIndex = null;
      state.tiles.push(tsumo);
      state.currentTsumo = null;
      const rng = makeRng(state);
      proceedAfterTsumoAction(state, rng);
      commitRng(state, rng);
      return { state, res: { ok: true } };
    }
  } else if (canAddUnlockedTileToGrid(state.tiles, state.lockedGroups)) {
    const empty = findNearestEmptyGridCell(state.tiles, { row: 2, col: 2 });
    if (empty) {
      tsumo.location = 'GRID';
      tsumo.gridPos = empty;
      tsumo.benchIndex = null;
      tsumo.headIndex = null;
      state.tiles.push(tsumo);
      state.currentTsumo = null;
      const rng = makeRng(state);
      proceedAfterTsumoAction(state, rng);
      commitRng(state, rng);
      return { state, res: { ok: true } };
    }
  }

  // Must replace an existing unlocked grid tile (move it to Bench or Discard)
  const hasUnlockedGridTile = state.tiles.some(
    (t) => t.location === 'GRID' && t.lockGroupId === null,
  );
  if (!hasUnlockedGridTile) {
    return { state: prev, res: { ok: false, reason: '교체할 수 있는 비고정 전투 패가 없습니다.' } };
  }

  state.pendingPlacement = {
    tile: tsumo,
    targetPos: targetPos ?? null,
    source: 'TSUMO',
    skipFuroCheckAfter: state.skipNextFuroCheck,
  };
  state.drawSubPhase = 'GRID_REPLACE';
  return { state, res: { ok: true } };
}

/**
 * Resolves GRID_REPLACE by choosing an unlocked grid tile to send to BENCH or DISCARD,
 * placing the pending tile into the vacated (or target) cell.
 */
export function resolveGridReplace(
  prev: GameState,
  replacedTileId: string,
  destination: 'BENCH' | 'DISCARD',
): { state: GameState; res: ActionResult } {
  if (!prev.pendingPlacement) {
    return { state: prev, res: { ok: false, reason: '대기 중인 전투 필드 교체가 없습니다.' } };
  }
  const state = cloneState(prev);
  const pending = state.pendingPlacement!;
  const targetIdx = state.tiles.findIndex((t) => t.id === replacedTileId);
  if (targetIdx === -1) {
    return { state: prev, res: { ok: false, reason: '대상 패를 찾을 수 없습니다.' } };
  }
  const replaced = state.tiles[targetIdx];
  if (replaced.location !== 'GRID' || replaced.lockGroupId !== null) {
    return { state: prev, res: { ok: false, reason: '전투 필드의 비고정 패만 교체할 수 있습니다.' } };
  }

  const vacatedPos = { ...replaced.gridPos! };

  if (destination === 'BENCH') {
    const bIdx = findFirstEmptyBenchIndex(state.tiles, state.benchCapacity);
    if (bIdx === null) {
      return { state: prev, res: { ok: false, reason: '대기필드가 가득 찼습니다. 버리기를 선택해주세요.' } };
    }
    replaced.location = 'BENCH';
    replaced.gridPos = null;
    replaced.benchIndex = bIdx;
  } else {
    state.roundDiscards.push(replaced.code);
    state.tiles.splice(targetIdx, 1);
  }

  if (pending.source === 'FURO_OVERFLOW') {
    // Check if grid is still above 12 logical slots (can happen when 2 materials came from bench)
    if (countLogicalGridTiles(state.tiles, state.lockedGroups) > MAX_GRID_LOGICAL_TILES) {
      return { state, res: { ok: true } };
    }
    state.pendingPlacement = null;
    const rng = makeRng(state);
    if (pending.skipFuroCheckAfter) {
      // Minkan overflow finished -> grant bonus draw with skipNextFuroCheck = true
      state.skipNextFuroCheck = true;
      drawNextTsumoOrEnterPostShop(state, rng, true);
    } else {
      drawNextTsumoOrEnterPostShop(state, rng, false);
    }
    commitRng(state, rng);
    return { state, res: { ok: true } };
  }

  // Place pending tile onto targetPos if empty, else vacatedPos
  let placePos = vacatedPos;
  if (pending.targetPos) {
    const occupied = state.tiles.some(
      (t) =>
        t.location === 'GRID' &&
        t.gridPos &&
        t.gridPos.row === pending.targetPos!.row &&
        t.gridPos.col === pending.targetPos!.col,
    );
    if (!occupied) {
      placePos = { ...pending.targetPos };
    }
  }

  const incoming = pending.tile;
  incoming.location = 'GRID';
  incoming.gridPos = placePos;
  incoming.benchIndex = null;
  incoming.headIndex = null;
  state.tiles.push(incoming);
  state.pendingPlacement = null;

  if (pending.source === 'TSUMO') {
    state.currentTsumo = null;
    const rng = makeRng(state);
    proceedAfterTsumoAction(state, rng);
    commitRng(state, rng);
  } else {
    // MAGICAL_DRAW resolved without affecting drawSubPhase
    state.drawSubPhase = 'TSUMO';
  }
  return { state, res: { ok: true } };
}

export function cancelGridReplace(prev: GameState): { state: GameState; res: ActionResult } {
  if (!prev.pendingPlacement || prev.pendingPlacement.source !== 'TSUMO') {
    return { state: prev, res: { ok: false, reason: '취소할 수 없는 상태입니다.' } };
  }
  const state = cloneState(prev);
  state.pendingPlacement = null;
  state.drawSubPhase = 'TSUMO';
  return { state, res: { ok: true } };
}

/**
 * Completes FURO_SKIP_WAIT or skips an optional FURO_CHECK and moves to next Tsumo / POST_SHOP_PREP.
 */
export function passOrFinishFuro(prev: GameState): { state: GameState; res: ActionResult } {
  if (
    prev.phase !== 'DRAW_LOOP' ||
    (prev.drawSubPhase !== 'FURO_CHECK' && prev.drawSubPhase !== 'FURO_SKIP_WAIT')
  ) {
    return { state: prev, res: { ok: false, reason: '후로 단계가 아닙니다.' } };
  }
  const state = cloneState(prev);
  state.currentDiscards = [];
  const rng = makeRng(state);
  drawNextTsumoOrEnterPostShop(state, rng, false);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

/**
 * Executes a chosen CHI, PON, or MINKAN candidate from the 3 discards (max 1 per FURO_CHECK).
 */
export function executeFuro(
  prev: GameState,
  candidateId: string,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'DRAW_LOOP' || prev.drawSubPhase !== 'FURO_CHECK') {
    return { state: prev, res: { ok: false, reason: '후로 가능 상태가 아닙니다.' } };
  }
  const candidates = detectFuroCandidates(prev.tiles, prev.currentDiscards);
  const cand = candidates.find((c) => c.id === candidateId);
  if (!cand) {
    return { state: prev, res: { ok: false, reason: '유효하지 않은 후로 선택입니다.' } };
  }

  const state = cloneState(prev);
  const rng = makeRng(state);
  const consumedIds = new Set<string>(cand.materialTileIds);

  // Claimed discard tile instance
  const claimedTile = createTileInstance(
    allocId(state, 'tile'),
    cand.discardCode,
    'GRID',
    null,
    null,
    null,
  );
  state.tiles.push(claimedTile);

  // Remove the claimed tile from roundDiscards (since it's now owned by player!)
  const discIdx = state.roundDiscards.lastIndexOf(cand.discardCode);
  if (discIdx !== -1) {
    state.roundDiscards.splice(discIdx, 1);
  }

  const groupId = allocId(state, 'lock');

  if (cand.type === 'MINKAN') {
    // Pick anchor from first grid material, or nearest empty cell
    const matTiles = cand.materialTileIds
      .map((id) => state.tiles.find((t) => t.id === id)!)
      .filter(Boolean);
    const gridMat = matTiles.find((t) => t.location === 'GRID' && t.gridPos !== null);
    const anchor =
      gridMat?.gridPos
        ? { ...gridMat.gridPos }
        : findNearestEmptyGridCell(state.tiles, { row: 2, col: 2 }) ?? { row: 2, col: 2 };

    const allIds = [...cand.materialTileIds, claimedTile.id];
    const newGroup: LockedGroup = {
      groupId,
      type: 'MINKAN',
      tileIds: allIds,
      tileCodes: [...cand.resultCodes],
      isMenzen: false,
      claimedTileId: claimedTile.id,
      anchorGridPos: anchor,
      orientation: 'HORIZONTAL',
    };
    state.lockedGroups.push(newGroup);
    syncLockedGroupPositions(state.tiles, newGroup);
    sanitizeOrphanHeadTile(state);

    // Permanent Dora +1
    addRandomPermanentDora(state, rng);
    state.currentDiscards = [];

    // Check 12 logical slot overflow
    if (countLogicalGridTiles(state.tiles, state.lockedGroups) > MAX_GRID_LOGICAL_TILES) {
      state.pendingPlacement = {
        tile: claimedTile,
        targetPos: null,
        source: 'FURO_OVERFLOW',
        skipFuroCheckAfter: true,
      };
      state.drawSubPhase = 'GRID_REPLACE';
      commitRng(state, rng);
      return { state, res: { ok: true } };
    }

    // Minkan bonus draw +1 and skip FURO_CHECK afterwards!
    state.skipNextFuroCheck = true;
    drawNextTsumoOrEnterPostShop(state, rng, true);
    commitRng(state, rng);
    return { state, res: { ok: true } };
  }

  // CHI or PON -> allocate a 3-cell straight line (pushing isolated tiles aside if needed)
  const line = allocateLineForFuro(state.tiles, state.lockedGroups, consumedIds, state.benchCapacity);
  if (!line) {
    return { state: prev, res: { ok: false, reason: '전투 그리드에 후로 3칸 직선 공간이 부족합니다.' } };
  }

  // Sort tileIds to match ascending tileCodes for clean visual order (especially Chi)
  const memberTiles = [
    ...cand.materialTileIds.map((id) => state.tiles.find((t) => t.id === id)!),
    claimedTile,
  ].sort((a, b) => a.code - b.code);

  const newGroup: LockedGroup = {
    groupId,
    type: cand.type,
    tileIds: memberTiles.map((t) => t.id),
    tileCodes: memberTiles.map((t) => t.code),
    isMenzen: false,
    claimedTileId: claimedTile.id,
    anchorGridPos: line.anchor,
    orientation: line.orientation,
  };
  state.lockedGroups.push(newGroup);
  syncLockedGroupPositions(state.tiles, newGroup);
  sanitizeOrphanHeadTile(state);
  state.currentDiscards = [];

  // Check 12 logical slot overflow -> player chooses tile(s) to bench or discard
  if (countLogicalGridTiles(state.tiles, state.lockedGroups) > MAX_GRID_LOGICAL_TILES) {
    state.pendingPlacement = {
      tile: claimedTile,
      targetPos: null,
      source: 'FURO_OVERFLOW',
      skipFuroCheckAfter: false,
    };
    state.drawSubPhase = 'GRID_REPLACE';
    commitRng(state, rng);
    return { state, res: { ok: true } };
  }

  drawNextTsumoOrEnterPostShop(state, rng, false);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

/**
 * Executes ANKAN or KAKAN during DRAW_LOOP TSUMO.
 * Strictly forbidden in POST_SHOP_PREP.
 */
export function executeSelfKan(
  prev: GameState,
  candidate: KanCandidate,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'DRAW_LOOP' || prev.drawSubPhase !== 'TSUMO') {
    return { state: prev, res: { ok: false, reason: '깡은 쯔모 페이즈에서만 실행할 수 있습니다.' } };
  }
  const available = detectSelfKanCandidates(prev.tiles, prev.lockedGroups, prev.currentTsumo);
  const match = available.find(
    (c) =>
      c.type === candidate.type &&
      c.tileCode === candidate.tileCode &&
      c.targetLockGroupId === candidate.targetLockGroupId,
  );
  if (!match) {
    return { state: prev, res: { ok: false, reason: '유효하지 않은 깡 요청입니다.' } };
  }

  const state = cloneState(prev);
  const rng = makeRng(state);

  if (match.usesCurrentTsumo && state.currentTsumo) {
    state.tiles.push(state.currentTsumo);
    state.currentTsumo = null;
  }

  if (match.type === 'ANKAN') {
    const matTiles = match.tileIds
      .map((id) => state.tiles.find((t) => t.id === id)!)
      .filter(Boolean);
    const gridMat = matTiles.find((t) => t.location === 'GRID' && t.gridPos !== null);
    const anchor =
      gridMat?.gridPos
        ? { ...gridMat.gridPos }
        : findNearestEmptyGridCell(state.tiles, { row: 2, col: 2 }) ?? { row: 2, col: 2 };

    const groupId = allocId(state, 'lock');
    const newGroup: LockedGroup = {
      groupId,
      type: 'ANKAN',
      tileIds: [...match.tileIds],
      tileCodes: [match.tileCode, match.tileCode, match.tileCode, match.tileCode],
      isMenzen: true,
      claimedTileId: null,
      anchorGridPos: anchor,
      orientation: 'HORIZONTAL',
    };
    state.lockedGroups.push(newGroup);
    syncLockedGroupPositions(state.tiles, newGroup);
    sanitizeOrphanHeadTile(state);

    // Permanent Dora +1
    addRandomPermanentDora(state, rng);

    // Ankan grants bonus draw +1 and STILL proceeds to FURO_CHECK after player's action!
    state.skipNextFuroCheck = false;
    drawNextTsumoOrEnterPostShop(state, rng, true);
    commitRng(state, rng);
    return { state, res: { ok: true } };
  }

  // KAKAN: upgrade existing PON group -> 1-cell giant KAKAN
  const targetGroup = state.lockedGroups.find((g) => g.groupId === match.targetLockGroupId);
  if (!targetGroup) {
    return { state: prev, res: { ok: false, reason: '대상 퐁 그룹을 찾을 수 없습니다.' } };
  }
  const addedId = match.tileIds[0];
  targetGroup.type = 'KAKAN';
  targetGroup.isMenzen = false;
  targetGroup.tileIds.push(addedId);
  targetGroup.tileCodes.push(match.tileCode);
  syncLockedGroupPositions(state.tiles, targetGroup);
  sanitizeOrphanHeadTile(state);

  // Permanent Dora +1
  addRandomPermanentDora(state, rng);

  // Kakan is furo-based Kan -> bonus draw +1 and SKIP FURO_CHECK after bonus draw!
  state.skipNextFuroCheck = true;
  drawNextTsumoOrEnterPostShop(state, rng, true);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

/**
 * Free discard of an owned unlocked tile (allowed in PRE_SHOP, TSUMO, POST_SHOP_PREP).
 * Forbids removing the last unit on the combat grid.
 */
export function discardOwnedTile(
  prev: GameState,
  tileId: string,
): { state: GameState; res: ActionResult } {
  const canEdit =
    prev.phase === 'PRE_SHOP' ||
    prev.phase === 'POST_SHOP_PREP' ||
    (prev.phase === 'DRAW_LOOP' && prev.drawSubPhase === 'TSUMO');
  if (!canEdit) {
    return { state: prev, res: { ok: false, reason: '현재 단계에서는 패를 버릴 수 없습니다.' } };
  }

  const idx = prev.tiles.findIndex((t) => t.id === tileId);
  if (idx === -1) return { state: prev, res: { ok: false, reason: '패를 찾을 수 없습니다.' } };
  const target = prev.tiles[idx];
  if (target.lockGroupId !== null) {
    return { state: prev, res: { ok: false, reason: '잠긴 후로/깡 패는 버릴 수 없습니다.' } };
  }
  if (target.location === 'GRID' && countGridUnits(prev.tiles, prev.lockedGroups) <= 1) {
    return { state: prev, res: { ok: false, reason: '전투 그리드의 마지막 패는 버릴 수 없습니다.' } };
  }

  const state = cloneState(prev);
  const removed = state.tiles.splice(idx, 1)[0];
  state.roundDiscards.push(removed.code);
  sanitizeOrphanHeadTile(state);
  return { state, res: { ok: true } };
}

/** Board rearrangement actions (allowed in PRE_SHOP, DRAW_LOOP TSUMO, POST_SHOP_PREP) */
function isBoardEditable(state: GameState): boolean {
  return (
    state.phase === 'PRE_SHOP' ||
    state.phase === 'POST_SHOP_PREP' ||
    (state.phase === 'DRAW_LOOP' && state.drawSubPhase === 'TSUMO')
  );
}

export function boardMoveTileToGrid(
  prev: GameState,
  tileId: string,
  pos: GridPos,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  const ok = moveTileToGrid(state.tiles, state.lockedGroups, tileId, pos, state.benchCapacity);
  return ok ? { state, res: { ok: true } } : { state: prev, res: { ok: false } };
}

export function boardMoveTileToBench(
  prev: GameState,
  tileId: string,
  benchIdx: number,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  const ok = moveTileToBench(state.tiles, state.lockedGroups, tileId, benchIdx, state.benchCapacity);
  return ok ? { state, res: { ok: true } } : { state: prev, res: { ok: false } };
}

export function boardMovePairToHead(
  prev: GameState,
  tileId: string,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  const ok = movePairToHead(state.tiles, state.lockedGroups, tileId);
  return ok
    ? { state, res: { ok: true } }
    : { state: prev, res: { ok: false, reason: '머리 슬롯에는 동일한 패 2장(또이쯔)만 배치할 수 있습니다.' } };
}

export function boardMoveLockedGroup(
  prev: GameState,
  groupId: string,
  newAnchor: GridPos,
  orientation?: Orientation,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  const ok = moveLockedGroup(state.tiles, state.lockedGroups, groupId, newAnchor, orientation);
  return ok ? { state, res: { ok: true } } : { state: prev, res: { ok: false } };
}

export function boardRotateLockedGroup(
  prev: GameState,
  groupId: string,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  const ok = rotateLockedGroup(state.tiles, state.lockedGroups, groupId);
  return ok ? { state, res: { ok: true } } : { state: prev, res: { ok: false } };
}

// --- Shop & Consumables ---

export function rerollShop(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'PRE_SHOP' && prev.phase !== 'POST_SHOP_PREP') {
    return { state: prev, res: { ok: false, reason: '상점이 열려있지 않습니다.' } };
  }
  const cost = getRerollCost(prev.shopRerollCount);
  if (prev.points < cost) {
    return { state: prev, res: { ok: false, reason: `점봉이 부족합니다 (필요: ${cost}).` } };
  }
  const state = cloneState(prev);
  const rng = makeRng(state);
  state.points -= cost;
  state.shopRerollCount++;
  state.shopOffers = generateShopOffers(state, rng);
  commitRng(state, rng);
  return { state, res: { ok: true } };
}

export function buyShopOffer(
  prev: GameState,
  offerId: string,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'PRE_SHOP' && prev.phase !== 'POST_SHOP_PREP') {
    return { state: prev, res: { ok: false, reason: '상점이 열려있지 않습니다.' } };
  }
  const offer = prev.shopOffers.find((o) => o.offerId === offerId);
  if (!offer || offer.purchased) {
    return { state: prev, res: { ok: false, reason: '이미 구매한 상품입니다.' } };
  }
  if (prev.points < offer.price) {
    return { state: prev, res: { ok: false, reason: '점봉이 부족합니다.' } };
  }
  if (offer.itemId === 'BENCH_EXPAND' && prev.benchCapacity >= MAX_BENCH_CAPACITY) {
    return { state: prev, res: { ok: false, reason: '대기필드가 이미 최대치(12칸)입니다.' } };
  }
  if (offer.itemId === 'MAGICAL_DRAW' && prev.magicalDrawBoughtThisRound) {
    return { state: prev, res: { ok: false, reason: '매지컬 드로우는 라운드당 1회만 구매 가능합니다.' } };
  }

  const state = cloneState(prev);
  const rng = makeRng(state);
  const targetOffer = state.shopOffers.find((o) => o.offerId === offerId)!;
  state.points -= targetOffer.price;
  targetOffer.purchased = true;

  switch (targetOffer.itemId) {
    case 'BENCH_EXPAND':
      state.benchCapacity++;
      state.benchUpgradeCount++;
      break;
    case 'DISMANTLE_TICKET':
    case 'RANK_SHIFT_TICKET':
    case 'MAGICAL_DRAW':
      state.inventory.push({
        instanceId: allocId(state, 'inv'),
        itemId: targetOffer.itemId as ConsumableItemId,
      });
      if (targetOffer.itemId === 'MAGICAL_DRAW') {
        state.magicalDrawBoughtThisRound = true;
      }
      break;
    case 'PERM_ATK':
      state.permanentBuffs.atkAdd += 0.08;
      break;
    case 'PERM_HP':
      state.permanentBuffs.hpAdd += 0.1;
      break;
    case 'PERM_ASPD':
      state.permanentBuffs.aspdAdd += 0.08;
      break;
    case 'OPEN_DORA':
      addRandomPermanentDora(state, rng);
      break;
  }

  commitRng(state, rng);
  return { state, res: { ok: true } };
}

export function useDismantleTicket(
  prev: GameState,
  inventoryInstanceId: string,
  groupId: string,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) {
    return { state: prev, res: { ok: false, reason: '현재 단계에서는 사용할 수 없습니다.' } };
  }
  const invIdx = prev.inventory.findIndex(
    (i) => i.instanceId === inventoryInstanceId && i.itemId === 'DISMANTLE_TICKET',
  );
  if (invIdx === -1) return { state: prev, res: { ok: false, reason: '해체권이 없습니다.' } };

  const group = prev.lockedGroups.find((g) => g.groupId === groupId);
  if (!group) return { state: prev, res: { ok: false, reason: '대상 후로/깡 그룹을 찾을 수 없습니다.' } };

  const state = cloneState(prev);
  const gIdx = state.lockedGroups.findIndex((g) => g.groupId === groupId);
  const targetGroup = state.lockedGroups[gIdx];

  if (!isKanGroup(targetGroup)) {
    // CHI / PON: simply unlock the 3 tiles in place!
    state.lockedGroups.splice(gIdx, 1);
    for (let i = 0; i < targetGroup.tileIds.length; i++) {
      const t = state.tiles.find((tile) => tile.id === targetGroup.tileIds[i]);
      if (t) t.lockGroupId = null;
    }
    state.inventory.splice(invIdx, 1);
    return { state, res: { ok: true } };
  }

  // KAN (4 tiles on 1 cell): unpack into individual tiles (grid first up to 12 logical, excess to bench)
  const logicalWithoutKan = countLogicalGridTiles(state.tiles, state.lockedGroups) - 3;
  const maxGridTilesForKan = Math.min(4, MAX_GRID_LOGICAL_TILES - logicalWithoutKan);
  const currentBenchCount = state.tiles.filter((t) => t.location === 'BENCH').length;
  const freeBench = state.benchCapacity - currentBenchCount;

  // Check total grid + bench space for 4 tiles
  if (maxGridTilesForKan + freeBench < 4) {
    return {
      state: prev,
      res: { ok: false, reason: '전투 그리드 및 대기필드 여유 공간이 부족하여 깡을 해체할 수 없습니다.' },
    };
  }

  state.lockedGroups.splice(gIdx, 1);
  const anchor = { ...targetGroup.anchorGridPos };
  const kanTiles = targetGroup.tileIds
    .map((id) => state.tiles.find((t) => t.id === id)!)
    .filter(Boolean);

  for (let i = 0; i < kanTiles.length; i++) {
    kanTiles[i].lockGroupId = null;
    kanTiles[i].gridPos = null;
  }

  // Place first tile at anchor, up to maxGridTilesForKan on grid, rest on bench
  let placedOnGrid = 0;
  for (let i = 0; i < kanTiles.length; i++) {
    const t = kanTiles[i];
    if (placedOnGrid < maxGridTilesForKan) {
      const pos =
        placedOnGrid === 0 ? anchor : findNearestEmptyGridCell(state.tiles, anchor);
      if (pos) {
        t.location = 'GRID';
        t.gridPos = pos;
        t.benchIndex = null;
        placedOnGrid++;
        continue;
      }
    }
    const bIdx = findFirstEmptyBenchIndex(state.tiles, state.benchCapacity);
    if (bIdx === null) {
      return {
        state: prev,
        res: { ok: false, reason: '대기필드 여유 공간이 부족하여 깡을 해체할 수 없습니다.' },
      };
    }
    t.location = 'BENCH';
    t.gridPos = null;
    t.benchIndex = bIdx;
  }

  state.inventory.splice(invIdx, 1);
  return { state, res: { ok: true } };
}

export function useRankShiftTicket(
  prev: GameState,
  inventoryInstanceId: string,
  tileId: string,
  delta: 1 | -1,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) {
    return { state: prev, res: { ok: false, reason: '현재 단계에서는 사용할 수 없습니다.' } };
  }
  const invIdx = prev.inventory.findIndex(
    (i) => i.instanceId === inventoryInstanceId && i.itemId === 'RANK_SHIFT_TICKET',
  );
  if (invIdx === -1) return { state: prev, res: { ok: false, reason: '숫자 변경권이 없습니다.' } };

  const target = prev.tiles.find((t) => t.id === tileId);
  if (!target) return { state: prev, res: { ok: false, reason: '대상 패를 찾을 수 없습니다.' } };
  if (target.lockGroupId !== null) {
    return { state: prev, res: { ok: false, reason: '후로/깡으로 잠긴 패는 해체 전까지 변경할 수 없습니다.' } };
  }
  if (!isSuupai(target.code)) {
    return { state: prev, res: { ok: false, reason: '자패에는 숫자 변경권을 사용할 수 없습니다.' } };
  }
  if (target.location === 'HEAD') {
    return { state: prev, res: { ok: false, reason: '머리 슬롯의 패는 꺼낸 뒤 변경해주세요.' } };
  }
  const curRank = rankOfCode(target.code);
  if ((curRank === 1 && delta === -1) || (curRank === 9 && delta === 1)) {
    return { state: prev, res: { ok: false, reason: '1에서 -1, 9에서 +1 순환 변경은 불가합니다.' } };
  }

  // Enforce max 4 copies globally (never allow exceeding 4 owned copies of same code)
  const nextCode = target.code + delta;
  const ownedCounts = countTileCodes(prev.tiles);
  if (ownedCounts[nextCode] >= 4) {
    return { state: prev, res: { ok: false, reason: '해당 패를 이미 4장 보유 중입니다.' } };
  }

  const state = cloneState(prev);
  const t = state.tiles.find((x) => x.id === tileId)!;
  t.code = nextCode;
  t.rank = curRank + delta;
  state.inventory.splice(invIdx, 1);
  return { state, res: { ok: true } };
}

/**
 * Computes which tile codes (0..33) are currently available for Magical Draw.
 * In PRE_SHOP (before round wall is built): remaining = 4 - owned[code].
 * In DRAW_LOOP / POST_SHOP_PREP: remaining = count in current state.wall (excludes owned & round discards).
 */
export function getMagicalDrawAvailability(state: GameState): Uint8Array {
  const counts = new Uint8Array(TOTAL_TILE_TYPES);
  if (state.phase === 'PRE_SHOP') {
    const owned = countTileCodes(state.tiles);
    for (let c = 0; c < TOTAL_TILE_TYPES; c++) {
      counts[c] = Math.max(0, 4 - owned[c]);
    }
    return counts;
  }
  for (let i = 0; i < state.wall.length; i++) {
    counts[state.wall[i]]++;
  }
  return counts;
}

export function useMagicalDraw(
  prev: GameState,
  inventoryInstanceId: string,
  targetCode: TileCode,
): { state: GameState; res: ActionResult } {
  if (!isBoardEditable(prev)) {
    return { state: prev, res: { ok: false, reason: '현재 단계에서는 사용할 수 없습니다.' } };
  }
  const invIdx = prev.inventory.findIndex(
    (i) => i.instanceId === inventoryInstanceId && i.itemId === 'MAGICAL_DRAW',
  );
  if (invIdx === -1) return { state: prev, res: { ok: false, reason: '매지컬 드로우가 없습니다.' } };

  const avail = getMagicalDrawAvailability(prev);
  if (targetCode < 0 || targetCode >= TOTAL_TILE_TYPES || avail[targetCode] <= 0) {
    return { state: prev, res: { ok: false, reason: '이미 4장이 소진되어 가져올 수 없는 패입니다.' } };
  }

  const state = cloneState(prev);
  if (state.phase !== 'PRE_SHOP') {
    const removed = takeSpecificFromWall(state.wall, targetCode);
    if (!removed) {
      return { state: prev, res: { ok: false, reason: '패산에 남은 패가 없습니다.' } };
    }
  }

  const newTile = createTileInstance(allocId(state, 'tile'), targetCode, 'BENCH', null, null, null);
  const bIdx = findFirstEmptyBenchIndex(state.tiles, state.benchCapacity);
  if (bIdx !== null) {
    newTile.location = 'BENCH';
    newTile.benchIndex = bIdx;
    state.tiles.push(newTile);
  } else if (canAddUnlockedTileToGrid(state.tiles, state.lockedGroups)) {
    const gPos = findNearestEmptyGridCell(state.tiles, { row: 2, col: 2 });
    if (gPos) {
      newTile.location = 'GRID';
      newTile.gridPos = gPos;
      state.tiles.push(newTile);
    } else {
      return { state: prev, res: { ok: false, reason: '보관할 여유 공간이 없습니다.' } };
    }
  } else {
    return { state: prev, res: { ok: false, reason: '대기필드와 전투 그리드가 모두 가득 찼습니다.' } };
  }

  state.inventory.splice(invIdx, 1);
  return { state, res: { ok: true } };
}

// --- Combat & Round Lifecycle ---

export function beginYakuTrigger(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'POST_SHOP_PREP') {
    return { state: prev, res: { ok: false, reason: '최종 편성 단계가 아닙니다.' } };
  }
  if (countGridUnits(prev.tiles, prev.lockedGroups) < 1) {
    return { state: prev, res: { ok: false, reason: '전투 그리드에 최소 1개 이상의 유닛이 필요합니다.' } };
  }
  const state = cloneState(prev);
  state.preCombatSnapshot = captureBoardSnapshot(state);
  state.phase = 'YAKU_TRIGGER';
  return { state, res: { ok: true } };
}

export function enterCombatPhase(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'YAKU_TRIGGER') return { state: prev, res: { ok: false } };
  const state = cloneState(prev);
  state.phase = 'COMBAT';
  return { state, res: { ok: true } };
}

export function finishCombatAndApplyResult(
  prev: GameState,
  result: Omit<RoundResultSummary, 'pointsEarned'>,
): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'COMBAT') return { state: prev, res: { ok: false } };
  const state = cloneState(prev);

  // Restore pre-combat board positions
  if (state.preCombatSnapshot) {
    restoreBoardSnapshot(state, state.preCombatSnapshot);
    state.preCombatSnapshot = null;
  }

  if (result.won) {
    const pointsEarned = computeRoundWinPoints(
      state.round,
      result.totalHan,
      result.yakumanCount > 0,
      isBossRound(state.round),
    );
    state.points += pointsEarned;
    state.stats.roundsCleared++;
    state.stats.highestHan = Math.max(state.stats.highestHan, result.totalHan);
    state.stats.yakumanTriggered += result.yakumanCount;
    state.stats.totalPointsEarned += pointsEarned;
    state.lastRoundResult = { ...result, pointsEarned };
    state.phase = 'ROUND_RESULT';
    return { state, res: { ok: true } };
  }

  // Defeat: lose 1 life, NO consolation points
  state.lives = Math.max(0, state.lives - 1);
  state.lastRoundResult = { ...result, pointsEarned: 0 };
  if (state.lives <= 0) {
    state.phase = 'GAME_OVER';
  } else {
    state.phase = 'ROUND_RESULT';
  }
  return { state, res: { ok: true } };
}

/**
 * Called after viewing ROUND_RESULT:
 * - On win: increments round, rotates seatWind every 3 rounds, opens PRE_SHOP.
 * - On defeat (lives >= 1): rolls back completely to roundStartSnapshot, mutates PRNG seed
 *   for a fresh draw order, and restarts DRAW_LOOP for the same round!
 */
export function proceedAfterRoundResult(prev: GameState): { state: GameState; res: ActionResult } {
  if (prev.phase !== 'ROUND_RESULT' || !prev.lastRoundResult) {
    return { state: prev, res: { ok: false } };
  }
  const state = cloneState(prev);
  const rng = makeRng(state);

  if (state.lastRoundResult!.won) {
    state.round++;
    state.roundRetryCount = 0;
    state.seatWind = getSeatWindForRound(state.round);
    state.magicalDrawBoughtThisRound = false;
    state.phase = 'PRE_SHOP';
    openShop(state, rng);
    commitRng(state, rng);
    return { state, res: { ok: true } };
  }

  // Rollback completely to the start of this round (just before DRAW_LOOP)
  if (state.roundStartSnapshot) {
    restoreBoardSnapshot(state, state.roundStartSnapshot);
  }
  state.roundRetryCount++;
  state.magicalDrawBoughtThisRound = false;

  // Derive a distinct deterministic RNG state so draw order differs from the previous attempt
  const retrySeed = deriveRetrySeed(state.rngSeed, state.round, state.roundRetryCount);
  const retryRng = new SeededRng(retrySeed);
  enterDrawLoop(state, retryRng);
  commitRng(state, retryRng);
  return { state, res: { ok: true } };
}
