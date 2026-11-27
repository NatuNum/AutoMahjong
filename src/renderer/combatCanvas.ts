import { ENEMY_SPECS } from '../config/enemies';
import { ALLY_COLS, GRID_ROWS, TOTAL_GRID_COLS } from '../config/stats';
import { TILE_META } from '../config/tiles';
import type { CombatSimulation } from '../core/combatEngine';
import type { CombatUnit } from '../core/types';

export const CANVAS_WIDTH = 1224;
export const CANVAS_HEIGHT = 612;
export const CELL_SIZE = 102; // 12 * 102 = 1224, 6 * 102 = 612

function cellCenter(row: number, col: number): [number, number] {
  return [col * CELL_SIZE + CELL_SIZE * 0.5, row * CELL_SIZE + CELL_SIZE * 0.5];
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAllyUnit(
  ctx: CanvasRenderingContext2D,
  u: CombatUnit,
  cx: number,
  cy: number,
): void {
  const meta = u.tileCode !== null ? TILE_META[u.tileCode] : null;
  const scale = u.isGiant ? 1.18 : 0.88;
  const w = 72 * scale;
  const h = 84 * scale;
  const x = cx - w / 2;
  const y = cy - h / 2;

  // Aura glow for high tiers or invulnerability
  if (u.invulnTimer > 0) {
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, x - 5, y - 5, w + 10, h + 10, 12);
    ctx.stroke();
    ctx.restore();
  } else if (u.tier === 'ANKAN' || u.tier === 'MINKAN' || u.tier === 'KAKAN') {
    ctx.save();
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fef3c7';
    drawRoundedRect(ctx, x - 3, y - 3, w + 6, h + 6, 10);
    ctx.fill();
    ctx.restore();
  }

  // Tile body
  ctx.fillStyle = '#fffdf7';
  drawRoundedRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // Tier border color
  const tierColors: Record<CombatUnit['tier'], string> = {
    ISOLATED: '#94a3b8',
    TOITSU: '#38bdf8',
    SHUNTSU: '#10b981',
    KOUTSU: '#f97316',
    ANKAN: '#eab308',
    MINKAN: '#f59e0b',
    KAKAN: '#f59e0b',
  };
  ctx.strokeStyle = tierColors[u.tier];
  ctx.lineWidth = u.isGiant ? 4 : 3;
  ctx.stroke();

  if (meta) {
    ctx.fillStyle = meta.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!meta.isHonor) {
      // Arabic number top-left for readability
      ctx.font = `bold ${u.isGiant ? 18 : 14}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(String(meta.rank), x + 6, y + 14);
    }
    ctx.textAlign = 'center';
    ctx.font = `bold ${u.isGiant ? 28 : 22}px "Malgun Gothic", sans-serif`;
    ctx.fillText(meta.hanja, cx, cy - 2);

    ctx.font = `bold ${u.isGiant ? 13 : 11}px "Malgun Gothic", sans-serif`;
    ctx.fillStyle = '#334155';
    ctx.fillText(meta.shortLabel, cx, cy + h * 0.28);
  }

  // Kan badge
  if (u.tier === 'ANKAN' || u.tier === 'MINKAN' || u.tier === 'KAKAN') {
    ctx.fillStyle = u.tier === 'ANKAN' ? '#b45309' : '#ea580c';
    drawRoundedRect(ctx, x + w - 26, y - 6, 28, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('깡', x + w - 12, y + 3);
  }

  drawHealthBar(ctx, cx, y - 10, w, u);
}

function drawEnemyUnit(
  ctx: CanvasRenderingContext2D,
  u: CombatUnit,
  cx: number,
  cy: number,
): void {
  const spec = ENEMY_SPECS[u.archetype ?? 'SWARM'];
  const radius = u.archetype === 'BOSS' ? 38 : u.archetype === 'BRUISER' ? 30 : 23;

  ctx.save();
  if (u.enrageStacks > 0) {
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 18;
  }

  ctx.fillStyle = u.freezeTimer > 0 ? '#38bdf8' : spec.color;
  ctx.strokeStyle = u.stunTimer > 0 ? '#facc15' : spec.accentColor;
  ctx.lineWidth = u.archetype === 'BOSS' ? 4 : 3;

  ctx.beginPath();
  if (u.archetype === 'BRUISER') {
    // Octagon / heavy diamond
    const r = radius;
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  } else if (u.archetype === 'SNIPER') {
    // Triangle pointing left
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy - radius * 0.85);
    ctx.lineTo(cx + radius, cy + radius * 0.85);
    ctx.closePath();
  } else if (u.archetype === 'BOSS') {
    // Hexagonal demon core
    for (let k = 0; k < 6; k++) {
      const ang = (Math.PI / 3) * k - Math.PI / 6;
      const px = cx + Math.cos(ang) * radius;
      const py = cy + Math.sin(ang) * radius;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Enemy label
  ctx.fillStyle = '#f8fafc';
  ctx.font = `bold ${u.archetype === 'BOSS' ? 14 : 11}px "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shortCode =
    u.archetype === 'BOSS'
      ? '보스'
      : u.archetype === 'BRUISER'
        ? '중갑'
        : u.archetype === 'SNIPER'
          ? '저격'
          : '요괴';
  ctx.fillText(shortCode, cx, cy);

  if (u.enrageStacks > 0) {
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(`광폭×${u.enrageStacks}`, cx, cy + 16);
  }

  drawHealthBar(ctx, cx, cy - radius - 10, radius * 2.1, u);
}

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  u: CombatUnit,
): void {
  const h = 7;
  const x = cx - w / 2;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);

  const hpRatio = Math.max(0, Math.min(1, u.hp / u.maxHp));
  ctx.fillStyle = u.side === 'PLAYER' ? '#22c55e' : '#ef4444';
  ctx.fillRect(x, y, w * hpRatio, h);

  if (u.shield > 0 && u.maxShield > 0) {
    const shRatio = Math.max(0, Math.min(1, u.shield / u.maxShield));
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x, y - 4, w * shRatio, 3);
  }
}

export function renderCombatFrame(
  ctx: CanvasRenderingContext2D,
  sim: CombatSimulation,
  alpha: number,
): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Background checkerboard for 12x6 battlefield (left 6x6 ally emerald tint, right 6x6 enemy crimson tint)
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < TOTAL_GRID_COLS; c++) {
      const isAllySide = c < ALLY_COLS;
      const even = (r + c) % 2 === 0;
      if (isAllySide) {
        ctx.fillStyle = even ? '#0f2922' : '#13332a';
      } else {
        ctx.fillStyle = even ? '#261722' : '#2f1c29';
      }
      ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);

      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  // Center frontline divider
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ALLY_COLS * CELL_SIZE, 0);
  ctx.lineTo(ALLY_COLS * CELL_SIZE, CANVAS_HEIGHT);
  ctx.stroke();

  // Ryuuiisou green mist overlay
  if (sim.hasRyuuiisou) {
    ctx.fillStyle = 'rgba(22, 163, 74, 0.14)';
    ctx.fillRect(ALLY_COLS * CELL_SIZE, 0, ALLY_COLS * CELL_SIZE, CANVAS_HEIGHT);
  }

  // Boss row slam telegraphs (red pulsing warning lines)
  for (let i = 0; i < sim.telegraphs.length; i++) {
    const tel = sim.telegraphs[i];
    const progress = 1 - tel.remainingSec / tel.totalSec;
    ctx.fillStyle = `rgba(239, 68, 68, ${0.18 + progress * 0.35})`;
    ctx.fillRect(0, tel.row * CELL_SIZE + 4, ALLY_COLS * CELL_SIZE, CELL_SIZE - 8);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, tel.row * CELL_SIZE + 4, ALLY_COLS * CELL_SIZE - 4, CELL_SIZE - 8);
  }

  // Units (interpolated between prevPos and currentPos)
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    if (!u.alive) continue;
    const drawRow = u.prevRow + (u.row - u.prevRow) * clampedAlpha;
    const drawCol = u.prevCol + (u.col - u.prevCol) * clampedAlpha;
    const [cx, cy] = cellCenter(drawRow, drawCol);
    if (u.side === 'PLAYER') {
      drawAllyUnit(ctx, u, cx, cy);
    } else {
      drawEnemyUnit(ctx, u, cx, cy);
    }
  }

  // Visual events (projectiles, pierce beams, splash rings, boss slam, damage numbers)
  for (let i = 0; i < sim.events.length; i++) {
    const ev = sim.events[i];
    const ratio = Math.max(0, ev.ttl / ev.maxTtl);
    ctx.save();
    ctx.globalAlpha = ratio;

    if (ev.kind === 'PROJECTILE' && ev.fromRow !== undefined && ev.fromCol !== undefined) {
      const [fx, fy] = cellCenter(ev.fromRow, ev.fromCol);
      const [tx, ty] = cellCenter(ev.toRow, ev.toCol);
      const prog = 1 - ratio;
      const px = fx + (tx - fx) * prog;
      const py = fy + (ty - fy) * prog;
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.fillStyle = ev.color;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (ev.kind === 'PIERCE_BEAM' && ev.fromRow !== undefined && ev.fromCol !== undefined) {
      const [fx, fy] = cellCenter(ev.fromRow, ev.fromCol);
      const [tx, ty] = cellCenter(ev.toRow, ev.toCol);
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 10 * ratio + 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    } else if (ev.kind === 'SPLASH_RING') {
      const [tx, ty] = cellCenter(ev.toRow, ev.toCol);
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(tx, ty, CELL_SIZE * (1.25 - ratio * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    } else if (ev.kind === 'BOSS_SLAM') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.fillRect(0, ev.toRow * CELL_SIZE, ALLY_COLS * CELL_SIZE, CELL_SIZE);
    } else if (ev.kind === 'YAKUMAN_FX') {
      const [tx, ty] = cellCenter(ev.toRow, ev.toCol);
      ctx.fillStyle = ev.color;
      ctx.beginPath();
      ctx.arc(tx, ty, 36 * (1.3 - ratio * 0.5), 0, Math.PI * 2);
      ctx.fill();
      if (ev.label) {
        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 28px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ev.label, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      }
    } else if (ev.kind === 'DAMAGE_TEXT' && ev.value !== undefined) {
      const [tx, ty] = cellCenter(ev.toRow, ev.toCol);
      const floatY = ty - 28 - (1 - ratio) * 26;
      ctx.fillStyle = ev.color;
      ctx.font = `bold ${ev.isCrit ? 22 : 16}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(ev.isCrit ? `${ev.value}!` : String(ev.value), tx, floatY);
    }

    ctx.restore();
  }
}
