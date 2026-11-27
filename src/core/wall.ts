import {
  COPIES_PER_TILE,
  TOTAL_TILE_TYPES,
  rankOfCode,
  suitOfCode,
} from '../config/tiles';
import type { GridPos, TileCode, TileInstance } from './types';
import type { SeededRng } from './prng';

/**
 * Counts how many copies of each tileCode (0..33) exist in the given array.
 */
export function countTileCodes(tiles: readonly TileInstance[]): Uint8Array {
  const counts = new Uint8Array(TOTAL_TILE_TYPES);
  for (let i = 0; i < tiles.length; i++) {
    counts[tiles[i].code]++;
  }
  return counts;
}

/**
 * Counts how many copies of each tileCode remain in the wall array.
 */
export function countWallAvailability(wall: readonly TileCode[]): Uint8Array {
  const counts = new Uint8Array(TOTAL_TILE_TYPES);
  for (let i = 0; i < wall.length; i++) {
    counts[wall[i]]++;
  }
  return counts;
}

/**
 * Rebuilds and shuffles the 136-tile world wall excluding all currently owned tiles.
 * Guarantees no tile type ever exceeds 4 copies across owned + wall.
 */
export function buildRoundWall(ownedTiles: readonly TileInstance[], rng: SeededRng): TileCode[] {
  const ownedCounts = countTileCodes(ownedTiles);
  const wall: TileCode[] = [];
  for (let code = 0; code < TOTAL_TILE_TYPES; code++) {
    const remaining = COPIES_PER_TILE - ownedCounts[code];
    for (let k = 0; k < remaining; k++) {
      wall.push(code);
    }
  }
  return rng.shuffleInPlace(wall);
}

/**
 * Draws 1 tileCode from the end of wall (O(1) pop). Returns null if empty.
 */
export function popFromWall(wall: TileCode[]): TileCode | null {
  if (wall.length === 0) return null;
  return wall.pop()!;
}

/**
 * Removes 1 specific tileCode from the wall (used by Magical Draw).
 * Returns true if found and removed, false if 0 copies remain.
 */
export function takeSpecificFromWall(wall: TileCode[], targetCode: TileCode): boolean {
  for (let i = wall.length - 1; i >= 0; i--) {
    if (wall[i] === targetCode) {
      // O(1) swap-remove with last element is fine since wall order is uniform random,
      // but splice preserves exact order of remaining draws. Wall <= 136 so splice is trivial.
      wall.splice(i, 1);
      return true;
    }
  }
  return false;
}

/** Default initial 12 grid positions in 6x6 ally zone (centered cols 1..4, rows 1..3) */
const INITIAL_GRID_SLOTS: readonly GridPos[] = [
  { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
  { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 },
  { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 },
];

export function createTileInstance(
  id: string,
  code: TileCode,
  location: TileInstance['location'],
  gridPos: GridPos | null,
  benchIndex: number | null,
  headIndex: 0 | 1 | null,
  lockGroupId: string | null = null,
): TileInstance {
  return {
    id,
    code,
    suit: suitOfCode(code),
    rank: rankOfCode(code),
    location,
    gridPos,
    benchIndex,
    headIndex,
    lockGroupId,
  };
}

/**
 * Deals initial 14 tiles guaranteeing at least 1 pair (Toitsu).
 * Places the guaranteed pair in Head slots (0, 1) and the other 12 tiles on the 6x6 ally grid
 * sorted by code so adjacent mentsu/toitsu are immediately readable.
 */
export function dealInitial14Tiles(
  rng: SeededRng,
  allocId: () => string,
): TileInstance[] {
  const pairCode = rng.nextInt(TOTAL_TILE_TYPES);
  const pool: TileCode[] = [];
  for (let code = 0; code < TOTAL_TILE_TYPES; code++) {
    const copies = code === pairCode ? COPIES_PER_TILE - 2 : COPIES_PER_TILE;
    for (let k = 0; k < copies; k++) {
      pool.push(code);
    }
  }
  rng.shuffleInPlace(pool);

  const gridCodes = pool.slice(0, 12).sort((a, b) => a - b);
  const tiles: TileInstance[] = [
    createTileInstance(allocId(), pairCode, 'HEAD', null, null, 0),
    createTileInstance(allocId(), pairCode, 'HEAD', null, null, 1),
  ];

  for (let i = 0; i < 12; i++) {
    const pos = INITIAL_GRID_SLOTS[i];
    tiles.push(
      createTileInstance(allocId(), gridCodes[i], 'GRID', { row: pos.row, col: pos.col }, null, null),
    );
  }
  return tiles;
}
