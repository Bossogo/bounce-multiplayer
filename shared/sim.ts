import {
  BOUNCE_VELOCITY,
  FLOOR_Y,
  GRAVITY,
  MAX_FALL_SPEED,
  OBSTACLE_HEIGHT,
  OBSTACLE_MIN_GAP,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  WORLD_WIDTH,
  type GameSnapshot,
  type ObstacleState,
  type PlayerId,
  type PlayerState,
} from './protocol.js';

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createInitialPlayers(
  names: Partial<Record<PlayerId, string>> = {},
): PlayerState[] {
  return [
    {
      id: 'p1',
      name: names.p1 ?? 'Player 1',
      x: WORLD_WIDTH * 0.5,
      y: FLOOR_Y - PLAYER_RADIUS,
      vy: 0,
      alive: true,
      score: 0,
      color: PLAYER_COLORS.p1,
    },
    {
      id: 'p2',
      name: names.p2 ?? 'Player 2',
      x: WORLD_WIDTH * 0.5,
      y: FLOOR_Y - PLAYER_RADIUS,
      vy: 0,
      alive: true,
      score: 0,
      color: PLAYER_COLORS.p2,
    },
  ];
}

export function generateObstacles(seed: number, count = 28): ObstacleState[] {
  const rand = mulberry32(seed);
  const obstacles: ObstacleState[] = [];
  let y = FLOOR_Y - 160;

  for (let i = 0; i < count; i++) {
    const width = 70 + rand() * 90;
    const speed = 70 + rand() * 110;
    const dir: 1 | -1 = rand() > 0.5 ? 1 : -1;
    const x =
      dir === 1
        ? -width - rand() * 80
        : WORLD_WIDTH + rand() * 80;
    obstacles.push({
      id: i + 1,
      y,
      x,
      width,
      speed,
      dir,
    });
    y -= OBSTACLE_MIN_GAP + 40 + rand() * 90;
  }

  return obstacles;
}

export function applyBounce(player: PlayerState): void {
  if (!player.alive) return;
  player.vy = BOUNCE_VELOCITY;
}

export function stepPlayer(
  player: PlayerState,
  dt: number,
  opts: { floorLethal?: boolean } = {},
): void {
  if (!player.alive) return;

  player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL_SPEED);
  player.y += player.vy * dt;

  const floor = FLOOR_Y - PLAYER_RADIUS;
  if (player.y > floor) {
    if (opts.floorLethal) {
      player.y = floor;
      player.vy = 0;
      player.alive = false;
    } else {
      player.y = floor;
      player.vy = 0;
    }
  }

  const heightScore = Math.max(0, Math.floor((FLOOR_Y - player.y) / 10));
  if (heightScore > player.score) player.score = heightScore;
}

export function stepObstacles(obstacles: ObstacleState[], dt: number): void {
  for (const o of obstacles) {
    o.x += o.dir * o.speed * dt;
    if (o.dir === 1 && o.x > WORLD_WIDTH + 40) {
      o.x = -o.width - 20;
    } else if (o.dir === -1 && o.x + o.width < -40) {
      o.x = WORLD_WIDTH + 20;
    }
  }
}

function circleRectOverlap(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nearestX = Math.max(rx, Math.min(cx, rx + rw));
  const nearestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}

export function resolveCollisions(
  players: PlayerState[],
  obstacles: ObstacleState[],
): void {
  for (const player of players) {
    if (!player.alive) continue;
    for (const o of obstacles) {
      if (
        circleRectOverlap(
          player.x,
          player.y,
          PLAYER_RADIUS - 2,
          o.x,
          o.y - OBSTACLE_HEIGHT / 2,
          o.width,
          OBSTACLE_HEIGHT,
        )
      ) {
        player.alive = false;
        player.vy = 0;
        break;
      }
    }
  }
}

export function pickWinner(players: PlayerState[]): PlayerId | null {
  const alive = players.filter((p) => p.alive);
  if (alive.length === 1) return alive[0].id;
  if (alive.length === 0) {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    if (sorted[0].score === sorted[1].score) return null;
    return sorted[0].id;
  }
  return null;
}

export function createMatchSnapshot(
  code: string,
  names: Partial<Record<PlayerId, string>>,
  seed = (Math.random() * 1e9) | 0,
): GameSnapshot {
  return {
    phase: 'lobby',
    code,
    tick: 0,
    countdownMs: 0,
    playerCount: 0,
    players: createInitialPlayers(names),
    obstacles: generateObstacles(seed),
    winnerId: null,
    seed,
  };
}
