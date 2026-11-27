import React, { useEffect, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import type { GameState, YakuEvaluation } from '../core/types';

interface YakuTriggerOverlayProps {
  evaluation: YakuEvaluation;
  onComplete: () => void;
}

interface RevealStep {
  title: string;
  subtitle: string;
  badge: string;
  isYakuman: boolean;
}

export const YakuTriggerOverlay: React.FC<YakuTriggerOverlayProps> = ({
  evaluation,
  onComplete,
}) => {
  const steps: RevealStep[] = [];
  if (evaluation.yakuman.length > 0) {
    if (evaluation.doraCount > 0) {
      steps.push({
        title: `도라 보너스 ×${evaluation.doraCount}`,
        subtitle: `최종 피해 및 체력 ×${evaluation.statModifiers.doraMult.toFixed(2)}`,
        badge: '도라',
        isYakuman: false,
      });
    }
    for (const yk of evaluation.yakuman) {
      steps.push({
        title: `★ 역만: ${yk.name} ★`,
        subtitle: yk.description,
        badge: 'YAKUMAN',
        isYakuman: true,
      });
    }
  } else {
    for (const y of evaluation.normalYaku) {
      steps.push({
        title: y.name,
        subtitle: y.description,
        badge: `${y.han}판`,
        isYakuman: false,
      });
    }
    if (evaluation.doraCount > 0) {
      steps.push({
        title: `도라 ×${evaluation.doraCount}`,
        subtitle: `최종 피해 및 체력 ×${evaluation.statModifiers.doraMult.toFixed(2)}`,
        badge: `+${evaluation.doraCount}판`,
        isYakuman: false,
      });
    }
  }

  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (steps.length === 0) {
      const t = window.setTimeout(onComplete, 250);
      return () => window.clearTimeout(t);
    }
    const current = steps[index];
    if (current) {
      if (current.isYakuman) soundEngine.playYakumanFanfare();
      else soundEngine.playYakuLight(index);
    }
    const delay = current?.isYakuman ? 900 : 420;
    const timer = window.setTimeout(() => {
      if (index + 1 >= steps.length) {
        onComplete();
      } else {
        setIndex((prev) => prev + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps.length]);

  const current = steps[index];

  return (
    <div className="yaku-banner-overlay">
      {current ? (
        <div key={index} className={`yaku-banner-card ${current.isYakuman ? 'yakuman' : ''}`}>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#fde047', marginBottom: 6 }}>
            {current.badge}
          </div>
          <div style={{ fontSize: 40, fontWeight: 900, color: '#ffffff' }}>{current.title}</div>
          <div style={{ fontSize: 17, color: '#e2e8f0', marginTop: 10 }}>{current.subtitle}</div>
        </div>
      ) : (
        <div className="yaku-banner-card">
          <div style={{ fontSize: 32, fontWeight: 900 }}>전투 개시!</div>
        </div>
      )}
      <button className="btn" onClick={onComplete}>
        연출 스킵 ⏭
      </button>
    </div>
  );
};

interface RoundResultModalProps {
  state: GameState;
  onProceed: () => void;
}

export const RoundResultModal: React.FC<RoundResultModalProps> = ({ state, onProceed }) => {
  const res = state.lastRoundResult;
  if (!res) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 540, textAlign: 'center' }}>
        <h2
          style={{
            margin: 0,
            fontSize: 34,
            color: res.won ? '#4ade80' : '#f87171',
          }}
        >
          {res.won
            ? `라운드 ${res.round} 승리!`
            : res.timedOut
              ? `라운드 ${res.round} 시간 초과 패배`
              : `라운드 ${res.round} 패배`}
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            background: 'rgba(30,41,59,0.75)',
            padding: 16,
            borderRadius: 12,
            fontSize: 15,
          }}
        >
          <div>적 웨이브: <b>{res.enemyWave}</b></div>
          <div>전투 시간: <b>{res.durationSec}초</b></div>
          <div>발동 판수: <b style={{ color: '#fde047' }}>{res.yakumanCount > 0 ? '역만!' : `${res.totalHan}판`}</b></div>
          <div>총 가한 피해: <b>{res.totalAllyDamage.toLocaleString()}</b></div>
          {res.won ? (
            <div style={{ gridColumn: '1 / -1', fontSize: 20, color: '#fde047', fontWeight: 900 }}>
              획득 점봉: +{res.pointsEarned} (보유 {state.points})
            </div>
          ) : (
            <div style={{ gridColumn: '1 / -1', fontSize: 14, color: '#fca5a5', lineHeight: 1.5 }}>
              라이프 -1 (남은 라이프: <b>{'♥'.repeat(state.lives)}</b>)<br />
              위로 점봉 없음 · 라운드 시작 직전으로 롤백하여 새 쯔모 순서로 재도전합니다.
            </div>
          )}
        </div>

        <button
          className={`btn ${res.won ? 'btn-emerald' : 'btn-primary'}`}
          style={{ fontSize: 18, padding: '14px 24px' }}
          onClick={onProceed}
        >
          {res.won ? `▶ 라운드 ${state.round + 1} 상점으로 이동` : `🔄 라운드 ${state.round} 재도전`}
        </button>
      </div>
    </div>
  );
};

interface GameOverModalProps {
  state: GameState;
  onRestart: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({ state, onRestart }) => {
  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 520, textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 36, color: '#ef4444' }}>GAME OVER</h2>
        <div style={{ color: '#cbd5e1', fontSize: 15 }}>
          라운드 {state.round}에서 모든 라이프를 소진했습니다.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            background: 'rgba(30,41,59,0.75)',
            padding: 16,
            borderRadius: 12,
            fontSize: 15,
          }}
        >
          <div>클리어 라운드: <b>{state.stats.roundsCleared}</b></div>
          <div>최고 판수: <b style={{ color: '#fde047' }}>{state.stats.highestHan}판</b></div>
          <div>역만 발동 횟수: <b>{state.stats.yakumanTriggered}</b></div>
          <div>총 획득 점봉: <b>{state.stats.totalPointsEarned}</b></div>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 18, padding: '14px 24px' }}
          onClick={onRestart}
        >
          🀄 새 엔들리스 런 시작
        </button>
      </div>
    </div>
  );
};
