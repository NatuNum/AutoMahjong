import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { ENEMY_SPECS, WAVE_COMPOSITIONS } from './config/enemies';
import { ALLY_COLS, COMBAT_DT, GRID_ROWS, MAX_BENCH_CAPACITY } from './config/stats';
import { TILE_META } from './config/tiles';
import {
  type CombatSimulation,
  buildCombatSummary,
  createCombatSimulation,
  stepCombatTick,
} from './core/combatEngine';
import { countLogicalGridTiles, isKanGroup } from './core/gridOps';
import {
  beginYakuTrigger,
  boardMoveLockedGroup,
  boardMovePairToHead,
  boardMoveTileToBench,
  boardMoveTileToGrid,
  boardRotateLockedGroup,
  buyShopOffer,
  cancelGridReplace,
  createInitialRun,
  discardOwnedTile,
  discardTsumo,
  enterCombatPhase,
  evaluateCurrentHand,
  executeFuro,
  executeSelfKan,
  finishCombatAndApplyResult,
  getActiveFuroCandidates,
  getActiveKanCandidates,
  getMagicalDrawAvailability,
  passOrFinishFuro,
  placeTsumoToBench,
  placeTsumoToGrid,
  proceedAfterRoundResult,
  rerollShop,
  resolveGridReplace,
  startDrawLoopFromPreShop,
  useDismantleTicket,
  useMagicalDraw,
  useRankShiftTicket,
} from './core/runController';
import { clearSavedGameState, loadGameState, saveGameState } from './core/storage';
import type { GameState, InventoryItem, LockedGroup, TileInstance, UnitTier } from './core/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH, renderCombatFrame } from './renderer/combatCanvas';
import { MagicalDrawModal, RankShiftModal } from './ui/ConsumableModals';
import { DrawFuroBar } from './ui/DrawFuroBar';
import { GameOverModal, RoundResultModal, YakuTriggerOverlay } from './ui/RoundAndGameModals';
import { ShopModal } from './ui/ShopModal';
import { TileCard } from './ui/TileCard';
import { YakuCodexModal } from './ui/YakuCodexModal';
import { YakuPanel } from './ui/YakuPanel';

type DragPayload =
  | { kind: 'TILE'; tileId: string }
  | { kind: 'LOCKED_GROUP'; groupId: string }
  | { kind: 'TSUMO' };

export const App: React.FC = () => {
  const [state, setState] = useState<GameState>(() => loadGameState() ?? createInitialRun());
  const [scale, setScale] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [showCodex, setShowCodex] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [muted, setMuted] = useState(false);

  // Selection / Consumable targeting states
  const [selectedReplaceTileId, setSelectedReplaceTileId] = useState<string | null>(null);
  const [activeConsumable, setActiveConsumable] = useState<InventoryItem | null>(null);
  const [rankShiftTargetTile, setRankShiftTargetTile] = useState<TileInstance | null>(null);
  const [hoveredLockGroupId, setHoveredLockGroupId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Combat state refs & HUD counters
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const combatSimRef = useRef<CombatSimulation | null>(null);
  const [combatSpeed, setCombatSpeed] = useState<1 | 2 | 3>(1);
  const combatSpeedRef = useRef<1 | 2 | 3>(1);
  const [combatHud, setCombatHud] = useState({
    elapsed: 0,
    aliveAllies: 0,
    aliveEnemies: 0,
    log: [] as string[],
  });

  useEffect(() => {
    combatSpeedRef.current = combatSpeed;
  }, [combatSpeed]);

  // 1920x1080 fixed aspect ratio scaling
  useEffect(() => {
    const updateScale = () => {
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setScale(s);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Auto-save to localStorage
  useEffect(() => {
    saveGameState(state);
  }, [state]);

  // Auto-open Shop modal when entering PRE_SHOP
  useEffect(() => {
    if (state.phase === 'PRE_SHOP') {
      setShowShop(true);
    } else if (state.phase !== 'POST_SHOP_PREP') {
      setShowShop(false);
    }
  }, [state.phase]);

  // Auto-skip FURO_SKIP_WAIT after 350ms (Guardrail #6)
  useEffect(() => {
    if (state.phase === 'DRAW_LOOP' && state.drawSubPhase === 'FURO_SKIP_WAIT') {
      const timer = window.setTimeout(() => {
        setState((prev) => passOrFinishFuro(prev).state);
      }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [state.phase, state.drawSubPhase, state.drawRemaining]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Keyboard shortcut: R key rotates hovered locked Chi/Pon group
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && hoveredLockGroupId) {
        setState((prev) => {
          const { state: next, res } = boardRotateLockedGroup(prev, hoveredLockGroupId);
          if (res.ok) soundEngine.playTilePlace();
          return next;
        });
      }
      if (e.key === 'Escape') {
        setActiveConsumable(null);
        setRankShiftTargetTile(null);
        setShowCodex(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoveredLockGroupId]);

  // Memoized hand evaluation & furo/kan detections
  const evaluation = useMemo(() => evaluateCurrentHand(state), [state]);
  const furoCandidates = useMemo(() => getActiveFuroCandidates(state), [state]);
  const kanCandidates = useMemo(() => getActiveKanCandidates(state), [state]);
  const logicalGridCount = useMemo(
    () => countLogicalGridTiles(state.tiles, state.lockedGroups),
    [state.tiles, state.lockedGroups],
  );

  // Map tileId -> evaluated tier for visual highlighting
  const tileTierMap = useMemo(() => {
    const map = new Map<string, UnitTier>();
    for (const g of evaluation.groups) {
      for (const tid of g.tileIds) {
        map.set(tid, g.kind);
      }
    }
    return map;
  }, [evaluation.groups]);

  const lockGroupMap = useMemo(() => {
    const map = new Map<string, LockedGroup>();
    for (const lg of state.lockedGroups) {
      map.set(lg.groupId, lg);
    }
    return map;
  }, [state.lockedGroups]);

  // Combat loop (fixed 30Hz tick + 60fps Canvas render)
  useEffect(() => {
    if (state.phase !== 'COMBAT') {
      combatSimRef.current = null;
      return;
    }

    const sim = createCombatSimulation(state, evaluation);
    combatSimRef.current = sim;
    setCombatHud({
      elapsed: 0,
      aliveAllies: sim.units.filter((u) => u.side === 'PLAYER' && u.alive).length,
      aliveEnemies: sim.units.filter((u) => u.side === 'ENEMY' && u.alive).length,
      log: [...sim.combatLog],
    });

    let rafId = 0;
    let lastTime = performance.now();
    let acc = 0;
    let uiSyncTimer = 0;

    const loop = (now: number) => {
      const frameDt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      acc += frameDt * combatSpeedRef.current;

      while (acc >= COMBAT_DT && !sim.finished) {
        stepCombatTick(sim);
        acc -= COMBAT_DT;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderCombatFrame(ctx, sim, acc / COMBAT_DT);
        }
      }

      uiSyncTimer += frameDt;
      if (uiSyncTimer >= 0.1 || sim.finished) {
        uiSyncTimer = 0;
        setCombatHud({
          elapsed: sim.elapsedSec,
          aliveAllies: sim.units.filter((u) => u.side === 'PLAYER' && u.alive).length,
          aliveEnemies: sim.units.filter((u) => u.side === 'ENEMY' && u.alive).length,
          log: [...sim.combatLog],
        });
      }

      if (sim.finished) {
        if (sim.won) soundEngine.playVictory();
        else soundEngine.playDefeat();
        const summary = buildCombatSummary(sim);
        window.setTimeout(() => {
          setState((prev) => finishCombatAndApplyResult(prev, summary).state);
        }, 450);
        return;
      }

      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // --- Action Handlers ---
  const applyResult = (
    fn: (s: GameState) => { state: GameState; res: { ok: boolean; reason?: string } },
    onSuccessSound?: () => void,
  ) => {
    setState((prev) => {
      const { state: next, res } = fn(prev);
      if (res.ok) {
        onSuccessSound?.();
        return next;
      }
      if (res.reason) showToast(res.reason);
      return prev;
    });
  };

  const handleDragStart = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  const parseDragPayload = (e: React.DragEvent): DragPayload | null => {
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return null;
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  };

  const handleDropOnGridCell = (e: React.DragEvent, row: number, col: number) => {
    e.preventDefault();
    setDragOverKey(null);
    const payload = parseDragPayload(e);
    if (!payload) return;

    if (payload.kind === 'TSUMO') {
      setSelectedReplaceTileId(null);
      applyResult(
        (s) => placeTsumoToGrid(s, { row, col }),
        () => soundEngine.playTilePlace(),
      );
      return;
    }
    if (payload.kind === 'LOCKED_GROUP') {
      applyResult(
        (s) => boardMoveLockedGroup(s, payload.groupId, { row, col }),
        () => soundEngine.playTilePlace(),
      );
      return;
    }
    applyResult(
      (s) => boardMoveTileToGrid(s, payload.tileId, { row, col }),
      () => soundEngine.playTilePlace(),
    );
  };

  const handleDropOnBenchSlot = (e: React.DragEvent, benchIdx: number) => {
    e.preventDefault();
    setDragOverKey(null);
    const payload = parseDragPayload(e);
    if (!payload) return;

    if (payload.kind === 'TSUMO') {
      applyResult(
        (s) => placeTsumoToBench(s, benchIdx),
        () => soundEngine.playTilePlace(),
      );
      return;
    }
    if (payload.kind === 'LOCKED_GROUP') {
      showToast('후로/깡 고정 패는 대기필드로 이동할 수 없습니다.');
      return;
    }
    applyResult(
      (s) => boardMoveTileToBench(s, payload.tileId, benchIdx),
      () => soundEngine.playTilePlace(),
    );
  };

  const handleDropOnHead = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverKey(null);
    const payload = parseDragPayload(e);
    if (!payload || payload.kind !== 'TILE') {
      showToast('동일한 비고정 패 2장(또이쯔)만 머리 슬롯에 배치할 수 있습니다.');
      return;
    }
    applyResult(
      (s) => boardMovePairToHead(s, payload.tileId),
      () => soundEngine.playTilePlace(),
    );
  };

  const handleDropOnTrash = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverKey(null);
    const payload = parseDragPayload(e);
    if (!payload) return;
    if (payload.kind === 'TSUMO') {
      applyResult(discardTsumo, () => soundEngine.playTileDiscard());
      return;
    }
    if (payload.kind === 'LOCKED_GROUP') {
      showToast('후로/깡 고정 패는 버릴 수 없습니다. 해체권을 사용하세요.');
      return;
    }
    applyResult(
      (s) => discardOwnedTile(s, payload.tileId),
      () => soundEngine.playTileDiscard(),
    );
  };

  const handleTileClick = (tile: TileInstance) => {
    // 1. Grid replacement selection
    if (state.drawSubPhase === 'GRID_REPLACE' && tile.location === 'GRID' && !tile.lockGroupId) {
      setSelectedReplaceTileId(tile.id);
      return;
    }
    // 2. Consumable targeting: Dismantle
    if (activeConsumable?.itemId === 'DISMANTLE_TICKET') {
      if (!tile.lockGroupId) {
        showToast('잠긴 후로 멘쯔 또는 깡 유닛을 클릭하세요.');
        return;
      }
      applyResult(
        (s) => useDismantleTicket(s, activeConsumable.instanceId, tile.lockGroupId!),
        () => {
          soundEngine.playFuroCall();
          setActiveConsumable(null);
        },
      );
      return;
    }
    // 3. Consumable targeting: Rank Shift
    if (activeConsumable?.itemId === 'RANK_SHIFT_TICKET') {
      setRankShiftTargetTile(tile);
      return;
    }
  };

  // Pre-build quick lookup maps for rendering 6x6 ally grid & enemy preview
  const gridTileAt = useMemo(() => {
    const map = new Map<string, TileInstance>();
    for (const t of state.tiles) {
      if (t.location === 'GRID' && t.gridPos) {
        const key = `${t.gridPos.row},${t.gridPos.col}`;
        if (!map.has(key)) map.set(key, t);
      }
    }
    return map;
  }, [state.tiles]);

  const enemyPreviewAt = useMemo(() => {
    const map = new Map<string, (typeof WAVE_COMPOSITIONS)['SWARM'][number]>();
    for (const entry of WAVE_COMPOSITIONS[state.currentWaveArchetype]) {
      map.set(`${entry.pos.row},${entry.pos.col}`, entry);
    }
    return map;
  }, [state.currentWaveArchetype]);

  const headTiles = useMemo(
    () => state.tiles.filter((t) => t.location === 'HEAD'),
    [state.tiles],
  );
  const benchTileByIdx = useMemo(() => {
    const map = new Map<number, TileInstance>();
    for (const t of state.tiles) {
      if (t.location === 'BENCH' && t.benchIndex !== null) {
        map.set(t.benchIndex, t);
      }
    }
    return map;
  }, [state.tiles]);

  const magicalDrawAvail = useMemo(
    () =>
      activeConsumable?.itemId === 'MAGICAL_DRAW'
        ? getMagicalDrawAvailability(state)
        : null,
    [activeConsumable, state],
  );

  const isCombat = state.phase === 'COMBAT';

  return (
    <div className="viewport-root">
      <div className="stage-1920" style={{ transform: `scale(${scale})` }}>
        {/* Top HUD */}
        <header className="top-hud">
          <div className="hud-group">
            <span className="brand-title">🀄 AUTO MAHJONG</span>
            <div className="hud-pill gold">라운드 {state.round}</div>
            <div className="hud-pill danger">
              {'♥'.repeat(state.lives)}
              {'♡'.repeat(Math.max(0, 3 - state.lives))}
            </div>
            <div className="hud-pill gold">💰 {state.points} 점봉</div>
            <div className="hud-pill">
              장풍: <b style={{ color: '#818cf8' }}>{TILE_META[state.roundWind].shortLabel}</b>
              <span style={{ opacity: 0.4 }}>|</span>
              자풍: <b style={{ color: '#38bdf8' }}>{TILE_META[state.seatWind].shortLabel}</b>
            </div>
            <div className="dora-strip">
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fde047' }}>★ 도라:</span>
              {state.doraIndicators.slice(0, 5).map((code, idx) => (
                <TileCard key={idx} code={code} mini />
              ))}
              {state.doraIndicators.length > 5 && (
                <span style={{ fontSize: 12, color: '#fde047' }}>
                  +{state.doraIndicators.length - 5}
                </span>
              )}
            </div>
          </div>

          <div className="hud-group">
            <div className="hud-pill">
              예정 적:{' '}
              <b style={{ color: state.currentWaveArchetype === 'BOSS' ? '#f87171' : '#e2e8f0' }}>
                {ENEMY_SPECS[state.currentWaveArchetype].name} ({state.currentWaveArchetype})
              </b>
            </div>
            <button className="btn btn-sky" onClick={() => setShowCodex(true)}>
              📖 족보 도감
            </button>
            <button
              className="btn"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                soundEngine.setMuted(next);
              }}
            >
              {muted ? '🔇 음소거' : '🔊 효과음'}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                clearSavedGameState();
                setActiveConsumable(null);
                setSelectedReplaceTileId(null);
                setState(createInitialRun());
              }}
            >
              새 런
            </button>
          </div>
        </header>

        {/* Main 3-column body */}
        <main className="main-stage">
          {/* Left Column: Head Slot + Consumable Inventory + Permanent Buffs */}
          <aside className="left-col">
            <div
              className={`head-zone ${dragOverKey === 'HEAD' ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey('HEAD');
              }}
              onDragLeave={() => setDragOverKey(null)}
              onDrop={handleDropOnHead}
            >
              <div className="panel-title" style={{ width: '100%' }}>
                <span>머리 슬롯 (또이쯔)</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>2×1</span>
              </div>
              <div className="head-slots-row">
                {[0, 1].map((slotIdx) => {
                  const tile = headTiles[slotIdx];
                  return (
                    <div key={slotIdx} className="head-slot-box">
                      {tile && (
                        <TileCard
                          code={tile.code}
                          isDora={state.doraIndicators.includes(tile.code)}
                          draggable={!isCombat}
                          onDragStart={(e) => handleDragStart(e, { kind: 'TILE', tileId: tile.id })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="aura-badge">
                {evaluation.statModifiers.headAuraBonus > 0
                  ? evaluation.statModifiers.headAuraIsYakuhai
                    ? '역패 오라: 올스탯 +10%'
                    : '일반 오라: 올스탯 +5%'
                  : '동일 패 2장 배치 시 오라'}
              </div>
              {evaluation.deployHeadTiles && (
                <div style={{ fontSize: 11, color: '#fde047', fontWeight: 800 }}>
                  ★ 전투 시작 시 그리드 자동 합류!
                </div>
              )}
            </div>

            <div className="panel-card" style={{ flex: 1, minHeight: 0 }}>
              <div className="panel-title">
                <span>소모품 인벤토리</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{state.inventory.length}개</span>
              </div>
              {activeConsumable && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#fde047',
                    background: 'rgba(250,204,21,0.14)',
                    padding: '6px 8px',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>
                    {activeConsumable.itemId === 'DISMANTLE_TICKET'
                      ? '해체할 후로/깡 클릭'
                      : '변경할 수패 클릭'}
                  </span>
                  <button
                    className="btn"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => setActiveConsumable(null)}
                  >
                    취소
                  </button>
                </div>
              )}
              <div className="inventory-list">
                {state.inventory.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 14 }}>
                    상점에서 구매한 소모품이 이곳에 보관됩니다.
                  </div>
                ) : (
                  state.inventory.map((inv) => {
                    const isActive = activeConsumable?.instanceId === inv.instanceId;
                    const label =
                      inv.itemId === 'DISMANTLE_TICKET'
                        ? '🔓 후로/깡 해체권'
                        : inv.itemId === 'RANK_SHIFT_TICKET'
                          ? '🔢 패 숫자 ±1 변경권'
                          : '✨ 매지컬 드로우';
                    return (
                      <button
                        key={inv.instanceId}
                        className={`inv-item-btn ${isActive ? 'active' : ''}`}
                        disabled={isCombat}
                        onClick={() =>
                          setActiveConsumable(isActive ? null : inv)
                        }
                      >
                        <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>클릭하여 사용</span>
                      </button>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  borderTop: '1px solid rgba(148,163,184,0.2)',
                  paddingTop: 8,
                  fontSize: 12,
                  color: '#cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ fontWeight: 800, color: '#6ee7b7' }}>상점 영구 버프</div>
                <div>
                  ATK +{Math.round(state.permanentBuffs.atkAdd * 100)}% · HP +
                  {Math.round(state.permanentBuffs.hpAdd * 100)}% · ASPD +
                  {Math.round(state.permanentBuffs.aspdAdd * 100)}%
                </div>
              </div>
            </div>
          </aside>

          {/* Center Column: 12x6 Battlefield + Action Bar */}
          <section className="center-col">
            <div className="battlefield-wrap">
              {isCombat ? (
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  style={{ width: 1224, height: 612, borderRadius: 8 }}
                />
              ) : (
                <div className="prep-grid-12x6">
                  {Array.from({ length: GRID_ROWS }, (_, r) =>
                    Array.from({ length: 12 }, (_, c) => {
                      const isAlly = c < ALLY_COLS;
                      const key = `${r},${c}`;
                      const tile = isAlly ? gridTileAt.get(key) : undefined;
                      const enemyPrev = !isAlly ? enemyPreviewAt.get(key) : undefined;
                      const lg = tile?.lockGroupId ? lockGroupMap.get(tile.lockGroupId) : undefined;
                      const isReplaceTarget =
                        state.drawSubPhase === 'GRID_REPLACE' &&
                        tile !== undefined &&
                        tile.lockGroupId === null;
                      const isSelectedReplace =
                        isReplaceTarget && selectedReplaceTileId === tile?.id;

                      const cellClasses = [
                        'grid-cell',
                        isAlly
                          ? (r + c) % 2 === 0
                            ? 'ally-even'
                            : 'ally-odd'
                          : (r + c) % 2 === 0
                            ? 'enemy-even'
                            : 'enemy-odd',
                        c === ALLY_COLS - 1 ? 'frontline-border' : '',
                        dragOverKey === `G_${key}` ? 'drag-over' : '',
                        isReplaceTarget ? 'replace-candidate' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');

                      return (
                        <div
                          key={key}
                          className={cellClasses}
                          style={
                            isSelectedReplace
                              ? { background: 'rgba(56, 189, 248, 0.35)', outline: '3px solid #38bdf8' }
                              : undefined
                          }
                          onDragOver={
                            isAlly
                              ? (e) => {
                                  e.preventDefault();
                                  setDragOverKey(`G_${key}`);
                                }
                              : undefined
                          }
                          onDragLeave={isAlly ? () => setDragOverKey(null) : undefined}
                          onDrop={isAlly ? (e) => handleDropOnGridCell(e, r, c) : undefined}
                          onMouseEnter={() => {
                            if (lg && !isKanGroup(lg)) setHoveredLockGroupId(lg.groupId);
                          }}
                          onMouseLeave={() => {
                            if (lg && hoveredLockGroupId === lg.groupId) {
                              setHoveredLockGroupId(null);
                            }
                          }}
                        >
                          {tile && (
                            <TileCard
                              code={tile.code}
                              tier={tileTierMap.get(tile.id)}
                              isDora={state.doraIndicators.includes(tile.code)}
                              isLocked={tile.lockGroupId !== null}
                              lockLabel={
                                lg
                                  ? lg.type === 'ANKAN'
                                    ? '안깡'
                                    : lg.type === 'MINKAN'
                                      ? '밍깡'
                                      : lg.type === 'KAKAN'
                                        ? '가깡'
                                        : lg.type === 'CHI'
                                          ? '치(우클릭회전)'
                                          : '퐁(우클릭회전)'
                                  : undefined
                              }
                              isClaimedRotated={
                                lg !== undefined &&
                                !isKanGroup(lg) &&
                                lg.claimedTileId === tile.id
                              }
                              draggable={!isCombat}
                              onDragStart={(e) =>
                                handleDragStart(
                                  e,
                                  lg
                                    ? { kind: 'LOCKED_GROUP', groupId: lg.groupId }
                                    : { kind: 'TILE', tileId: tile.id },
                                )
                              }
                              onClick={() => handleTileClick(tile)}
                              onContextMenu={(e) => {
                                if (lg && !isKanGroup(lg)) {
                                  e.preventDefault();
                                  applyResult(
                                    (s) => boardRotateLockedGroup(s, lg.groupId),
                                    () => soundEngine.playTilePlace(),
                                  );
                                }
                              }}
                            />
                          )}

                          {enemyPrev && (
                            <div
                              className="enemy-preview-token"
                              style={{
                                background: ENEMY_SPECS[enemyPrev.archetype].color,
                                borderColor: ENEMY_SPECS[enemyPrev.archetype].accentColor,
                              }}
                            >
                              <span>
                                {enemyPrev.archetype === 'BOSS'
                                  ? '보스'
                                  : enemyPrev.archetype === 'BRUISER'
                                    ? '중갑'
                                    : enemyPrev.archetype === 'SNIPER'
                                      ? '저격'
                                      : '요괴'}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }),
                  )}
                </div>
              )}
            </div>

            <DrawFuroBar
              state={state}
              furoCandidates={furoCandidates}
              kanCandidates={kanCandidates}
              selectedReplaceTileId={selectedReplaceTileId}
              combatSpeed={combatSpeed}
              combatElapsedSec={combatHud.elapsed}
              aliveAllies={combatHud.aliveAllies}
              aliveEnemies={combatHud.aliveEnemies}
              onStartDrawLoop={() =>
                applyResult(startDrawLoopFromPreShop, () => soundEngine.playTilePlace())
              }
              onOpenShop={() => setShowShop(true)}
              onPlaceTsumoGrid={() => {
                setSelectedReplaceTileId(null);
                applyResult((s) => placeTsumoToGrid(s), () => soundEngine.playTilePlace());
              }}
              onPlaceTsumoBench={() =>
                applyResult((s) => placeTsumoToBench(s), () => soundEngine.playTilePlace())
              }
              onDiscardTsumo={() =>
                applyResult(discardTsumo, () => soundEngine.playTileDiscard())
              }
              onDragStartTsumo={(e) => handleDragStart(e, { kind: 'TSUMO' })}
              onExecuteKan={(cand) =>
                applyResult((s) => executeSelfKan(s, cand), () => soundEngine.playKanBoom())
              }
              onResolveReplace={(dest) => {
                if (!selectedReplaceTileId) return;
                applyResult(
                  (s) => resolveGridReplace(s, selectedReplaceTileId, dest),
                  () => {
                    if (dest === 'DISCARD') soundEngine.playTileDiscard();
                    else soundEngine.playTilePlace();
                    setSelectedReplaceTileId(null);
                  },
                );
              }}
              onCancelReplace={() => {
                setSelectedReplaceTileId(null);
                applyResult(cancelGridReplace);
              }}
              onExecuteFuro={(candId) =>
                applyResult(
                  (s) => executeFuro(s, candId),
                  () => {
                    soundEngine.playFuroCall();
                    setSelectedReplaceTileId(null);
                  },
                )
              }
              onPassFuro={() => applyResult(passOrFinishFuro)}
              onStartCombat={() => applyResult(beginYakuTrigger)}
              onChangeCombatSpeed={setCombatSpeed}
            />
          </section>

          {/* Right Sidebar: Live Yaku & Stat Preview */}
          <aside style={{ minHeight: 0 }}>
            <YakuPanel
              evaluation={evaluation}
              logicalGridCount={logicalGridCount}
              combatLog={combatHud.log}
              isCombat={isCombat}
            />
          </aside>
        </main>

        {/* Bottom Bench + Free Trash Drop Zone */}
        <footer className="bottom-bench-bar">
          <div style={{ minWidth: 110 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fde047' }}>대기필드</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {state.tiles.filter((t) => t.location === 'BENCH').length} / {state.benchCapacity}칸
            </div>
          </div>

          <div className="bench-slots-grid">
            {Array.from({ length: MAX_BENCH_CAPACITY }, (_, idx) => {
              const unlocked = idx < state.benchCapacity;
              const tile = benchTileByIdx.get(idx);
              return (
                <div
                  key={idx}
                  className={`bench-slot ${unlocked ? '' : 'locked-slot'} ${
                    dragOverKey === `B_${idx}` ? 'drag-over' : ''
                  }`}
                  onDragOver={
                    unlocked
                      ? (e) => {
                          e.preventDefault();
                          setDragOverKey(`B_${idx}`);
                        }
                      : undefined
                  }
                  onDragLeave={unlocked ? () => setDragOverKey(null) : undefined}
                  onDrop={unlocked ? (e) => handleDropOnBenchSlot(e, idx) : undefined}
                >
                  {!unlocked ? (
                    <span style={{ fontSize: 11, color: '#64748b' }}>🔒</span>
                  ) : tile ? (
                    <TileCard
                      code={tile.code}
                      isDora={state.doraIndicators.includes(tile.code)}
                      draggable={!isCombat}
                      onDragStart={(e) => handleDragStart(e, { kind: 'TILE', tileId: tile.id })}
                      onClick={() => handleTileClick(tile)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            className={`trash-zone ${dragOverKey === 'TRASH' ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverKey('TRASH');
            }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={handleDropOnTrash}
          >
            <span style={{ fontSize: 22 }}>🗑️</span>
            <span>무료 버리기</span>
            <span style={{ fontSize: 11, color: '#fecaca' }}>패를 이곳에 드롭</span>
          </div>
        </footer>

        {/* Modals & Overlays */}
        {showShop && (state.phase === 'PRE_SHOP' || state.phase === 'POST_SHOP_PREP') && (
          <ShopModal
            state={state}
            onBuy={(offerId) =>
              applyResult((s) => buyShopOffer(s, offerId), () => soundEngine.playShopBuy())
            }
            onReroll={() => applyResult(rerollShop, () => soundEngine.playTilePlace())}
            onClose={() => setShowShop(false)}
            onStartDrawLoop={
              state.phase === 'PRE_SHOP'
                ? () => {
                    setShowShop(false);
                    applyResult(startDrawLoopFromPreShop, () => soundEngine.playTilePlace());
                  }
                : undefined
            }
          />
        )}

        {magicalDrawAvail && activeConsumable?.itemId === 'MAGICAL_DRAW' && (
          <MagicalDrawModal
            availability={magicalDrawAvail}
            onSelect={(code) =>
              applyResult(
                (s) => useMagicalDraw(s, activeConsumable.instanceId, code),
                () => {
                  soundEngine.playShopBuy();
                  setActiveConsumable(null);
                },
              )
            }
            onClose={() => setActiveConsumable(null)}
          />
        )}

        {rankShiftTargetTile && activeConsumable?.itemId === 'RANK_SHIFT_TICKET' && (
          <RankShiftModal
            tile={rankShiftTargetTile}
            onShift={(delta) =>
              applyResult(
                (s) => useRankShiftTicket(s, activeConsumable.instanceId, rankShiftTargetTile.id, delta),
                () => {
                  soundEngine.playTilePlace();
                  setRankShiftTargetTile(null);
                  setActiveConsumable(null);
                },
              )
            }
            onClose={() => setRankShiftTargetTile(null)}
          />
        )}

        {showCodex && <YakuCodexModal onClose={() => setShowCodex(false)} />}

        {state.phase === 'YAKU_TRIGGER' && (
          <YakuTriggerOverlay
            evaluation={evaluation}
            onComplete={() => applyResult(enterCombatPhase)}
          />
        )}

        {state.phase === 'ROUND_RESULT' && (
          <RoundResultModal
            state={state}
            onProceed={() => applyResult(proceedAfterRoundResult)}
          />
        )}

        {state.phase === 'GAME_OVER' && (
          <GameOverModal
            state={state}
            onRestart={() => {
              clearSavedGameState();
              setState(createInitialRun());
            }}
          />
        )}

        {toast && <div className="toast-msg">{toast}</div>}
      </div>
    </div>
  );
};
