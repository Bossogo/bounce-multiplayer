import {
  FLOOR_Y,
  OBSTACLE_HEIGHT,
  PLAYER_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type GameSnapshot,
  type PlayerId,
  type PlayerState,
} from '../shared/protocol';

const CAMERA_LERP = 0.18;

export class SplitRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameras: Record<PlayerId, number> = { p1: 0, p2: 0 };
  private you: PlayerId = 'p1';
  private bounceFlash = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unsupported');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  setYou(you: PlayerId): void {
    this.you = you;
  }

  pulse(): void {
    this.bounceFlash = 1;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(snapshot: GameSnapshot, dt: number): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const ctx = this.ctx;
    this.bounceFlash = Math.max(0, this.bounceFlash - dt * 3);

    ctx.clearRect(0, 0, width, height);

    const gutter = 4;
    const paneW = (width - gutter) / 2;
    const panes: { id: PlayerId; x: number }[] = [
      { id: 'p1', x: 0 },
      { id: 'p2', x: paneW + gutter },
    ];

    for (const pane of panes) {
      const player = snapshot.players.find((p) => p.id === pane.id);
      if (!player) continue;

      const targetCam = player.y - WORLD_HEIGHT * CAMERA_FOCUS;
      const cam = this.cameras[pane.id];
      if (Math.abs(targetCam - cam) > 400) {
        this.cameras[pane.id] = targetCam;
      } else {
        this.cameras[pane.id] += (targetCam - cam) * CAMERA_LERP;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, 0, paneW, height);
      ctx.clip();

      this.drawWorld(
        pane.x,
        paneW,
        height,
        this.cameras[pane.id],
        snapshot,
        player,
        pane.id === this.you,
      );

      ctx.restore();
    }

    // Center divider
    ctx.fillStyle = 'rgba(243, 247, 244, 0.9)';
    ctx.fillRect(paneW, 0, gutter, height);

    // Pane labels
    for (const pane of panes) {
      const player = snapshot.players.find((p) => p.id === pane.id);
      if (!player) continue;
      ctx.fillStyle = 'rgba(8, 36, 34, 0.55)';
      ctx.fillRect(pane.x + 12, 12, 150, 34);
      ctx.fillStyle = '#f7fffc';
      ctx.font = '700 14px Outfit, sans-serif';
      const mine = pane.id === this.you ? ' · YOU' : '';
      ctx.fillText(`${player.name}${mine}`, pane.x + 22, 34);
    }
  }

  private drawWorld(
    offsetX: number,
    paneW: number,
    paneH: number,
    cameraY: number,
    snapshot: GameSnapshot,
    focus: PlayerState,
    isYou: boolean,
  ): void {
    const ctx = this.ctx;
    const scale = Math.min(paneW / WORLD_WIDTH, paneH / WORLD_HEIGHT);
    const drawW = WORLD_WIDTH * scale;
    const drawH = WORLD_HEIGHT * scale;
    const ox = offsetX + (paneW - drawW) / 2;
    const oy = (paneH - drawH) / 2;

    const toScreen = (x: number, y: number) => ({
      x: ox + x * scale,
      y: oy + (y - cameraY) * scale,
    });

    // Sky
    const sky = ctx.createLinearGradient(0, oy, 0, oy + drawH);
    sky.addColorStop(0, isYou ? '#7ed6c5' : '#6fb8c9');
    sky.addColorStop(0.55, '#f3e7c7');
    sky.addColorStop(1, '#d9c39a');
    ctx.fillStyle = sky;
    ctx.fillRect(offsetX, 0, paneW, paneH);

    // Parallax bands
    for (let i = 0; i < 8; i++) {
      const bandY = ((i * 140 - cameraY * 0.25) % (drawH + 140)) + oy - 70;
      ctx.fillStyle = `rgba(255,255,255,${0.04 + (i % 2) * 0.03})`;
      ctx.fillRect(offsetX, bandY, paneW, 70);
    }

    // Floor
    const floor = toScreen(0, FLOOR_Y);
    ctx.fillStyle = '#2f5d4f';
    ctx.fillRect(ox, floor.y, drawW, paneH);
    ctx.fillStyle = '#3f7a67';
    ctx.fillRect(ox, floor.y, drawW, 8 * scale);

    // Obstacles
    for (const o of snapshot.obstacles) {
      const p = toScreen(o.x, o.y - OBSTACLE_HEIGHT / 2);
      const w = o.width * scale;
      const h = OBSTACLE_HEIGHT * scale;
      if (p.y + h < -20 || p.y > paneH + 20) continue;

      ctx.fillStyle = '#f0c14a';
      roundRect(ctx, p.x, p.y, w, h, 6 * scale);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(p.x, p.y + h * 0.55, w, h * 0.45);
    }

    // Players (both ghosts in each view for awareness, focus opaque)
    for (const player of snapshot.players) {
      const p = toScreen(player.x, player.y);
      const r = PLAYER_RADIUS * scale;
      const alpha = player.id === focus.id ? 1 : 0.22;
      ctx.globalAlpha = alpha;

      if (!player.alive) {
        ctx.globalAlpha = alpha * 0.45;
      }

      ctx.beginPath();
      ctx.fillStyle = player.color;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.25, p.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      if (player.id === focus.id && isYou && this.bounceFlash > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * this.bounceFlash})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8 * this.bounceFlash, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    // Side rails
    ctx.fillStyle = 'rgba(16, 42, 45, 0.18)';
    ctx.fillRect(ox, 0, 4, paneH);
    ctx.fillRect(ox + drawW - 4, 0, 4, paneH);

    if (!focus.alive) {
      ctx.fillStyle = 'rgba(16, 20, 24, 0.35)';
      ctx.fillRect(offsetX, 0, paneW, paneH);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.floor(28 * scale)}px Space Grotesk, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('OUT', offsetX + paneW / 2, paneH * 0.45);
      ctx.textAlign = 'start';
    }
  }

  hitTestPane(clientX: number, clientY: number): PlayerId | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < 0 || y > rect.height || x < 0 || x > rect.width) return null;
    return x < rect.width / 2 ? 'p1' : 'p2';
  }
}

const CAMERA_FOCUS = 0.55;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
