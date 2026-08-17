export const TICK_RATE = 60;
export const WORLD_WIDTH = 320;
export const WORLD_HEIGHT = 560;
export const PLAYER_RADIUS = 16;
export const GRAVITY = 1800;
export const BOUNCE_VELOCITY = -720;
export const MAX_FALL_SPEED = 980;
export const FLOOR_Y = WORLD_HEIGHT - 40;
export const CAMERA_FOLLOW = 0.42;
export const OBSTACLE_HEIGHT = 18;
export const OBSTACLE_MIN_GAP = 72;
export const COUNTDOWN_MS = 3000;

export type PlayerId = 'p1' | 'p2';

export interface PlayerState {
  id: PlayerId;
  name: string;
  x: number;
  y: number;
  vy: number;
  alive: boolean;
  score: number;
  color: string;
}

export interface ObstacleState {
  id: number;
  y: number;
  x: number;
  width: number;
  speed: number;
  dir: 1 | -1;
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'finished';

export interface GameSnapshot {
  phase: RoomPhase;
  code: string;
  tick: number;
  countdownMs: number;
  playerCount: number;
  players: PlayerState[];
  obstacles: ObstacleState[];
  winnerId: PlayerId | null;
  seed: number;
}

export type ClientMessage =
  | { type: 'create'; name?: string }
  | { type: 'join'; code: string; name?: string }
  | { type: 'bounce' }
  | { type: 'ready' }
  | { type: 'rematch' };

export type ServerMessage =
  | { type: 'room'; you: PlayerId; snapshot: GameSnapshot }
  | { type: 'state'; snapshot: GameSnapshot }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export const PLAYER_COLORS: Record<PlayerId, string> = {
  p1: '#F45B69',
  p2: '#2EC4B6',
};
