import { ALLY_COLS, GRID_ROWS, MAX_GRID_LOGICAL_TILES } from '../config/stats';
import type { GridPos, LockedGroup, Orientation, TileInstance } from './types';

export function isValidAllyPos(pos: GridPos): boolean {
  return pos.row >= 0 && pos.row < GRID_ROWS && pos.col >= 0 && pos.col < ALLY_COLS;
}

export function isKanGroup(group: LockedGroup): boolean {
  return group.type === 'ANKAN' || group.type === 'MINKAN' || group.type === 'KAKAN';
}

/**
 * Returns the physical grid cells occupied by a locked group.
 * Kan occupies 1 cell; Chi/Pon occupy 3 consecutive cells in a straight line.
 */
export function getLockedGroupCells(group: LockedGroup): GridPos[] {
  const { row, col } = group.anchorGridPos;
  if (isKanGroup(group)) {
    return [{ row, col }];
  }
  if (group.orientation === 'HORIZONTAL') {
    return [
      { row, col },
      { row, col: col + 1 },
      { row, col: col + 2 },
    ];
  }
  return [
    { row, col },
    { row: row + 1, col },
    { row: row + 2, col },
  ];
}

/**
 * Counts logical tile slots occupied on the 6x6 combat grid.
 * Unlocked grid tiles = 1 each; each LockedGroup (Chi/Pon/Ankan/Minkan/Kakan) = 3 logical slots.
 */
export function countLogicalGridTiles(
  tiles: readonly TileInstance[],
  lockedGroups: readonly LockedGroup[],
): number {
  let unlockedGridCount = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'GRID' && t.lockGroupId === null) {
      unlockedGridCount++;
    }
  }
  return unlockedGridCount + lockedGroups.length * 3;
}

/**
 * Counts physical units currently placed on the 6x6 combat grid (each unlocked tile = 1,
 * each Chi/Pon = 3, each Kan = 1). Used to enforce "at least 1 unit on grid".
 */
export function countGridUnits(
  tiles: readonly TileInstance[],
  lockedGroups: readonly LockedGroup[],
): number {
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'GRID' && t.lockGroupId === null) {
      count++;
    }
  }
  for (let i = 0; i < lockedGroups.length; i++) {
    count += isKanGroup(lockedGroups[i]) ? 1 : 3;
  }
  return count;
}

/**
 * Builds a 36-element occupancy table for the 6x6 ally grid.
 * Value is tile index in `tiles` (for unlocked tiles or Chi/Pon tiles), or -1 if empty.
 * For Kan (4 tiles sharing 1 cell), stores the first tile's index.
 */
export function buildGridOccupancy(tiles: readonly TileInstance[]): Int16Array {
  const occ = new Int16Array(GRID_ROWS * ALLY_COLS);
  occ.fill(-1);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'GRID' && t.gridPos !== null) {
      const idx = t.gridPos.row * ALLY_COLS + t.gridPos.col;
      if (occ[idx] === -1) {
        occ[idx] = i;
      }
    }
  }
  return occ;
}

export function findFirstEmptyBenchIndex(
  tiles: readonly TileInstance[],
  benchCapacity: number,
): number | null {
  const used = new Uint8Array(benchCapacity);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'BENCH' && t.benchIndex !== null && t.benchIndex < benchCapacity) {
      used[t.benchIndex] = 1;
    }
  }
  for (let b = 0; b < benchCapacity; b++) {
    if (used[b] === 0) return b;
  }
  return null;
}

export function findNearestEmptyGridCell(
  tiles: readonly TileInstance[],
  origin: GridPos,
  forbiddenMask?: Uint8Array,
): GridPos | null {
  const occ = buildGridOccupancy(tiles);
  let bestPos: GridPos | null = null;
  let bestDist = Infinity;

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < ALLY_COLS; c++) {
      const idx = r * ALLY_COLS + c;
      if (occ[idx] !== -1) continue;
      if (forbiddenMask && forbiddenMask[idx] === 1) continue;
      const dist = Math.abs(r - origin.row) + Math.abs(c - origin.col);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = { row: r, col: c };
      }
    }
  }
  return bestPos;
}

/**
 * Finds the nearest available 2x1 vertical (or 1x2 fallback) cells on the 6x6 ally grid
 * closest to the Head slot (left-rear center: row 2..3, col 0).
 * Used when Chiitoitsu or Kokushi Musou deploys Head tiles onto the battlefield at combat start.
 */
export function findHeadDeployPositions(occupiedCells: Uint8Array): [GridPos, GridPos] {
  // Prioritize vertical 2x1 closest to (row 2.5, col 0)
  let bestPair: [GridPos, GridPos] | null = null;
  let bestScore = Infinity;

  for (let c = 0; c < ALLY_COLS; c++) {
    for (let r = 0; r < GRID_ROWS - 1; r++) {
      const idx1 = r * ALLY_COLS + c;
      const idx2 = (r + 1) * ALLY_COLS + c;
      if (occupiedCells[idx1] === 0 && occupiedCells[idx2] === 0) {
        const centerDist = c * 10 + Math.abs(r + 0.5 - 2.5);
        if (centerDist < bestScore) {
          bestScore = centerDist;
          bestPair = [
            { row: r, col: c },
            { row: r + 1, col: c },
          ];
        }
      }
    }
  }
  if (bestPair) return bestPair;

  // Fallback: horizontal 1x2
  for (let c = 0; c < ALLY_COLS - 1; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      const idx1 = r * ALLY_COLS + c;
      const idx2 = r * ALLY_COLS + (c + 1);
      if (occupiedCells[idx1] === 0 && occupiedCells[idx2] === 0) {
        return [
          { row: r, col: c },
          { row: r, col: c + 1 },
        ];
      }
    }
  }

  // Final fallback: any 2 closest empty cells
  const empties: GridPos[] = [];
  for (let c = 0; c < ALLY_COLS && empties.length < 2; c++) {
    for (let r = 0; r < GRID_ROWS && empties.length < 2; r++) {
      if (occupiedCells[r * ALLY_COLS + c] === 0) {
        empties.push({ row: r, col: c });
      }
    }
  }
  return [empties[0] ?? { row: 2, col: 0 }, empties[1] ?? { row: 3, col: 0 }];
}

/**
 * Syncs tile gridPos for all members of a locked group from its anchorGridPos & orientation.
 */
export function syncLockedGroupPositions(
  tiles: TileInstance[],
  group: LockedGroup,
): void {
  const cells = getLockedGroupCells(group);
  const tileMap = new Map<string, TileInstance>();
  for (let i = 0; i < tiles.length; i++) {
    tileMap.set(tiles[i].id, tiles[i]);
  }
  for (let i = 0; i < group.tileIds.length; i++) {
    const t = tileMap.get(group.tileIds[i]);
    if (!t) continue;
    const pos = isKanGroup(group) ? cells[0] : cells[i];
    t.location = 'GRID';
    t.gridPos = { row: pos.row, col: pos.col };
    t.benchIndex = null;
    t.headIndex = null;
    t.lockGroupId = group.groupId;
  }
}

/**
 * Moves a locked group (1x3 / 3x1 for Chi/Pon, 1x1 for Kan) to a new anchor & orientation.
 * Displaces unlocked tiles occupying target cells into vacated cells (or nearest empty cell).
 * Returns false if out of bounds or collides with another locked group.
 */
export function moveLockedGroup(
  tiles: TileInstance[],
  lockedGroups: LockedGroup[],
  groupId: string,
  newAnchor: GridPos,
  newOrientation?: Orientation,
): boolean {
  const group = lockedGroups.find((g) => g.groupId === groupId);
  if (!group) return false;

  const orientation = newOrientation ?? group.orientation;
  const candidate: LockedGroup = {
    ...group,
    anchorGridPos: { row: newAnchor.row, col: newAnchor.col },
    orientation,
  };
  const newCells = getLockedGroupCells(candidate);
  for (let i = 0; i < newCells.length; i++) {
    if (!isValidAllyPos(newCells[i])) return false;
  }

  // Check collision with any OTHER locked group
  const newCellSet = new Uint8Array(GRID_ROWS * ALLY_COLS);
  for (let i = 0; i < newCells.length; i++) {
    newCellSet[newCells[i].row * ALLY_COLS + newCells[i].col] = 1;
  }

  for (let i = 0; i < lockedGroups.length; i++) {
    const other = lockedGroups[i];
    if (other.groupId === groupId) continue;
    const otherCells = getLockedGroupCells(other);
    for (let j = 0; j < otherCells.length; j++) {
      if (newCellSet[otherCells[j].row * ALLY_COLS + otherCells[j].col] === 1) {
        return false;
      }
    }
  }

  const oldCells = getLockedGroupCells(group);
  const vacatedCells: GridPos[] = oldCells.filter(
    (c) => newCellSet[c.row * ALLY_COLS + c.col] === 0,
  );

  // Collect unlocked tiles currently sitting on newCells
  const displaced: TileInstance[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'GRID' && t.lockGroupId === null && t.gridPos !== null) {
      if (newCellSet[t.gridPos.row * ALLY_COLS + t.gridPos.col] === 1) {
        displaced.push(t);
      }
    }
  }

  // Commit group anchor & orientation
  group.anchorGridPos = { row: newAnchor.row, col: newAnchor.col };
  group.orientation = orientation;
  syncLockedGroupPositions(tiles, group);

  // Place displaced tiles into vacated cells first, then nearest empty cell
  for (let i = 0; i < displaced.length; i++) {
    const t = displaced[i];
    if (vacatedCells.length > 0) {
      const dest = vacatedCells.shift()!;
      t.gridPos = { row: dest.row, col: dest.col };
    } else {
      const dest = findNearestEmptyGridCell(tiles, t.gridPos ?? newAnchor, newCellSet);
      if (dest) {
        t.gridPos = dest;
      }
    }
  }

  return true;
}

/**
 * Rotates a Chi/Pon locked group between HORIZONTAL and VERTICAL.
 * Tries rotating around its anchor first; if out of bounds, shifts anchor inward.
 */
export function rotateLockedGroup(
  tiles: TileInstance[],
  lockedGroups: LockedGroup[],
  groupId: string,
): boolean {
  const group = lockedGroups.find((g) => g.groupId === groupId);
  if (!group || isKanGroup(group)) return false;

  const targetOrient: Orientation =
    group.orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
  const { row, col } = group.anchorGridPos;

  const candidates: GridPos[] =
    targetOrient === 'HORIZONTAL'
      ? [
          { row, col },
          { row, col: Math.max(0, Math.min(ALLY_COLS - 3, col)) },
          { row, col: col - 1 },
          { row, col: col - 2 },
        ]
      : [
          { row, col },
          { row: Math.max(0, Math.min(GRID_ROWS - 3, row)), col },
          { row: row - 1, col },
          { row: row - 2, col },
        ];

  for (let i = 0; i < candidates.length; i++) {
    if (moveLockedGroup(tiles, lockedGroups, groupId, candidates[i], targetOrient)) {
      return true;
    }
  }
  return false;
}

/**
 * Finds a 3-cell straight line (HORIZONTAL or VERTICAL) on the 6x6 ally grid for a new Furo group.
 * Prefers completely empty lines; if none exist, selects a line without locked groups and
 * pushes unlocked tiles out to nearest empty grid cells (or bench if grid is full).
 */
export function allocateLineForFuro(
  tiles: TileInstance[],
  lockedGroups: readonly LockedGroup[],
  consumedTileIds: ReadonlySet<string>,
  benchCapacity: number,
): { anchor: GridPos; orientation: Orientation } | null {
  // Build mask of locked cells (excluding consumed tiles, though locked tiles aren't consumed by Chi/Pon)
  const lockedMask = new Uint8Array(GRID_ROWS * ALLY_COLS);
  for (let i = 0; i < lockedGroups.length; i++) {
    const cells = getLockedGroupCells(lockedGroups[i]);
    for (let j = 0; j < cells.length; j++) {
      lockedMask[cells[j].row * ALLY_COLS + cells[j].col] = 1;
    }
  }

  const unlockedGridMap = new Map<number, TileInstance>();
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (
      t.location === 'GRID' &&
      t.lockGroupId === null &&
      t.gridPos !== null &&
      !consumedTileIds.has(t.id)
    ) {
      unlockedGridMap.set(t.gridPos.row * ALLY_COLS + t.gridPos.col, t);
    }
  }

  let best: { anchor: GridPos; orientation: Orientation; blockedCount: number } | null = null;

  const evalLine = (anchor: GridPos, orientation: Orientation) => {
    let blocked = 0;
    for (let k = 0; k < 3; k++) {
      const r = orientation === 'VERTICAL' ? anchor.row + k : anchor.row;
      const c = orientation === 'HORIZONTAL' ? anchor.col + k : anchor.col;
      const idx = r * ALLY_COLS + c;
      if (lockedMask[idx] === 1) return;
      if (unlockedGridMap.has(idx)) blocked++;
    }
    if (best === null || blocked < best.blockedCount) {
      best = { anchor, orientation, blockedCount: blocked };
    }
  };

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c <= ALLY_COLS - 3; c++) {
      evalLine({ row: r, col: c }, 'HORIZONTAL');
    }
  }
  for (let r = 0; r <= GRID_ROWS - 3; r++) {
    for (let c = 0; c < ALLY_COLS; c++) {
      evalLine({ row: r, col: c }, 'VERTICAL');
    }
  }

  if (!best) return null;
  const chosen: { anchor: GridPos; orientation: Orientation; blockedCount: number } = best;

  // Push any unlocked tiles on the chosen line aside
  if (chosen.blockedCount > 0) {
    const forbidden = new Uint8Array(GRID_ROWS * ALLY_COLS);
    const toPush: TileInstance[] = [];
    for (let k = 0; k < 3; k++) {
      const r = chosen.orientation === 'VERTICAL' ? chosen.anchor.row + k : chosen.anchor.row;
      const c = chosen.orientation === 'HORIZONTAL' ? chosen.anchor.col + k : chosen.anchor.col;
      const idx = r * ALLY_COLS + c;
      forbidden[idx] = 1;
      const occupant = unlockedGridMap.get(idx);
      if (occupant) toPush.push(occupant);
    }

    for (let i = 0; i < toPush.length; i++) {
      const t = toPush[i];
      const nextPos = findNearestEmptyGridCell(tiles, t.gridPos ?? chosen.anchor, forbidden);
      if (nextPos) {
        t.gridPos = nextPos;
      } else {
        const bIdx = findFirstEmptyBenchIndex(tiles, benchCapacity);
        if (bIdx !== null) {
          t.location = 'BENCH';
          t.gridPos = null;
          t.benchIndex = bIdx;
        }
      }
    }
  }

  return { anchor: chosen.anchor, orientation: chosen.orientation };
}

/**
 * Checks if moving an unlocked tile from its current location to GRID would respect the 12 logical slot limit.
 */
export function canAddUnlockedTileToGrid(
  tiles: readonly TileInstance[],
  lockedGroups: readonly LockedGroup[],
): boolean {
  return countLogicalGridTiles(tiles, lockedGroups) < MAX_GRID_LOGICAL_TILES;
}

/**
 * Moves or swaps an unlocked tile to a target grid cell.
 * Enforces: 12 logical tile cap (swapping with existing grid tile is always allowed),
 * Head-pair integrity (moving a Head tile out relocates its partner or swaps pairs),
 * and minimum 1 unit on Grid.
 */
export function moveTileToGrid(
  tiles: TileInstance[],
  lockedGroups: readonly LockedGroup[],
  tileId: string,
  targetPos: GridPos,
  benchCapacity: number,
): boolean {
  if (!isValidAllyPos(targetPos)) return false;
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile || tile.lockGroupId !== null) return false;

  const occupant = tiles.find(
    (t) =>
      t.location === 'GRID' &&
      t.gridPos !== null &&
      t.gridPos.row === targetPos.row &&
      t.gridPos.col === targetPos.col,
  );

  // Cannot swap directly onto a locked group cell (user should move the locked group instead)
  if (occupant && occupant.lockGroupId !== null) return false;
  if (occupant && occupant.id === tile.id) return true;

  // Case 1: GRID -> GRID (move or swap)
  if (tile.location === 'GRID') {
    const oldPos = tile.gridPos!;
    if (occupant) {
      occupant.gridPos = { row: oldPos.row, col: oldPos.col };
    }
    tile.gridPos = { row: targetPos.row, col: targetPos.col };
    return true;
  }

  // Case 2: BENCH -> GRID
  if (tile.location === 'BENCH') {
    const oldBenchIdx = tile.benchIndex!;
    if (occupant) {
      // Swap BENCH <-> GRID (net logical grid tiles unchanged)
      occupant.location = 'BENCH';
      occupant.gridPos = null;
      occupant.benchIndex = oldBenchIdx;
      tile.location = 'GRID';
      tile.benchIndex = null;
      tile.gridPos = { row: targetPos.row, col: targetPos.col };
      return true;
    }
    if (!canAddUnlockedTileToGrid(tiles, lockedGroups)) return false;
    tile.location = 'GRID';
    tile.benchIndex = null;
    tile.gridPos = { row: targetPos.row, col: targetPos.col };
    return true;
  }

  // Case 3: HEAD -> GRID (Head must stay empty or a valid pair; move partner out too!)
  if (tile.location === 'HEAD') {
    const partner = tiles.find((t) => t.location === 'HEAD' && t.id !== tile.id);
    if (!partner) {
      if (occupant) return false;
      if (!canAddUnlockedTileToGrid(tiles, lockedGroups)) return false;
      tile.location = 'GRID';
      tile.headIndex = null;
      tile.gridPos = { row: targetPos.row, col: targetPos.col };
      return true;
    }
    // If dropping onto an empty grid cell, need space for 2 (or 1 grid + 1 bench)
    if (!occupant) {
      const logical = countLogicalGridTiles(tiles, lockedGroups);
      if (logical + 2 <= MAX_GRID_LOGICAL_TILES) {
        tile.location = 'GRID';
        tile.headIndex = null;
        tile.gridPos = { row: targetPos.row, col: targetPos.col };
        const partnerPos = findNearestEmptyGridCell(tiles, targetPos);
        if (partnerPos) {
          partner.location = 'GRID';
          partner.headIndex = null;
          partner.gridPos = partnerPos;
          return true;
        }
      }
      if (logical + 1 <= MAX_GRID_LOGICAL_TILES) {
        const bIdx = findFirstEmptyBenchIndex(tiles, benchCapacity);
        if (bIdx !== null) {
          tile.location = 'GRID';
          tile.headIndex = null;
          tile.gridPos = { row: targetPos.row, col: targetPos.col };
          partner.location = 'BENCH';
          partner.headIndex = null;
          partner.benchIndex = bIdx;
          return true;
        }
      }
      return false;
    }

    // Swapping Head pair with a matching pair on grid/bench if occupant has an unlocked twin
    const occTwin = tiles.find(
      (t) =>
        t.id !== occupant.id &&
        t.code === occupant.code &&
        t.lockGroupId === null &&
        t.location !== 'HEAD',
    );
    if (occTwin) {
      const occPos = occupant.gridPos!;
      const twinLoc = occTwin.location;
      const twinPos = occTwin.gridPos;
      const twinBench = occTwin.benchIndex;

      occupant.location = 'HEAD';
      occupant.gridPos = null;
      occupant.headIndex = 0;
      occTwin.location = 'HEAD';
      occTwin.gridPos = null;
      occTwin.benchIndex = null;
      occTwin.headIndex = 1;

      tile.location = 'GRID';
      tile.headIndex = null;
      tile.gridPos = { row: occPos.row, col: occPos.col };

      partner.location = twinLoc;
      partner.headIndex = null;
      partner.gridPos = twinPos ? { row: twinPos.row, col: twinPos.col } : null;
      partner.benchIndex = twinBench;
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Moves or swaps an unlocked tile to a specific bench slot.
 */
export function moveTileToBench(
  tiles: TileInstance[],
  lockedGroups: readonly LockedGroup[],
  tileId: string,
  targetBenchIdx: number,
  benchCapacity: number,
): boolean {
  if (targetBenchIdx < 0 || targetBenchIdx >= benchCapacity) return false;
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile || tile.lockGroupId !== null) return false;

  const occupant = tiles.find(
    (t) => t.location === 'BENCH' && t.benchIndex === targetBenchIdx,
  );
  if (occupant && occupant.id === tile.id) return true;

  if (tile.location === 'BENCH') {
    const oldIdx = tile.benchIndex!;
    if (occupant) {
      occupant.benchIndex = oldIdx;
    }
    tile.benchIndex = targetBenchIdx;
    return true;
  }

  if (tile.location === 'GRID') {
    if (!occupant) {
      // Removing from grid: must keep at least 1 unit on grid!
      if (countGridUnits(tiles, lockedGroups) <= 1) return false;
      tile.location = 'BENCH';
      tile.gridPos = null;
      tile.benchIndex = targetBenchIdx;
      return true;
    }
    // Swap GRID <-> BENCH
    const oldPos = tile.gridPos!;
    occupant.location = 'GRID';
    occupant.benchIndex = null;
    occupant.gridPos = { row: oldPos.row, col: oldPos.col };
    tile.location = 'BENCH';
    tile.gridPos = null;
    tile.benchIndex = targetBenchIdx;
    return true;
  }

  if (tile.location === 'HEAD') {
    const partner = tiles.find((t) => t.location === 'HEAD' && t.id !== tile.id);
    if (!occupant) {
      if (!partner) {
        tile.location = 'BENCH';
        tile.headIndex = null;
        tile.benchIndex = targetBenchIdx;
        return true;
      }
      // Need another empty bench slot for partner
      tile.location = 'BENCH';
      tile.headIndex = null;
      tile.benchIndex = targetBenchIdx;
      const secondIdx = findFirstEmptyBenchIndex(tiles, benchCapacity);
      if (secondIdx !== null) {
        partner.location = 'BENCH';
        partner.headIndex = null;
        partner.benchIndex = secondIdx;
        return true;
      }
      // Rollback if no second slot
      tile.location = 'HEAD';
      tile.benchIndex = null;
      tile.headIndex = 0;
      return false;
    }
    // Swap Head pair with occupant + twin if available
    const occTwin = tiles.find(
      (t) =>
        t.id !== occupant.id &&
        t.code === occupant.code &&
        t.lockGroupId === null &&
        t.location !== 'HEAD',
    );
    if (occTwin && partner) {
      const twinLoc = occTwin.location;
      const twinPos = occTwin.gridPos;
      const twinBench = occTwin.benchIndex;

      occupant.location = 'HEAD';
      occupant.benchIndex = null;
      occupant.headIndex = 0;
      occTwin.location = 'HEAD';
      occTwin.gridPos = null;
      occTwin.benchIndex = null;
      occTwin.headIndex = 1;

      tile.location = 'BENCH';
      tile.headIndex = null;
      tile.benchIndex = targetBenchIdx;

      partner.location = twinLoc;
      partner.headIndex = null;
      partner.gridPos = twinPos ? { row: twinPos.row, col: twinPos.col } : null;
      partner.benchIndex = twinBench;
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Moves an unlocked tile (plus a matching unlocked twin) into the Head slot (Toitsu only).
 * If Head already holds a pair, swaps the two pairs atomically!
 * Ensures the combat grid keeps at least 1 unit.
 */
export function movePairToHead(
  tiles: TileInstance[],
  lockedGroups: readonly LockedGroup[],
  tileId: string,
): boolean {
  const tile = tiles.find((t) => t.id === tileId);
  if (!tile || tile.lockGroupId !== null || tile.location === 'HEAD') return false;

  const twin = tiles.find(
    (t) =>
      t.id !== tile.id &&
      t.code === tile.code &&
      t.lockGroupId === null &&
      t.location !== 'HEAD',
  );
  if (!twin) return false;

  const existingHead = tiles.filter((t) => t.location === 'HEAD');

  if (existingHead.length === 0) {
    // Check min 1 unit on grid after removing tile & twin
    let removedFromGrid = 0;
    if (tile.location === 'GRID') removedFromGrid++;
    if (twin.location === 'GRID') removedFromGrid++;
    if (countGridUnits(tiles, lockedGroups) - removedFromGrid < 1) return false;

    tile.location = 'HEAD';
    tile.gridPos = null;
    tile.benchIndex = null;
    tile.headIndex = 0;

    twin.location = 'HEAD';
    twin.gridPos = null;
    twin.benchIndex = null;
    twin.headIndex = 1;
    return true;
  }

  if (existingHead.length === 2) {
    const [h0, h1] = existingHead;
    const t0Loc = tile.location;
    const t0Pos = tile.gridPos ? { ...tile.gridPos } : null;
    const t0Bench = tile.benchIndex;

    const t1Loc = twin.location;
    const t1Pos = twin.gridPos ? { ...twin.gridPos } : null;
    const t1Bench = twin.benchIndex;

    tile.location = 'HEAD';
    tile.gridPos = null;
    tile.benchIndex = null;
    tile.headIndex = 0;

    twin.location = 'HEAD';
    twin.gridPos = null;
    twin.benchIndex = null;
    twin.headIndex = 1;

    h0.location = t0Loc;
    h0.headIndex = null;
    h0.gridPos = t0Pos;
    h0.benchIndex = t0Bench;

    h1.location = t1Loc;
    h1.headIndex = null;
    h1.gridPos = t1Pos;
    h1.benchIndex = t1Bench;
    return true;
  }

  return false;
}
