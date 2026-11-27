import React, { useState } from 'react';
import { NORMAL_YAKU_CATALOG, YAKUMAN_CATALOG } from '../config/yaku';
import { TileCard } from './TileCard';

interface YakuCodexModalProps {
  onClose: () => void;
}

export const YakuCodexModal: React.FC<YakuCodexModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<'NORMAL' | 'YAKUMAN' | 'RULES'>('NORMAL');
  const entries = tab === 'NORMAL' ? NORMAL_YAKU_CATALOG : YAKUMAN_CATALOG;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, color: '#fde047', fontSize: 24 }}>마작 족보 &amp; 역 도감</h2>
            <button
              className={`btn ${tab === 'NORMAL' ? 'btn-primary' : ''}`}
              onClick={() => setTab('NORMAL')}
            >
              일반 역 ({NORMAL_YAKU_CATALOG.length})
            </button>
            <button
              className={`btn ${tab === 'YAKUMAN' ? 'btn-danger' : ''}`}
              onClick={() => setTab('YAKUMAN')}
            >
              역만 ({YAKUMAN_CATALOG.length})
            </button>
            <button
              className={`btn ${tab === 'RULES' ? 'btn-sky' : ''}`}
              onClick={() => setTab('RULES')}
            >
              핵심 규칙 안내
            </button>
          </div>
          <button className="btn" onClick={onClose}>
            닫기 ✕
          </button>
        </div>

        {tab === 'RULES' ? (
          <div
            style={{
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 14,
              fontSize: 14,
              lineHeight: 1.65,
              color: '#e2e8f0',
            }}
          >
            <div className="panel-card">
              <div className="panel-title">1. 1직선 인접 조합 규칙</div>
              <div>
                • 6×6 아군 그리드에서 <b>가로 1×3 / 세로 3×1 직선</b>으로 연속 배치된 패만 슌쯔·커쯔로 인정됩니다. (ㄱ자 꺾임 미인정)<br />
                • <b>후로(치·퐁)</b>는 3장이 한 블록으로 묶여 이동하며, 우클릭 또는 <b>R키</b>로 가로↔세로 회전할 수 있습니다.<br />
                • <b>깡(안깡·밍깡·가깡)</b>은 4장이 거대 1칸 유닛으로 합체되며, <b>영구 도라 +1</b> 및 추가 쯔모 1회를 얻습니다.
              </div>
            </div>
            <div className="panel-card">
              <div className="panel-title">2. 머리 슬롯 &amp; 14패 규칙</div>
              <div>
                • 머리 슬롯에는 <b>동일한 패 2장(또이쯔)</b>만 배치 가능합니다. (동일 패를 보유 중이면 패 1장을 머리 슬롯에 드래그해 자동 쌍 교체 가능)<br />
                • 머리 오라: <b>역패(백·발·중·장풍·자풍) +10%</b>, 그 외 <b>+5%</b> 아군 전체 올스탯.<br />
                • <b>치또이쯔·국사무쌍</b> 완성 시 전투 시작과 함께 머리 슬롯 2장이 그리드로 합류해 참전합니다.
              </div>
            </div>
            <div className="panel-card">
              <div className="panel-title">3. 전투 &amp; 스탯 공식</div>
              <div>
                • <b>슌쯔</b>는 공격 시 타겟 뒤편 같은 행 적들에게 <b>60% 직선 관통</b> 피해.<br />
                • <b>깡</b>은 타겟 중심 <b>3×3 범위 50% 스플래시</b> 광역 피해.<br />
                • 방어력은 없으며, 모든 합연산 버프 적용 후 최종 증폭·멘젠·도라를 곱연산합니다. (기본 공속 최대 2배 상한)<br />
                • 전투 제한 시간 <b>60초</b> 초과 시 패배하며, 패배 시 라이프 -1 후 해당 라운드 시작 직전으로 롤백해 새 패산으로 재도전합니다.
              </div>
            </div>
            <div className="panel-card">
              <div className="panel-title">4. 장풍·자풍·도라·역만</div>
              <div>
                • 런 시작 시 <b>장풍 1종 고정</b>, 매 <b>3라운드마다 자풍 순환</b> (동→남→서→북).<br />
                • <b>도라</b>는 상단에 표시된 패 자체가 도라이며, 장당 최종 피해·체력 +8% 곱연산.<br />
                • 상위 역 성립 시 하위 역은 제외됩니다. 역만은 중첩 가능하며, 역만 발동 시 도라와 상점 영구 버프만 유지됩니다.
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              paddingRight: 6,
            }}
          >
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: entry.isYakuman
                    ? 'linear-gradient(135deg, rgba(127,29,29,0.35), rgba(30,27,75,0.45))'
                    : 'rgba(30, 41, 59, 0.72)',
                  border: entry.isYakuman
                    ? '1px solid rgba(248,113,113,0.55)'
                    : '1px solid rgba(148,163,184,0.25)',
                  borderRadius: 12,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 17, fontWeight: 900, color: entry.isYakuman ? '#fca5a5' : '#f8fafc' }}>
                    {entry.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fde047' }}>
                    {entry.isYakuman
                      ? entry.openHan
                        ? '역만 (후로 가능)'
                        : '역만 (멘젠 한정)'
                      : `멘젠 ${entry.menzenHan}판 / 후로 ${entry.openHan !== null ? `${entry.openHan}판` : '불가'}`}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1' }}>{entry.conditionText}</div>
                <div style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>
                  효과: {entry.buffText}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {entry.exampleCodes.slice(0, 14).map((code, idx) => (
                    <TileCard key={idx} code={code} mini />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
