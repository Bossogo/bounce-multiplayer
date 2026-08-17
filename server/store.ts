import type { GameSnapshot, PlayerId } from '../shared/protocol.js';
import { isRedisConfigured } from './env.js';

export interface SeatRecord {
  name: string;
}

export interface RoomRecord {
  snapshot: GameSnapshot;
  seats: Partial<Record<PlayerId, SeatRecord>>;
  pendingBounce: PlayerId[];
}

export interface RoomStore {
  get(code: string): Promise<RoomRecord | null>;
  set(code: string, record: RoomRecord): Promise<void>;
  del(code: string): Promise<void>;
  tryLead(code: string, owner: string, ttlSec: number): Promise<boolean>;
}

class MemoryStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();
  private leaders = new Map<string, { owner: string; until: number }>();

  async get(code: string): Promise<RoomRecord | null> {
    return this.rooms.get(code) ?? null;
  }

  async set(code: string, record: RoomRecord): Promise<void> {
    this.rooms.set(code, record);
  }

  async del(code: string): Promise<void> {
    this.rooms.delete(code);
    this.leaders.delete(code);
  }

  async tryLead(code: string, owner: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    const current = this.leaders.get(code);
    if (!current || current.until < now || current.owner === owner) {
      this.leaders.set(code, { owner, until: now + ttlSec * 1000 });
      return true;
    }
    return false;
  }
}

class RedisStore implements RoomStore {
  private url = process.env.UPSTASH_REDIS_REST_URL!;
  private token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  private roomKey(code: string): string {
    return `bounce:room:${code}`;
  }

  private leadKey(code: string): string {
    return `bounce:lead:${code}`;
  }

  private async command<T>(args: Array<string | number>): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(`Redis command failed (${res.status})`);
    }
    const payload = (await res.json()) as { result: T };
    return payload.result;
  }

  async get(code: string): Promise<RoomRecord | null> {
    const raw = await this.command<string | null>(['GET', this.roomKey(code)]);
    if (!raw) return null;
    return JSON.parse(raw) as RoomRecord;
  }

  async set(code: string, record: RoomRecord): Promise<void> {
    await this.command(['SET', this.roomKey(code), JSON.stringify(record), 'EX', 3600]);
  }

  async del(code: string): Promise<void> {
    await this.command(['DEL', this.roomKey(code), this.leadKey(code)]);
  }

  async tryLead(code: string, owner: string, ttlSec: number): Promise<boolean> {
    const key = this.leadKey(code);
    const current = await this.command<string | null>(['GET', key]);
    if (current === owner) {
      await this.command(['EXPIRE', key, ttlSec]);
      return true;
    }
    const ok = await this.command<string | null>(['SET', key, owner, 'NX', 'EX', ttlSec]);
    return ok === 'OK';
  }
}

let store: RoomStore | null = null;

export function getStore(): RoomStore {
  if (!store) {
    store = isRedisConfigured() ? new RedisStore() : new MemoryStore();
  }
  return store;
}
