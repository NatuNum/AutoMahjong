import React from 'react';
import { SHOP_CATALOG, getRerollCost } from '../config/shop';
import { MAX_BENCH_CAPACITY } from '../config/stats';
import type { GameState } from '../core/types';

interface ShopModalProps {
  state: GameState;
  onBuy: (offerId: string) => void;
  onReroll: () => void;
  onClose: () => void;
  onStartDrawLoop?: () => void;
}

const CAT_BADGES = {
  INFRA: { label: '인프라', color: '#38bdf8' },
  CONSUMABLE: { label: '소모품 (인벤토리)', color: '#a855f7' },
  BUFF: { label: '영구 버프', color: '#10b981' },
};

export const ShopModal: React.FC<ShopModalProps> = ({
  state,
  onBuy,
  onReroll,
  onClose,
  onStartDrawLoop,
}) => {
  const rerollCost = getRerollCost(state.shopRerollCount);
  const isPreShop = state.phase === 'PRE_SHOP';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, color: '#fde047', fontSize: 24 }}>
              {isPreShop ? `라운드 ${state.round} 사전 상점` : `라운드 ${state.round} 후반 상점`}
            </h2>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
              보유 점봉: <b style={{ color: '#fde047', fontSize: 16 }}>{state.points}</b> · 대기필드{' '}
              <b>
                {state.benchCapacity}/{MAX_BENCH_CAPACITY}
              </b>
              칸 · 소모품은 구매 후 왼쪽 인벤토리에서 원하는 시점에 사용 가능
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-sky"
              disabled={state.points < rerollCost}
              onClick={onReroll}
            >
              🔄 리롤 ({rerollCost} 점봉 · 피보나치)
            </button>
            <button className="btn" onClick={onClose}>
              닫기 ✕
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
          }}
        >
          {state.shopOffers.map((offer) => {
            const def = SHOP_CATALOG[offer.itemId];
            const badge = CAT_BADGES[def.category];
            const disabled =
              offer.purchased ||
              state.points < offer.price ||
              (offer.itemId === 'BENCH_EXPAND' && state.benchCapacity >= MAX_BENCH_CAPACITY) ||
              (offer.itemId === 'MAGICAL_DRAW' && state.magicalDrawBoughtThisRound);

            return (
              <div
                key={offer.offerId}
                style={{
                  background: offer.purchased
                    ? 'rgba(15, 23, 42, 0.4)'
                    : 'rgba(30, 41, 59, 0.88)',
                  border: offer.purchased
                    ? '1px dashed rgba(148, 163, 184, 0.25)'
                    : '1px solid rgba(250, 204, 21, 0.35)',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  minHeight: 220,
                  opacity: offer.purchased ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span
                    style={{
                      alignSelf: 'flex-start',
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: `${badge.color}26`,
                      color: badge.color,
                      border: `1px solid ${badge.color}66`,
                    }}
                  >
                    {badge.label}
                  </span>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#f8fafc' }}>{def.name}</div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
                    {def.description}
                  </div>
                </div>

                <button
                  className={`btn ${offer.purchased ? '' : 'btn-primary'}`}
                  disabled={disabled}
                  onClick={() => onBuy(offer.offerId)}
                >
                  {offer.purchased ? '구매 완료' : `${offer.price} 점봉 구매`}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {isPreShop && onStartDrawLoop ? (
            <button className="btn btn-emerald" onClick={onStartDrawLoop}>
              ▶ 상점 종료 &amp; 쯔모 시작
            </button>
          ) : (
            <button className="btn btn-emerald" onClick={onClose}>
              편성 화면으로 돌아가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
