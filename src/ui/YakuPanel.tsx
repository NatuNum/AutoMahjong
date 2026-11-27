import React from 'react';
import type { YakuEvaluation } from '../core/types';

interface YakuPanelProps {
  evaluation: YakuEvaluation;
  logicalGridCount: number;
  combatLog: string[];
  isCombat: boolean;
}

export const YakuPanel: React.FC<YakuPanelProps> = ({
  evaluation,
  logicalGridCount,
  combatLog,
  isCombat,
}) => {
  const mod = evaluation.statModifiers;
  const hasYakuman = evaluation.yakuman.length > 0;

  return (
    <div className="panel-card" style={{ height: '100%', overflow: 'hidden' }}>
      <div className="panel-title">
        <span>실시간 역 &amp; 스탯 미리보기</span>
        <span
          style={{
            fontSize: 13,
            padding: '2px 8px',
            borderRadius: 6,
            background: evaluation.isMenzen ? 'rgba(16,185,129,0.22)' : 'rgba(249,115,22,0.22)',
            color: evaluation.isMenzen ? '#6ee7b7' : '#fdba74',
          }}
        >
          {evaluation.isMenzen ? '멘젠 유지' : '후로 상태'}
        </span>
      </div>

      {/* Logical slot + Total Han banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 12px',
          borderRadius: 10,
          background: hasYakuman
            ? 'linear-gradient(135deg, rgba(185,28,28,0.45), rgba(124,58,237,0.45))'
            : 'rgba(30,41,59,0.85)',
          border: hasYakuman ? '1px solid #ef4444' : '1px solid rgba(250,204,21,0.35)',
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>전투 그리드 논리 패</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{logicalGridCount} / 12</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {hasYakuman ? '역만 발동!' : `도라 ${evaluation.doraCount}장 포함`}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: hasYakuman ? '#fca5a5' : '#fde047',
            }}
          >
            {hasYakuman ? `${evaluation.yakuman.length}배 역만` : `${evaluation.totalHan}판`}
          </div>
        </div>
      </div>

      {/* Active Yaku / Yakuman list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingRight: 4,
        }}
      >
        {hasYakuman ? (
          evaluation.yakuman.map((yk) => (
            <div
              key={yk.id}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(153, 27, 27, 0.35)',
                border: '1px solid rgba(248, 113, 113, 0.6)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                <span style={{ color: '#fecaca', fontSize: 16 }}>★ {yk.name}</span>
                <span style={{ color: '#fde047' }}>역만</span>
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 4 }}>{yk.description}</div>
            </div>
          ))
        ) : evaluation.normalYaku.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: 13,
              background: 'rgba(15, 23, 42, 0.5)',
              borderRadius: 10,
            }}
          >
            가로·세로 1직선으로 슌쯔/커쯔를 배치해 역을 완성해보세요!
          </div>
        ) : (
          evaluation.normalYaku.map((y) => (
            <div
              key={y.id}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(30, 41, 59, 0.78)',
                border: '1px solid rgba(148, 163, 184, 0.22)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                <span>{y.name}</span>
                <span style={{ color: '#fde047' }}>{y.han}판</span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{y.description}</div>
            </div>
          ))
        )}

        {evaluation.doraCount > 0 && (
          <div
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(250, 204, 21, 0.12)',
              border: '1px solid rgba(250, 204, 21, 0.35)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
              fontWeight: 700,
              color: '#fde047',
            }}
          >
            <span>★ 도라 보너스</span>
            <span>
              ×{mod.doraMult.toFixed(2)} ({evaluation.doraCount}장)
            </span>
          </div>
        )}
      </div>

      {/* Stat modifier summary */}
      <div
        style={{
          padding: 10,
          borderRadius: 10,
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 10px',
          fontSize: 13,
        }}
      >
        <div>체력 합연산: <b style={{ color: '#4ade80' }}>+{Math.round(mod.hpAdd * 100)}%</b></div>
        <div>공격 합연산: <b style={{ color: '#fb923c' }}>+{Math.round(mod.atkAdd * 100)}%</b></div>
        <div>공속 합연산: <b style={{ color: '#38bdf8' }}>+{Math.round(mod.aspdAdd * 100)}%</b></div>
        <div>치명타 추가: <b style={{ color: '#facc15' }}>+{Math.round(mod.critAdd * 100)}%</b></div>
        <div style={{ gridColumn: '1 / -1', color: '#cbd5e1' }}>
          최종 곱연산: <b style={{ color: '#fde047' }}>
            ×{(mod.ampMult * (mod.menzenBonus ? 1.08 : 1) * mod.doraMult).toFixed(2)}
          </b>
          {mod.headAuraBonus > 0 && (
            <span style={{ marginLeft: 8, color: '#6ee7b7' }}>
              (머리 +{Math.round(mod.headAuraBonus * 100)}%)
            </span>
          )}
        </div>
      </div>

      {/* Combat log snippet during combat */}
      {isCombat && combatLog.length > 0 && (
        <div
          style={{
            height: 110,
            overflowY: 'auto',
            background: 'rgba(2, 6, 23, 0.85)',
            borderRadius: 8,
            padding: 8,
            fontSize: 12,
            color: '#cbd5e1',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {combatLog.slice(-6).map((line, i) => (
            <div key={i}>• {line}</div>
          ))}
        </div>
      )}
    </div>
  );
};
