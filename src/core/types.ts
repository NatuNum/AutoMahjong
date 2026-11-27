export type Suit = 'MAN' | 'PIN' | 'SOU' | 'HONOR';

/** 0..8: MAN 1..9, 9..17: PIN 1..9, 18..26: SOU 1..9, 27..30: E/S/W/N, 31..33: Haku/Hatsu/Chun */
export type TileCode = number;

export type TileLocation = 'GRID' | 'HEAD' | 'BENCH';

export type WindCode = 27 | 28 | 29 | 30; // 동(27), 남(28), 서(29), 북(30)

export interface GridPos {
  row: number;
  col: number;
}

export type Orientation = 'HORIZONTAL' | 'VERTICAL';

export interface TileInstance {
  id: string;
  code: TileCode;
  suit: Suit;
  /** 1..9 for MAN/PIN/SOU, 1..4 for E/S/W/N, 5..7 for Haku/Hatsu/Chun */
  rank: number;
  location: TileLocation;
  gridPos: GridPos | null;
  benchIndex: number | null;
  headIndex: 0 | 1 | null;
  lockGroupId: string | null;
}

export type LockedGroupType = 'CHI' | 'PON' | 'ANKAN' | 'MINKAN' | 'KAKAN';

export interface LockedGroup {
  groupId: string;
  type: LockedGroupType;
  tileIds: string[];
  tileCodes: TileCode[];
  isMenzen: boolean;
  claimedTileId: string | null;
  anchorGridPos: GridPos;
  orientation: Orientation;
}

export type UnitTier =
  | 'ISOLATED'
  | 'TOITSU'
  | 'SHUNTSU'
  | 'KOUTSU'
  | 'ANKAN'
  | 'MINKAN'
  | 'KAKAN';

export type GroupKind =
  | 'SHUNTSU'
  | 'KOUTSU'
  | 'ANKAN'
  | 'MINKAN'
  | 'KAKAN'
  | 'TOITSU'
  | 'ISOLATED';

export interface EvaluatedGroup {
  kind: GroupKind;
  tileIds: string[];
  tileCodes: TileCode[];
  isLocked: boolean;
  isMenzen: boolean;
  lockGroupId: string | null;
  orientation?: Orientation;
}

export type YakuCategory = 'SPEED_CRIT' | 'TANK_POWER' | 'FINAL_AMP' | 'YAKUHAI' | 'COMMON';

export interface ActiveYaku {
  id: string;
  name: string;
  han: number;
  category: YakuCategory;
  description: string;
  /** Optional target tile code for YAKUHAI (e.g. 31=백) */
  targetTileCode?: TileCode;
}

export interface ActiveYakuman {
  id: string;
  name: string;
  description: string;
}

export interface ComputedStatModifiers {
  headAuraBonus: number;
  headAuraIsYakuhai: boolean;
  hpAdd: number;
  atkAdd: number;
  aspdAdd: number;
  critAdd: number;
  ampMult: number;
  menzenBonus: boolean;
  doraMult: number;
  /** Map from tileCode (27..33) to extra self all-stat bonus (e.g. 0.35 or 0.70 for double wind) */
  yakuhaiSelfBonus: Record<number, number>;
  yakuhaiTeamAtkBonus: number;
  uncapAspd: boolean;
}

export interface YakuEvaluation {
  isMenzen: boolean;
  groups: EvaluatedGroup[];
  headTileCodes: TileCode[];
  headIsValidPair: boolean;
  normalYaku: ActiveYaku[];
  yakuman: ActiveYakuman[];
  doraCount: number;
  totalHan: number;
  statModifiers: ComputedStatModifiers;
  /** True when Chiitoitsu or Kokushi Musou is active so Head tiles deploy onto the grid */
  deployHeadTiles: boolean;
}

export type EnemyArchetype = 'SWARM' | 'BRUISER' | 'SNIPER' | 'BOSS';

export interface UnitCooldowns {
  attack: number;
  move: number;
  bossSlam: number;
  quakeStunIcd: number;
}

export interface CombatUnit {
  unitId: string;
  side: 'PLAYER' | 'ENEMY';
  sourceTileIds: string[];
  tier: UnitTier;
  suit: Suit | null;
  tileCode: TileCode | null;
  archetype?: EnemyArchetype;
  row: number;
  col: number;
  prevRow: number;
  prevCol: number;
  hp: number;
  maxHp: number;
  atk: number;
  baseAtk: number;
  aspd: number;
  baseAspd: number;
  range: number;
  moveCooldown: number;
  critChance: number;
  shield: number;
  maxShield: number;
  cooldowns: UnitCooldowns;
  alive: boolean;
  freezeTimer: number;
  stunTimer: number;
  invulnTimer: number;
  enrageStacks: number;
  isGiant: boolean;
  totalDamageDealt: number;
}

export type GamePhase =
  | 'INIT_RUN'
  | 'PRE_SHOP'
  | 'DRAW_LOOP'
  | 'POST_SHOP_PREP'
  | 'YAKU_TRIGGER'
  | 'COMBAT'
  | 'ROUND_RESULT'
  | 'GAME_OVER';

export type DrawSubPhase =
  | 'TSUMO'
  | 'GRID_REPLACE'
  | 'FURO_CHECK'
  | 'FURO_SKIP_WAIT';

export type ShopItemId =
  | 'BENCH_EXPAND'
  | 'DISMANTLE_TICKET'
  | 'RANK_SHIFT_TICKET'
  | 'MAGICAL_DRAW'
  | 'PERM_ATK'
  | 'PERM_HP'
  | 'PERM_ASPD'
  | 'OPEN_DORA';

export type ConsumableItemId =
  | 'DISMANTLE_TICKET'
  | 'RANK_SHIFT_TICKET'
  | 'MAGICAL_DRAW';

export interface ShopOffer {
  offerId: string;
  itemId: ShopItemId;
  price: number;
  purchased: boolean;
}

export interface InventoryItem {
  instanceId: string;
  itemId: ConsumableItemId;
}

export interface PermanentBuffs {
  atkAdd: number;
  hpAdd: number;
  aspdAdd: number;
}

export interface FuroCandidate {
  id: string;
  discardIndex: number;
  discardCode: TileCode;
  type: 'CHI' | 'PON' | 'MINKAN';
  /** Material tile IDs from player's current tiles */
  materialTileIds: string[];
  /** Resulting sorted codes of the group */
  resultCodes: TileCode[];
}

export interface KanCandidate {
  type: 'ANKAN' | 'KAKAN';
  tileCode: TileCode;
  tileIds: string[];
  targetLockGroupId?: string;
  usesCurrentTsumo: boolean;
}

export interface PendingGridPlacement {
  tile: TileInstance;
  targetPos: GridPos | null;
  source: 'TSUMO' | 'MAGICAL_DRAW' | 'FURO_OVERFLOW';
  /** If true, completing replacement skips FURO_CHECK (e.g. after Minkan/Kakan bonus draw or Magical Draw) */
  skipFuroCheckAfter: boolean;
}

export interface BoardSnapshot {
  tiles: TileInstance[];
  lockedGroups: LockedGroup[];
  benchCapacity: number;
  benchUpgradeCount: number;
  inventory: InventoryItem[];
  permanentBuffs: PermanentBuffs;
  doraIndicators: TileCode[];
  points: number;
  seatWind: WindCode;
  nextEntityId: number;
}

export interface RoundResultSummary {
  won: boolean;
  timedOut: boolean;
  round: number;
  enemyWave: EnemyArchetype;
  pointsEarned: number;
  totalHan: number;
  yakumanCount: number;
  durationSec: number;
  totalAllyDamage: number;
  survivingAllies: number;
}

export interface RunStats {
  roundsCleared: number;
  highestHan: number;
  yakumanTriggered: number;
  totalKills: number;
  totalPointsEarned: number;
}

export interface GameState {
  version: number;
  round: number;
  lives: number;
  points: number;
  phase: GamePhase;
  drawSubPhase: DrawSubPhase;
  roundWind: WindCode;
  seatWind: WindCode;
  rngSeed: number;
  rngState: number;
  drawRemaining: number;
  /** Counts how many times current round was retried (for deterministic seed mutation) */
  roundRetryCount: number;
  wall: TileCode[];
  /** Codes discarded in current round (for Magical Draw availability check & display) */
  roundDiscards: TileCode[];
  currentTsumo: TileInstance | null;
  currentDiscards: TileCode[];
  /** Set when a Kan bonus draw is active so Minkan/Kakan skips FURO_CHECK */
  skipNextFuroCheck: boolean;
  pendingPlacement: PendingGridPlacement | null;
  tiles: TileInstance[];
  lockedGroups: LockedGroup[];
  benchCapacity: number;
  benchUpgradeCount: number;
  inventory: InventoryItem[];
  shopOffers: ShopOffer[];
  shopRerollCount: number;
  magicalDrawBoughtThisRound: boolean;
  permanentBuffs: PermanentBuffs;
  doraIndicators: TileCode[];
  roundStartSnapshot: BoardSnapshot | null;
  preCombatSnapshot: BoardSnapshot | null;
  currentWaveArchetype: EnemyArchetype;
  lastRoundResult: RoundResultSummary | null;
  stats: RunStats;
  nextEntityId: number;
}
