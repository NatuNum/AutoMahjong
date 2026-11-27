import { TOTAL_TILE_TYPES, isSuupai, suitOfCode } from '../config/tiles';
import type {
  FuroCandidate,
  KanCandidate,
  LockedGroup,
  TileCode,
  TileInstance,
} from './types';

/**
 * Scans all unlocked tiles across BENCH, GRID, and HEAD (as specified) to find
 * all valid CHI, PON, and MINKAN candidates against the 3 system discards.
 * All 3 discards are eligible for CHI. Multiple CHI combinations are returned separately.
 */
export function detectFuroCandidates(
  tiles: readonly TileInstance[],
  discards: readonly TileCode[],
): FuroCandidate[] {
  // Group unlocked tiles by code, prioritizing BENCH > GRID > HEAD when picking materials
  const byCode: TileInstance[][] = Array.from({ length: TOTAL_TILE_TYPES }, () => []);
  const locWeight = (loc: TileInstance['location']): number =>
    loc === 'BENCH' ? 0 : loc === 'GRID' ? 1 : 2;

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.lockGroupId === null) {
      byCode[t.code].push(t);
    }
  }
  for (let c = 0; c < TOTAL_TILE_TYPES; c++) {
    if (byCode[c].length > 1) {
      byCode[c].sort((a, b) => locWeight(a.location) - locWeight(b.location));
    }
  }

  const candidates: FuroCandidate[] = [];

  for (let dIdx = 0; dIdx < discards.length; dIdx++) {
    const dCode = discards[dIdx];
    const sameList = byCode[dCode];

    // MINKAN (3 identical unlocked tiles + discard)
    if (sameList.length >= 3) {
      candidates.push({
        id: `minkan_${dIdx}_${dCode}`,
        discardIndex: dIdx,
        discardCode: dCode,
        type: 'MINKAN',
        materialTileIds: [sameList[0].id, sameList[1].id, sameList[2].id],
        resultCodes: [dCode, dCode, dCode, dCode],
      });
    }

    // PON (2 identical unlocked tiles + discard)
    if (sameList.length >= 2) {
      candidates.push({
        id: `pon_${dIdx}_${dCode}`,
        discardIndex: dIdx,
        discardCode: dCode,
        type: 'PON',
        materialTileIds: [sameList[0].id, sameList[1].id],
        resultCodes: [dCode, dCode, dCode],
      });
    }

    // CHI (all 3 patterns: [d-2, d-1, d], [d-1, d, d+1], [d, d+1, d+2])
    if (isSuupai(dCode)) {
      const suit = suitOfCode(dCode);
      const patterns: [number, number][] = [
        [dCode - 2, dCode - 1],
        [dCode - 1, dCode + 1],
        [dCode + 1, dCode + 2],
      ];
      for (let p = 0; p < patterns.length; p++) {
        const [a, b] = patterns[p];
        if (
          isSuupai(a) &&
          isSuupai(b) &&
          suitOfCode(a) === suit &&
          suitOfCode(b) === suit &&
          byCode[a].length > 0 &&
          byCode[b].length > 0
        ) {
          const sorted = [a, b, dCode].sort((x, y) => x - y);
          candidates.push({
            id: `chi_${dIdx}_${sorted[0]}_${sorted[1]}_${sorted[2]}`,
            discardIndex: dIdx,
            discardCode: dCode,
            type: 'CHI',
            materialTileIds: [byCode[a][0].id, byCode[b][0].id],
            resultCodes: sorted,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Detects available ANKAN (4 identical unlocked tiles including optional currentTsumo)
 * and KAKAN (existing PON lockedGroup + 1 matching unlocked tile or currentTsumo).
 * Only called during DRAW_LOOP (TSUMO subphase); POST_SHOP_PREP never allows Kan.
 */
export function detectSelfKanCandidates(
  tiles: readonly TileInstance[],
  lockedGroups: readonly LockedGroup[],
  currentTsumo: TileInstance | null,
): KanCandidate[] {
  const byCode: TileInstance[][] = Array.from({ length: TOTAL_TILE_TYPES }, () => []);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.lockGroupId === null) {
      byCode[t.code].push(t);
    }
  }
  if (currentTsumo !== null) {
    byCode[currentTsumo.code].push(currentTsumo);
  }

  const results: KanCandidate[] = [];

  // ANKAN
  for (let code = 0; code < TOTAL_TILE_TYPES; code++) {
    if (byCode[code].length >= 4) {
      const selected = byCode[code].slice(0, 4);
      const usesCurrentTsumo =
        currentTsumo !== null && selected.some((t) => t.id === currentTsumo.id);
      results.push({
        type: 'ANKAN',
        tileCode: code,
        tileIds: selected.map((t) => t.id),
        usesCurrentTsumo,
      });
    }
  }

  // KAKAN (upgrade existing PON to KAKAN)
  for (let i = 0; i < lockedGroups.length; i++) {
    const lg = lockedGroups[i];
    if (lg.type !== 'PON') continue;
    const code = lg.tileCodes[0];
    if (byCode[code].length > 0) {
      // Prefer currentTsumo if matching, else bench > grid > head
      const matching =
        currentTsumo && currentTsumo.code === code ? currentTsumo : byCode[code][0];
      results.push({
        type: 'KAKAN',
        tileCode: code,
        tileIds: [matching.id],
        targetLockGroupId: lg.groupId,
        usesCurrentTsumo: currentTsumo !== null && matching.id === currentTsumo.id,
      });
    }
  }

  return results;
}
