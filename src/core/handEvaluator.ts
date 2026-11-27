import {
  ALLY_COLS,
  GRID_ROWS,
  HEAD_AURA_NORMAL_BONUS,
  HEAD_AURA_YAKUHAI_BONUS,
  YAKU_CATEGORY_BUFFS,
} from '../config/stats';
import {
  DRAGON_CODES,
  TILE_META,
  TOTAL_TILE_TYPES,
  WIND_CODES,
  isSuupai,
  suitOfCode,
} from '../config/tiles';
import type {
  ActiveYaku,
  ActiveYakuman,
  ComputedStatModifiers,
  EvaluatedGroup,
  LockedGroup,
  Orientation,
  PermanentBuffs,
  TileCode,
  TileInstance,
  WindCode,
  YakuEvaluation,
} from './types';

interface LineCandidate {
  kind: 'SHUNTSU' | 'KOUTSU' | 'TOITSU';
  tileIds: string[];
  tileCodes: TileCode[];
  orientation: Orientation;
  loMask: number; // bits 0..31
  hiMask: number; // bits 32..35
}

const ORPHAN_CODES: readonly TileCode[] = [
  0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33,
];

function setBit(cellIdx: number): [number, number] {
  if (cellIdx < 32) return [(1 << cellIdx) >>> 0, 0];
  return [0, (1 << (cellIdx - 32)) >>> 0];
}

function isYakuhaiCode(code: TileCode, roundWind: WindCode, seatWind: WindCode): boolean {
  return code >= 31 || code === roundWind || code === seatWind;
}

function isTerminalCode(code: TileCode): boolean {
  return TILE_META[code].isTerminal;
}

function isHonorCode(code: TileCode): boolean {
  return TILE_META[code].isHonor;
}

function isTerminalOrHonorCode(code: TileCode): boolean {
  return TILE_META[code].isTerminalOrHonor;
}

function isMentsuKind(kind: EvaluatedGroup['kind']): boolean {
  return (
    kind === 'SHUNTSU' ||
    kind === 'KOUTSU' ||
    kind === 'ANKAN' ||
    kind === 'MINKAN' ||
    kind === 'KAKAN'
  );
}

function isTripletOrKanKind(kind: EvaluatedGroup['kind']): boolean {
  return kind === 'KOUTSU' || kind === 'ANKAN' || kind === 'MINKAN' || kind === 'KAKAN';
}

function isKanKind(kind: EvaluatedGroup['kind']): boolean {
  return kind === 'ANKAN' || kind === 'MINKAN' || kind === 'KAKAN';
}

function extractLineCandidates(unlockedGridTiles: readonly TileInstance[]): LineCandidate[] {
  const cellToTile = new Array<TileInstance | null>(GRID_ROWS * ALLY_COLS).fill(null);
  for (let i = 0; i < unlockedGridTiles.length; i++) {
    const t = unlockedGridTiles[i];
    if (t.gridPos !== null) {
      cellToTile[t.gridPos.row * ALLY_COLS + t.gridPos.col] = t;
    }
  }

  const candidates: LineCandidate[] = [];

  const tryMentsu = (t0: TileInstance, t1: TileInstance, t2: TileInstance, i0: number, i1: number, i2: number, orientation: Orientation) => {
    const c0 = t0.code;
    const c1 = t1.code;
    const c2 = t2.code;
    const [lo0, hi0] = setBit(i0);
    const [lo1, hi1] = setBit(i1);
    const [lo2, hi2] = setBit(i2);
    const loMask = (lo0 | lo1 | lo2) >>> 0;
    const hiMask = (hi0 | hi1 | hi2) >>> 0;

    if (c0 === c1 && c1 === c2) {
      candidates.push({
        kind: 'KOUTSU',
        tileIds: [t0.id, t1.id, t2.id],
        tileCodes: [c0, c1, c2],
        orientation,
        loMask,
        hiMask,
      });
      return;
    }

    if (isSuupai(c0) && isSuupai(c1) && isSuupai(c2)) {
      const s0 = suitOfCode(c0);
      if (s0 === suitOfCode(c1) && s0 === suitOfCode(c2)) {
        // Sort 3 codes without allocating array via simple min/mid/max
        let a = c0;
        let b = c1;
        let c = c2;
        if (a > b) { const tmp = a; a = b; b = tmp; }
        if (b > c) { const tmp = b; b = c; c = tmp; }
        if (a > b) { const tmp = a; a = b; b = tmp; }
        if (a + 1 === b && b + 1 === c) {
          candidates.push({
            kind: 'SHUNTSU',
            tileIds: [t0.id, t1.id, t2.id],
            tileCodes: [a, b, c],
            orientation,
            loMask,
            hiMask,
          });
        }
      }
    }
  };

  const tryToitsu = (t0: TileInstance, t1: TileInstance, i0: number, i1: number, orientation: Orientation) => {
    if (t0.code !== t1.code) return;
    const [lo0, hi0] = setBit(i0);
    const [lo1, hi1] = setBit(i1);
    candidates.push({
      kind: 'TOITSU',
      tileIds: [t0.id, t1.id],
      tileCodes: [t0.code, t1.code],
      orientation,
      loMask: (lo0 | lo1) >>> 0,
      hiMask: (hi0 | hi1) >>> 0,
    });
  };

  // Horizontal 1x3 mentsu
  for (let r = 0; r < GRID_ROWS; r++) {
    const rowOff = r * ALLY_COLS;
    for (let c = 0; c <= ALLY_COLS - 3; c++) {
      const i0 = rowOff + c;
      const t0 = cellToTile[i0];
      const t1 = cellToTile[i0 + 1];
      const t2 = cellToTile[i0 + 2];
      if (t0 && t1 && t2) {
        tryMentsu(t0, t1, t2, i0, i0 + 1, i0 + 2, 'HORIZONTAL');
      }
    }
  }
  // Vertical 3x1 mentsu
  for (let r = 0; r <= GRID_ROWS - 3; r++) {
    for (let c = 0; c < ALLY_COLS; c++) {
      const i0 = r * ALLY_COLS + c;
      const i1 = i0 + ALLY_COLS;
      const i2 = i1 + ALLY_COLS;
      const t0 = cellToTile[i0];
      const t1 = cellToTile[i1];
      const t2 = cellToTile[i2];
      if (t0 && t1 && t2) {
        tryMentsu(t0, t1, t2, i0, i1, i2, 'VERTICAL');
      }
    }
  }
  // Horizontal 1x2 toitsu
  for (let r = 0; r < GRID_ROWS; r++) {
    const rowOff = r * ALLY_COLS;
    for (let c = 0; c <= ALLY_COLS - 2; c++) {
      const i0 = rowOff + c;
      const t0 = cellToTile[i0];
      const t1 = cellToTile[i0 + 1];
      if (t0 && t1) {
        tryToitsu(t0, t1, i0, i0 + 1, 'HORIZONTAL');
      }
    }
  }
  // Vertical 2x1 toitsu
  for (let r = 0; r <= GRID_ROWS - 2; r++) {
    for (let c = 0; c < ALLY_COLS; c++) {
      const i0 = r * ALLY_COLS + c;
      const i1 = i0 + ALLY_COLS;
      const t0 = cellToTile[i0];
      const t1 = cellToTile[i1];
      if (t0 && t1) {
        tryToitsu(t0, t1, i0, i1, 'VERTICAL');
      }
    }
  }

  return candidates;
}

function checkKokushiMusou(
  isMenzen: boolean,
  lockedCount: number,
  allActiveCodes: readonly TileCode[],
): boolean {
  if (!isMenzen || lockedCount > 0 || allActiveCodes.length !== 14) return false;
  const counts = new Uint8Array(TOTAL_TILE_TYPES);
  for (let i = 0; i < allActiveCodes.length; i++) {
    const c = allActiveCodes[i];
    if (!isTerminalOrHonorCode(c)) return false;
    counts[c]++;
  }
  for (let i = 0; i < ORPHAN_CODES.length; i++) {
    if (counts[ORPHAN_CODES[i]] < 1) return false;
  }
  return true;
}

function checkChuurenPoutou(
  isMenzen: boolean,
  lockedCount: number,
  allActiveCodes: readonly TileCode[],
): boolean {
  if (!isMenzen || lockedCount > 0 || allActiveCodes.length !== 14) return false;
  const firstCode = allActiveCodes[0];
  if (!isSuupai(firstCode)) return false;
  const suit = suitOfCode(firstCode);
  const rankCounts = new Uint8Array(9);
  const base = suit === 'MAN' ? 0 : suit === 'PIN' ? 9 : 18;
  for (let i = 0; i < allActiveCodes.length; i++) {
    const c = allActiveCodes[i];
    if (c < base || c >= base + 9) return false;
    rankCounts[c - base]++;
  }
  if (rankCounts[0] < 3 || rankCounts[8] < 3) return false;
  for (let r = 1; r <= 7; r++) {
    if (rankCounts[r] < 1) return false;
  }
  return true;
}

interface PartitionScore {
  yakuman: ActiveYakuman[];
  normalYaku: ActiveYaku[];
  totalHan: number;
  mentsuCount: number;
  koutsuOrKanCount: number;
  toitsuCount: number;
  deployHeadTiles: boolean;
}

function scorePartition(
  groups: readonly EvaluatedGroup[],
  headTileCodes: readonly TileCode[],
  headIsValidPair: boolean,
  allActiveCodes: readonly TileCode[],
  isMenzen: boolean,
  lockedGroupsCount: number,
  roundWind: WindCode,
  seatWind: WindCode,
  doraCount: number,
): PartitionScore {
  const mentsuGroups: EvaluatedGroup[] = [];
  const shuntsuGroups: EvaluatedGroup[] = [];
  const tripletGroups: EvaluatedGroup[] = [];
  const kanGroups: EvaluatedGroup[] = [];
  const toitsuGroups: EvaluatedGroup[] = [];
  let isolatedCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (isMentsuKind(g.kind)) {
      mentsuGroups.push(g);
      if (g.kind === 'SHUNTSU') shuntsuGroups.push(g);
      if (isTripletOrKanKind(g.kind)) tripletGroups.push(g);
      if (isKanKind(g.kind)) kanGroups.push(g);
    } else if (g.kind === 'TOITSU') {
      toitsuGroups.push(g);
    } else {
      isolatedCount++;
    }
  }

  const has4Mentsu1Head =
    mentsuGroups.length === 4 &&
    headIsValidPair &&
    toitsuGroups.length === 0 &&
    isolatedCount === 0;

  let isChiitoitsu = false;
  if (
    isMenzen &&
    lockedGroupsCount === 0 &&
    headIsValidPair &&
    toitsuGroups.length === 6 &&
    mentsuGroups.length === 0 &&
    isolatedCount === 0
  ) {
    const pairCodeSet = new Set<TileCode>([headTileCodes[0]]);
    for (let i = 0; i < toitsuGroups.length; i++) {
      pairCodeSet.add(toitsuGroups[i].tileCodes[0]);
    }
    isChiitoitsu = pairCodeSet.size === 7;
  }

  const headCode = headIsValidPair ? headTileCodes[0] : -1;

  // --- Check Yakuman (stackable!) ---
  const yakuman: ActiveYakuman[] = [];
  let deployHeadTiles = isChiitoitsu;

  if (checkKokushiMusou(isMenzen, lockedGroupsCount, allActiveCodes)) {
    yakuman.push({
      id: 'KOKUSHI_MUSOU',
      name: '국사무쌍',
      description: '14패 올스탯 2.5배 각성 + 시작 즉시 일제 사격',
    });
    deployHeadTiles = true;
  }

  if (checkChuurenPoutou(isMenzen, lockedGroupsCount, allActiveCodes)) {
    yakuman.push({
      id: 'CHUUREN_POUTOU',
      name: '구련보등',
      description: '5초 무적 + 1.5초마다 전 행 관통 황금 광선 포격',
    });
  }

  // Triplet code set
  const tripletCodes = new Uint8Array(TOTAL_TILE_TYPES);
  let concealedTripletCount = 0;
  for (let i = 0; i < tripletGroups.length; i++) {
    const g = tripletGroups[i];
    tripletCodes[g.tileCodes[0]]++;
    if (g.isMenzen) concealedTripletCount++;
  }

  if (tripletCodes[31] > 0 && tripletCodes[32] > 0 && tripletCodes[33] > 0) {
    yakuman.push({
      id: 'DAISANGEN',
      name: '대삼원',
      description: '5초마다 적 빙결 → 아군 전회복 → 대규모 화염 연쇄',
    });
  }

  if (isMenzen && concealedTripletCount === 4 && headIsValidPair) {
    yakuman.push({
      id: 'SUUANKOU',
      name: '스안커',
      description: '전 유닛 거대화 + 최대HP 200% 보호막 + 3×3 광역 충격파',
    });
  }

  if (kanGroups.length === 4 && headIsValidPair) {
    yakuman.push({
      id: 'SUUKANTSU',
      name: '스깡쯔',
      description: '깡 4기 올스탯 3배 + 공격 시 적 전체 지진 및 기절',
    });
  }

  let windTriplets = 0;
  for (let i = 0; i < WIND_CODES.length; i++) {
    if (tripletCodes[WIND_CODES[i]] > 0) windTriplets++;
  }
  if (windTriplets === 4) {
    yakuman.push({
      id: 'DAISUUSHII',
      name: '대사희',
      description: '공속 상한 해제(+250%) + 적 이동·공속 60% 영구 둔화',
    });
  } else if (windTriplets === 3 && headCode >= 27 && headCode <= 30) {
    yakuman.push({
      id: 'SHOUSUUSHII',
      name: '소사희',
      description: '공속 상한 해제(+150%) + 적 이동·공속 40% 영구 둔화',
    });
  }

  const hasCompleteStructure = has4Mentsu1Head || isChiitoitsu;
  if (hasCompleteStructure && allActiveCodes.length > 0) {
    let allHonors = true;
    let allTerminals = true;
    let allGreen = true;
    for (let i = 0; i < allActiveCodes.length; i++) {
      const c = allActiveCodes[i];
      if (!isHonorCode(c)) allHonors = false;
      if (!isTerminalCode(c)) allTerminals = false;
      if (!TILE_META[c].isGreen) allGreen = false;
    }
    if (allHonors) {
      yakuman.push({
        id: 'TSUUIISOU',
        name: '자일색',
        description: '받는 피해 60% 감소 + 매초 무작위 적 3명 연쇄 번개',
      });
    }
    if (allTerminals && has4Mentsu1Head) {
      yakuman.push({
        id: 'CHINROUTOU',
        name: '청노두',
        description: '아군 최대 체력 3배 + 피격 시 받은 피해 150% 반사',
      });
    }
    if (allGreen && has4Mentsu1Head) {
      yakuman.push({
        id: 'RYUUIISOU',
        name: '녹일색',
        description: '전장 맹독 안개(적 매초 6% 피해) + 아군 피해량 40% 흡혈',
      });
    }
  }

  if (yakuman.length > 0) {
    return {
      yakuman,
      normalYaku: [],
      totalHan: 13 * yakuman.length,
      mentsuCount: mentsuGroups.length,
      koutsuOrKanCount: tripletGroups.length,
      toitsuCount: toitsuGroups.length,
      deployHeadTiles,
    };
  }

  // --- Normal Yaku Evaluation ---
  const normalYaku: ActiveYaku[] = [];
  const addYaku = (
    id: string,
    name: string,
    menzenHan: number | null,
    openHan: number | null,
    category: ActiveYaku['category'],
    description: string,
    targetTileCode?: TileCode,
  ) => {
    const han = isMenzen ? menzenHan : openHan;
    if (han === null || han <= 0) return;
    normalYaku.push({ id, name, han, category, description, targetTileCode });
  };

  // 1. Yakuhai (triggers whenever the triplet/kan exists)
  if (tripletCodes[31] > 0) {
    addYaku('YAKUHAI_HAKU', '역패: 백', 1, 1, 'YAKUHAI', '백 유닛 올스탯 +35%, 아군 공격력 +6%', 31);
  }
  if (tripletCodes[32] > 0) {
    addYaku('YAKUHAI_HATSU', '역패: 발', 1, 1, 'YAKUHAI', '발 유닛 올스탯 +35%, 아군 공격력 +6%', 32);
  }
  if (tripletCodes[33] > 0) {
    addYaku('YAKUHAI_CHUN', '역패: 중', 1, 1, 'YAKUHAI', '중 유닛 올스탯 +35%, 아군 공격력 +6%', 33);
  }
  if (tripletCodes[roundWind] > 0) {
    addYaku(
      'YAKUHAI_ROUND_WIND',
      `장풍패(${TILE_META[roundWind].shortLabel})`,
      1,
      1,
      'YAKUHAI',
      `${TILE_META[roundWind].shortLabel} 유닛 올스탯 +35%, 아군 공격력 +6%`,
      roundWind,
    );
  }
  if (tripletCodes[seatWind] > 0) {
    addYaku(
      'YAKUHAI_SEAT_WIND',
      `자풍패(${TILE_META[seatWind].shortLabel})`,
      1,
      1,
      'YAKUHAI',
      `${TILE_META[seatWind].shortLabel} 유닛 올스탯 +35%, 아군 공격력 +6%`,
      seatWind,
    );
  }

  // 2. Group-pattern Yaku (Sanankou, Shousangen, Iipeikou/Ryanpeikou, Sanshoku, Ittsu)
  if (concealedTripletCount >= 3) {
    addYaku('SANANKOU', '산안커', 2, 2, 'TANK_POWER', '최대 체력 +36%, 공격력 +24%');
  }

  let dragonTriplets = 0;
  for (let i = 0; i < DRAGON_CODES.length; i++) {
    if (tripletCodes[DRAGON_CODES[i]] > 0) dragonTriplets++;
  }
  if (dragonTriplets === 2 && headCode >= 31 && headCode <= 33) {
    addYaku('SHOUSANGEN', '소삼원', 2, 2, 'TANK_POWER', '최대 체력 +36%, 공격력 +24%');
  }

  // Shuntsu start-code counts for Iipeikou, Ryanpeikou, Sanshoku Doujun, Ittsu
  const shuntsuStartCounts = new Uint8Array(27);
  for (let i = 0; i < shuntsuGroups.length; i++) {
    shuntsuStartCounts[shuntsuGroups[i].tileCodes[0]]++;
  }

  let ryanpeikouActive = false;
  if (isMenzen) {
    let doubleSeqPairs = 0;
    for (let c = 0; c < 27; c++) {
      if (shuntsuStartCounts[c] >= 4) doubleSeqPairs += 2;
      else if (shuntsuStartCounts[c] >= 2) doubleSeqPairs += 1;
    }
    if (doubleSeqPairs >= 2 && has4Mentsu1Head) {
      ryanpeikouActive = true;
      addYaku('RYANPEIKOU', '량페코', 3, null, 'SPEED_CRIT', '공속 +36%, 치명타율 +18%');
    } else if (doubleSeqPairs >= 1) {
      addYaku('IIPEIKOU', '이페코', 1, null, 'SPEED_CRIT', '공속 +12%, 치명타율 +6%');
    }
  }

  // Sanshoku Doujun
  for (let r = 0; r <= 6; r++) {
    if (
      shuntsuStartCounts[r] > 0 &&
      shuntsuStartCounts[9 + r] > 0 &&
      shuntsuStartCounts[18 + r] > 0
    ) {
      addYaku(
        'SANSHOKU_DOUJUN',
        '삼색동순',
        2,
        1,
        'FINAL_AMP',
        `최종 피해 곱연산 +${isMenzen ? 28 : 14}%`,
      );
      break;
    }
  }

  // Sanshoku Doukou
  for (let r = 0; r <= 8; r++) {
    if (tripletCodes[r] > 0 && tripletCodes[9 + r] > 0 && tripletCodes[18 + r] > 0) {
      addYaku('SANSHOKU_DOUKOU', '삼색동각', 2, 2, 'FINAL_AMP', '최종 피해 곱연산 +28%');
      break;
    }
  }

  // Ittsu
  for (let suitBase = 0; suitBase <= 18; suitBase += 9) {
    if (
      shuntsuStartCounts[suitBase] > 0 &&
      shuntsuStartCounts[suitBase + 3] > 0 &&
      shuntsuStartCounts[suitBase + 6] > 0
    ) {
      addYaku(
        'ITTSU',
        '일기통관',
        2,
        1,
        'FINAL_AMP',
        `최종 피해 곱연산 +${isMenzen ? 28 : 14}%`,
      );
      break;
    }
  }

  // 3. Whole-hand Yaku (require 4 mentsu + 1 head OR Chiitoitsu)
  if (isChiitoitsu && !ryanpeikouActive) {
    addYaku('CHIITOITSU', '치또이쯔', 2, null, 'FINAL_AMP', '최종 피해 곱연산 +28%');
  }

  if (has4Mentsu1Head) {
    // Pinfu: Menzen only, all 4 mentsu are Shuntsu
    if (isMenzen && shuntsuGroups.length === 4) {
      addYaku('PINFU', '핑후', 1, null, 'SPEED_CRIT', '공속 +12%, 치명타율 +6%');
    }

    // Toitoi: all 4 mentsu are Koutsu/Kan
    if (tripletGroups.length === 4) {
      addYaku('TOITOI', '또이또이', 2, 2, 'TANK_POWER', '최대 체력 +36%, 공격력 +24%');
    }
  }

  if (hasCompleteStructure && allActiveCodes.length > 0) {
    // Tanyao: all tiles are 2..8
    let allSimple = true;
    let allTerminalOrHonor = true;
    let hasHonor = false;
    let suitMask = 0; // bit 0: MAN, bit 1: PIN, bit 2: SOU

    for (let i = 0; i < allActiveCodes.length; i++) {
      const c = allActiveCodes[i];
      if (isTerminalOrHonorCode(c)) allSimple = false;
      else allTerminalOrHonor = false;
      if (isHonorCode(c)) {
        hasHonor = true;
      } else {
        suitMask |= 1 << Math.floor(c / 9);
      }
    }

    if (allSimple) {
      addYaku('TANYAO', '탕야오', 1, 1, 'SPEED_CRIT', '공속 +12%, 치명타율 +6%');
    }

    // Honroutou vs Junchan vs Chanta (superior suppresses inferior)
    if (allTerminalOrHonor) {
      addYaku('HONROUTOU', '혼노두', 2, 2, 'TANK_POWER', '최대 체력 +36%, 공격력 +24%');
    } else if (has4Mentsu1Head && isTerminalOrHonorCode(headCode)) {
      let everyMentsuHasTOH = true;
      for (let i = 0; i < mentsuGroups.length; i++) {
        const codes = mentsuGroups[i].tileCodes;
        if (!codes.some((c) => isTerminalOrHonorCode(c))) {
          everyMentsuHasTOH = false;
          break;
        }
      }
      if (everyMentsuHasTOH) {
        if (!hasHonor) {
          addYaku(
            'JUNCHAN',
            '준찬타',
            3,
            2,
            'TANK_POWER',
            `최대 체력 +${isMenzen ? 54 : 36}%, 공격력 +${isMenzen ? 36 : 24}%`,
          );
        } else {
          addYaku(
            'CHANTA',
            '찬타',
            2,
            1,
            'TANK_POWER',
            `최대 체력 +${isMenzen ? 36 : 18}%, 공격력 +${isMenzen ? 24 : 12}%`,
          );
        }
      }
    }

    // Chinitsu vs Honitsu (superior suppresses inferior)
    const singleSuit = suitMask === 1 || suitMask === 2 || suitMask === 4;
    if (singleSuit) {
      if (!hasHonor) {
        addYaku(
          'CHINITSU',
          '청일색',
          6,
          5,
          'FINAL_AMP',
          `최종 피해 곱연산 +${(isMenzen ? 6 : 5) * 14}%`,
        );
      } else {
        addYaku(
          'HONITSU',
          '혼일색',
          3,
          2,
          'FINAL_AMP',
          `최종 피해 곱연산 +${(isMenzen ? 3 : 2) * 14}%`,
        );
      }
    }

    // Menzen complete bonus
    if (isMenzen) {
      addYaku(
        'MENZEN_COMPLETE',
        '멘젠 완성 보너스',
        1,
        null,
        'COMMON',
        '최종 피해 및 최대 체력 ×1.08',
      );
    }
  }

  let totalHan = doraCount;
  for (let i = 0; i < normalYaku.length; i++) {
    totalHan += normalYaku[i].han;
  }

  // Sort normal yaku by han ascending for YAKU_TRIGGER dramatic reveal
  normalYaku.sort((a, b) => a.han - b.han);

  return {
    yakuman,
    normalYaku,
    totalHan,
    mentsuCount: mentsuGroups.length,
    koutsuOrKanCount: tripletGroups.length,
    toitsuCount: toitsuGroups.length,
    deployHeadTiles,
  };
}

function isBetterScore(a: PartitionScore, b: PartitionScore): boolean {
  if (a.yakuman.length !== b.yakuman.length) return a.yakuman.length > b.yakuman.length;
  if (a.totalHan !== b.totalHan) return a.totalHan > b.totalHan;
  if (a.mentsuCount !== b.mentsuCount) return a.mentsuCount > b.mentsuCount;
  if (a.koutsuOrKanCount !== b.koutsuOrKanCount) {
    return a.koutsuOrKanCount > b.koutsuOrKanCount;
  }
  return a.toitsuCount > b.toitsuCount;
}

function buildStatModifiers(
  score: PartitionScore,
  headTileCodes: readonly TileCode[],
  headIsValidPair: boolean,
  roundWind: WindCode,
  seatWind: WindCode,
  doraCount: number,
  permanentBuffs: PermanentBuffs,
): ComputedStatModifiers {
  const doraMult = 1 + YAKU_CATEGORY_BUFFS.COMMON.doraPerTile * doraCount;

  // Yakuman replaces normal Yaku & Head Aura; only Dora + Shop Permanent Buffs remain
  if (score.yakuman.length > 0) {
    let uncapAspd = false;
    for (let i = 0; i < score.yakuman.length; i++) {
      const id = score.yakuman[i].id;
      if (id === 'SHOUSUUSHII' || id === 'DAISUUSHII') {
        uncapAspd = true;
      }
    }
    return {
      headAuraBonus: 0,
      headAuraIsYakuhai: false,
      hpAdd: permanentBuffs.hpAdd,
      atkAdd: permanentBuffs.atkAdd,
      aspdAdd: permanentBuffs.aspdAdd,
      critAdd: 0,
      ampMult: 1,
      menzenBonus: false,
      doraMult,
      yakuhaiSelfBonus: {},
      yakuhaiTeamAtkBonus: 0,
      uncapAspd,
    };
  }

  const headAuraIsYakuhai =
    headIsValidPair && isYakuhaiCode(headTileCodes[0], roundWind, seatWind);
  const headAuraBonus = headIsValidPair
    ? headAuraIsYakuhai
      ? HEAD_AURA_YAKUHAI_BONUS
      : HEAD_AURA_NORMAL_BONUS
    : 0;

  let hpAdd = permanentBuffs.hpAdd + headAuraBonus;
  let atkAdd = permanentBuffs.atkAdd + headAuraBonus;
  let aspdAdd = permanentBuffs.aspdAdd + headAuraBonus;
  let critAdd = 0;
  let ampMult = 1;
  let menzenBonus = false;
  let yakuhaiTeamAtkBonus = 0;
  const yakuhaiSelfBonus: Record<number, number> = {};

  for (let i = 0; i < score.normalYaku.length; i++) {
    const y = score.normalYaku[i];
    switch (y.category) {
      case 'SPEED_CRIT':
        aspdAdd += YAKU_CATEGORY_BUFFS.SPEED_CRIT.aspdPerHan * y.han;
        critAdd += YAKU_CATEGORY_BUFFS.SPEED_CRIT.critPerHan * y.han;
        break;
      case 'TANK_POWER':
        hpAdd += YAKU_CATEGORY_BUFFS.TANK_POWER.hpPerHan * y.han;
        atkAdd += YAKU_CATEGORY_BUFFS.TANK_POWER.atkPerHan * y.han;
        break;
      case 'FINAL_AMP':
        ampMult *= 1 + YAKU_CATEGORY_BUFFS.FINAL_AMP.ampPerHan * y.han;
        break;
      case 'YAKUHAI':
        yakuhaiTeamAtkBonus += YAKU_CATEGORY_BUFFS.YAKUHAI.teamAtk;
        atkAdd += YAKU_CATEGORY_BUFFS.YAKUHAI.teamAtk;
        if (y.targetTileCode !== undefined) {
          yakuhaiSelfBonus[y.targetTileCode] =
            (yakuhaiSelfBonus[y.targetTileCode] ?? 0) + YAKU_CATEGORY_BUFFS.YAKUHAI.selfAllStat;
        }
        break;
      case 'COMMON':
        if (y.id === 'MENZEN_COMPLETE') {
          menzenBonus = true;
        }
        break;
    }
  }

  return {
    headAuraBonus,
    headAuraIsYakuhai,
    hpAdd,
    atkAdd,
    aspdAdd,
    critAdd,
    ampMult,
    menzenBonus,
    doraMult,
    yakuhaiSelfBonus,
    yakuhaiTeamAtkBonus,
    uncapAspd: false,
  };
}

/**
 * Pure Hand & Yaku Evaluator using straight-line (1x3 / 3x1 / 1x2 / 2x1) adjacency on the 6x6 ally grid.
 * Optimally partitions unlocked grid tiles via 36-bit bitmask DFS (<0.2ms for 12 tiles).
 */
export function evaluateHand(
  tiles: readonly TileInstance[],
  lockedGroups: readonly LockedGroup[],
  doraIndicators: readonly TileCode[],
  roundWind: WindCode,
  seatWind: WindCode,
  permanentBuffs: PermanentBuffs,
): YakuEvaluation {
  const isMenzen = lockedGroups.every((g) => g.isMenzen);

  const unlockedGridTiles: TileInstance[] = [];
  const headTiles: TileInstance[] = [];
  const allActiveCodes: TileCode[] = [];

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.location === 'GRID') {
      allActiveCodes.push(t.code);
      if (t.lockGroupId === null) {
        unlockedGridTiles.push(t);
      }
    } else if (t.location === 'HEAD') {
      headTiles.push(t);
      allActiveCodes.push(t.code);
    }
  }

  const headTileCodes = headTiles.map((t) => t.code);
  const headIsValidPair = headTiles.length === 2 && headTiles[0].code === headTiles[1].code;

  // Dora count (indicated tile itself is Dora)
  const doraLookup = new Uint8Array(TOTAL_TILE_TYPES);
  for (let i = 0; i < doraIndicators.length; i++) {
    doraLookup[doraIndicators[i]]++;
  }
  let doraCount = 0;
  for (let i = 0; i < allActiveCodes.length; i++) {
    doraCount += doraLookup[allActiveCodes[i]];
  }

  // Convert LockedGroups to fixed EvaluatedGroups
  const fixedGroups: EvaluatedGroup[] = lockedGroups.map((lg) => ({
    kind: lg.type === 'CHI' ? 'SHUNTSU' : lg.type === 'PON' ? 'KOUTSU' : lg.type,
    tileIds: [...lg.tileIds],
    tileCodes: [...lg.tileCodes],
    isLocked: true,
    isMenzen: lg.isMenzen,
    lockGroupId: lg.groupId,
    orientation: lg.orientation,
  }));

  // Map unlocked tile IDs -> cell index for fast bit checks
  const unlockedCellIndices = new Int8Array(unlockedGridTiles.length);
  for (let i = 0; i < unlockedGridTiles.length; i++) {
    const pos = unlockedGridTiles[i].gridPos;
    unlockedCellIndices[i] = pos ? pos.row * ALLY_COLS + pos.col : -1;
  }

  const candidates = extractLineCandidates(unlockedGridTiles);
  const chosen: LineCandidate[] = [];

  let bestGroups: EvaluatedGroup[] | null = null;
  let bestScore: PartitionScore | null = null;

  const finalizeSubset = (usedLo: number, usedHi: number) => {
    const groups: EvaluatedGroup[] = [...fixedGroups];
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      groups.push({
        kind: c.kind,
        tileIds: c.tileIds,
        tileCodes: c.tileCodes,
        isLocked: false,
        isMenzen: true,
        lockGroupId: null,
        orientation: c.orientation,
      });
    }
    for (let i = 0; i < unlockedGridTiles.length; i++) {
      const cellIdx = unlockedCellIndices[i];
      const isUsed =
        cellIdx < 32
          ? ((usedLo >>> cellIdx) & 1) === 1
          : ((usedHi >>> (cellIdx - 32)) & 1) === 1;
      if (!isUsed) {
        const t = unlockedGridTiles[i];
        groups.push({
          kind: 'ISOLATED',
          tileIds: [t.id],
          tileCodes: [t.code],
          isLocked: false,
          isMenzen: true,
          lockGroupId: null,
        });
      }
    }

    const score = scorePartition(
      groups,
      headTileCodes,
      headIsValidPair,
      allActiveCodes,
      isMenzen,
      lockedGroups.length,
      roundWind,
      seatWind,
      doraCount,
    );

    if (bestScore === null || isBetterScore(score, bestScore)) {
      bestScore = score;
      bestGroups = groups;
    }
  };

  // DFS over non-overlapping straight-line candidates, evaluating maximal subsets
  const dfs = (idx: number, usedLo: number, usedHi: number) => {
    let extended = false;
    for (let i = idx; i < candidates.length; i++) {
      const cand = candidates[i];
      if ((usedLo & cand.loMask) === 0 && (usedHi & cand.hiMask) === 0) {
        extended = true;
        chosen.push(cand);
        dfs(i + 1, (usedLo | cand.loMask) >>> 0, (usedHi | cand.hiMask) >>> 0);
        chosen.pop();
      }
    }
    if (!extended) {
      finalizeSubset(usedLo, usedHi);
    }
  };

  if (candidates.length === 0) {
    finalizeSubset(0, 0);
  } else {
    dfs(0, 0, 0);
  }

  const finalScore = bestScore!;
  const finalGroups = bestGroups!;
  const statModifiers = buildStatModifiers(
    finalScore,
    headTileCodes,
    headIsValidPair,
    roundWind,
    seatWind,
    doraCount,
    permanentBuffs,
  );

  return {
    isMenzen,
    groups: finalGroups,
    headTileCodes,
    headIsValidPair,
    normalYaku: finalScore.normalYaku,
    yakuman: finalScore.yakuman,
    doraCount,
    totalHan: finalScore.totalHan,
    statModifiers,
    deployHeadTiles: finalScore.deployHeadTiles,
  };
}
