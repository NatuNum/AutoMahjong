import type { ShopItemId } from '../core/types';

export interface ShopItemDefinition {
  id: ShopItemId;
  name: string;
  category: 'INFRA' | 'CONSUMABLE' | 'BUFF';
  basePrice: number;
  description: string;
  weight: number;
}

export const SHOP_SLOTS_COUNT = 5;
export const BENCH_EXPAND_BASE_PRICE = 10;

export const SHOP_CATALOG: Record<ShopItemId, ShopItemDefinition> = {
  BENCH_EXPAND: {
    id: 'BENCH_EXPAND',
    name: '대기필드 +1칸',
    category: 'INFRA',
    basePrice: BENCH_EXPAND_BASE_PRICE,
    description: '대기필드 최대 12칸까지 영구 확장 (구매마다 가격 2배)',
    weight: 10,
  },
  DISMANTLE_TICKET: {
    id: 'DISMANTLE_TICKET',
    name: '후로/깡 해체권',
    category: 'CONSUMABLE',
    basePrice: 15,
    description: '[인벤토리] 잠긴 후로 멘쯔 또는 깡 유닛 1개 해제 (멘젠 복구 가능)',
    weight: 12,
  },
  RANK_SHIFT_TICKET: {
    id: 'RANK_SHIFT_TICKET',
    name: '패 숫자 ±1 변경권',
    category: 'CONSUMABLE',
    basePrice: 12,
    description: '[인벤토리] 비고정 수패 1장의 숫자 ±1 (1/9 순환·자패·후로 불가)',
    weight: 16,
  },
  MAGICAL_DRAW: {
    id: 'MAGICAL_DRAW',
    name: '매지컬 드로우',
    category: 'CONSUMABLE',
    basePrice: 25,
    description: '[인벤토리] 패산에 남은 원하는 패 1장 즉시 획득 (라운드당 구매 1회)',
    weight: 8,
  },
  PERM_ATK: {
    id: 'PERM_ATK',
    name: '무력 강화',
    category: 'BUFF',
    basePrice: 14,
    description: '런 전체 아군 기본 공격력 영구 +8%',
    weight: 18,
  },
  PERM_HP: {
    id: 'PERM_HP',
    name: '강철 체력',
    category: 'BUFF',
    basePrice: 14,
    description: '런 전체 아군 최대 체력 영구 +10%',
    weight: 18,
  },
  PERM_ASPD: {
    id: 'PERM_ASPD',
    name: '신속 훈련',
    category: 'BUFF',
    basePrice: 16,
    description: '런 전체 아군 공격 속도 영구 +8%',
    weight: 15,
  },
  OPEN_DORA: {
    id: 'OPEN_DORA',
    name: '도라 개방',
    category: 'BUFF',
    basePrice: 22,
    description: '무작위 신규 패 1종을 영구 도라로 추가',
    weight: 10,
  },
};

export const ALL_SHOP_ITEM_IDS: readonly ShopItemId[] = Object.keys(
  SHOP_CATALOG,
) as ShopItemId[];

/** Fibonacci reroll cost: 2, 3, 5, 8, 13, 21, 34... */
export function getRerollCost(rerollCount: number): number {
  let a = 2;
  let b = 3;
  for (let i = 0; i < rerollCount; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}

/** Doubles per purchase: 10, 20, 40, 80, 160, 320 */
export function getBenchExpandPrice(upgradeCount: number): number {
  return BENCH_EXPAND_BASE_PRICE * Math.pow(2, upgradeCount);
}

export function computeRoundWinPoints(
  round: number,
  totalHan: number,
  hasYakuman: boolean,
  isBoss: boolean,
): number {
  const effectiveHan = hasYakuman ? Math.max(13, totalHan) : totalHan;
  const bossBonus = isBoss ? 15 : 0;
  return 10 + 2 * round + 3 * effectiveHan + bossBonus;
}
