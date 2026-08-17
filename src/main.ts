import './style.css';
import type { GameSnapshot, PlayerId } from '../shared/protocol';
import { LocalMatch } from './local-match';
import { NetClient } from './net';
import { SplitRenderer } from './render';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app missing');
const app = root;

const net = new NetClient();
const local = new LocalMatch();

let mode: 'attract' | 'local' | 'online' = 'attract';
let you: PlayerId | null = null;
let snapshot: GameSnapshot = local.snapshot;
let renderer: SplitRenderer | null = null;
let errorText = '';
let lastTs = 0;
let raf = 0;

function setError(message: string): void {
  errorText = message;
  const el = document.querySelector('.error');
  if (el) el.textContent = message;
}

function mountPlayfield(): void {
  app.innerHTML = `
    <div class="play-root">
      <canvas id="game"></canvas>
      <div class="hud">
        <div class="code" id="hud-code">YOU VS CPU</div>
        <div class="scores">
          <span class="p1" id="score-p1">Left 0</span>
          <span class="p2" id="score-p2">Right 0</span>
        </div>
      </div>
      <div class="overlay" id="overlay" hidden></div>
      <div class="menu-layer" id="menu"></div>
    </div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  renderer = new SplitRenderer(canvas);
  renderer.resize();

  window.addEventListener('resize', () => renderer?.resize());

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (mode === 'attract' || snapshot.phase === 'finished') return;
    if (mode === 'local') {
      local.bounce('p1');
      renderer?.pulse();
      return;
    }
    if (snapshot.phase === 'playing') {
      net.send({ type: 'bounce' });
      renderer?.pulse();
    }
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (mode === 'attract') return;
      if (event.code === 'KeyA' || event.code === 'KeyW' || event.code === 'KeyQ') {
        event.preventDefault();
        if (mode === 'local') {
          local.bounce('p1');
          renderer?.pulse();
        } else if (snapshot.phase === 'playing') {
          net.send({ type: 'bounce' });
          renderer?.pulse();
        }
      }
      if (event.code === 'ArrowUp' || event.code === 'Space') {
        event.preventDefault();
        if (mode === 'local') {
          local.bounce('p1');
          renderer?.pulse();
        } else if (snapshot.phase === 'playing') {
          net.send({ type: 'bounce' });
          renderer?.pulse();
        }
      }
    },
    { passive: false },
  );

  renderMenu();
  startLoop();
}

function renderMenu(): void {
  const menu = document.querySelector('#menu');
  if (!menu) return;

  if (mode === 'local' || (mode === 'online' && snapshot.phase !== 'lobby')) {
    menu.innerHTML = '';
    menu.classList.remove('visible');
    return;
  }

  menu.classList.add('visible');

  if (mode === 'online' && snapshot.phase === 'lobby') {
    const p1 = snapshot.players.find((p) => p.id === 'p1')!;
    const p2 = snapshot.players.find((p) => p.id === 'p2')!;
    const both = snapshot.playerCount >= 2;
    menu.innerHTML = `
      <div class="panel glass">
        <h1 class="brand">BOUNCE</h1>
        <div class="lobby-code">
          <span>Room code</span>
          <strong>${snapshot.code}</strong>
        </div>
        <div class="players">
          <div class="seat p1">
            <h3>${p1.name}${you === 'p1' ? ' (you)' : ''}</h3>
            <p>In room</p>
          </div>
          <div class="seat p2">
            <h3>${both ? `${p2.name}${you === 'p2' ? ' (you)' : ''}` : 'Waiting…'}</h3>
            <p>${both ? 'In room' : 'Share the code'}</p>
          </div>
        </div>
        <p class="hint">${both ? 'Match starting…' : 'Waiting for a second player to join.'}</p>
        <p class="error">${errorText}</p>
        <div class="actions">
          <button type="button" class="secondary" id="back-local">Play on this screen</button>
        </div>
      </div>
    `;
    document.querySelector('#back-local')?.addEventListener('click', startLocal);
    return;
  }

  menu.innerHTML = `
    <div class="panel glass">
      <h1 class="brand">BOUNCE</h1>
      <p class="tagline">Split-screen climb. Click to bounce against the CPU. Time the gaps. Or share a four-digit code.</p>
      <div class="actions">
        <button type="button" id="play-btn">Play on this screen</button>
        <button type="button" class="secondary" id="create-btn">Create room</button>
      </div>
      <div class="join-row">
        <input id="code-input" maxlength="4" inputmode="numeric" placeholder="0000" autocomplete="off" />
        <button type="button" class="secondary" id="join-btn">Join</button>
      </div>
      <p class="error">${errorText}</p>
      <p class="hint">Same computer: you vs CPU. Two browsers: create a room and share the code.</p>
    </div>
  `;

  const codeInput = document.querySelector<HTMLInputElement>('#code-input')!;
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
  });
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      document.querySelector<HTMLButtonElement>('#join-btn')?.click();
    }
  });

  document.querySelector('#play-btn')!.addEventListener('click', startLocal);

  document.querySelector('#create-btn')!.addEventListener('click', async () => {
    try {
      setError('');
      await net.connect();
      net.send({ type: 'create' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      renderMenu();
    }
  });

  document.querySelector('#join-btn')!.addEventListener('click', async () => {
    const code = codeInput.value.replace(/\D/g, '');
    if (code.length !== 4) {
      setError('Enter a 4-digit code');
      renderMenu();
      return;
    }
    try {
      setError('');
      await net.connect();
      net.send({ type: 'join', code });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      renderMenu();
    }
  });
}

function startLocal(): void {
  mode = 'local';
  you = null;
  local.startPlay();
  snapshot = local.snapshot;
  renderer?.setYou('p1');
  renderMenu();
  updateHud();
}

function updateHud(): void {
  const p1 = snapshot.players.find((p) => p.id === 'p1');
  const p2 = snapshot.players.find((p) => p.id === 'p2');
  const s1 = document.querySelector('#score-p1');
  const s2 = document.querySelector('#score-p2');
  const code = document.querySelector('#hud-code');
  if (s1 && p1) s1.textContent = `${p1.name} ${p1.score}`;
  if (s2 && p2) s2.textContent = `${p2.name} ${p2.score}`;
  if (code) {
    code.textContent =
      mode === 'online' ? `CODE ${snapshot.code}` : 'YOU VS CPU';
  }
}

let lastOverlayKey = '';

function updateOverlay(): void {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (!overlay) return;

  if (mode === 'attract') {
    if (lastOverlayKey !== 'attract') {
      lastOverlayKey = 'attract';
      overlay.hidden = true;
      overlay.innerHTML = '';
    }
    return;
  }

  if (snapshot.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(snapshot.countdownMs / 1000));
    const key = `countdown:${n}`;
    if (lastOverlayKey === key) return;
    lastOverlayKey = key;
    overlay.hidden = false;
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="stack"><h2>${n}</h2><p>${mode === 'local' ? 'Click or Space to bounce — beat the CPU' : 'Click to bounce — miss the bars'}</p></div>`;
    return;
  }

  if (snapshot.phase === 'finished') {
    const key = `finished:${snapshot.winnerId}:${snapshot.tick}`;
    if (lastOverlayKey === key) return;
    lastOverlayKey = key;
    overlay.hidden = false;
    overlay.className = 'overlay interactive';
    const winner = snapshot.players.find((p) => p.id === snapshot.winnerId);
    const title = winner ? `${winner.name} wins!` : 'Draw';
    overlay.innerHTML = `
      <div class="stack">
        <h2>${title}</h2>
        <p>Highest climb wins when both are out</p>
        <button type="button" id="rematch-btn">Rematch</button>
        <button type="button" class="secondary" id="home-btn">Menu</button>
      </div>
    `;
    document.querySelector('#rematch-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      lastOverlayKey = '';
      if (mode === 'local') {
        local.rematch();
        snapshot = local.snapshot;
        updateOverlay();
      } else {
        net.send({ type: 'rematch' });
      }
    });
    document.querySelector('#home-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      mode = 'attract';
      you = null;
      lastOverlayKey = '';
      local.startAttract();
      snapshot = local.snapshot;
      renderMenu();
      updateHud();
      updateOverlay();
    });
    return;
  }

  if (lastOverlayKey !== 'playing') {
    lastOverlayKey = 'playing';
    overlay.hidden = true;
    overlay.innerHTML = '';
  }
}

function startLoop(): void {
  lastTs = performance.now();
  const frame = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (mode !== 'online') {
      local.step(dt);
      snapshot = local.snapshot;
    }
    renderer?.draw(snapshot, dt);
    updateHud();
    updateOverlay();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

void raf;

function showOnline(snap: GameSnapshot): void {
  mode = 'online';
  snapshot = snap;
  if (you) renderer?.setYou(you);
  renderMenu();
  updateHud();
}

net.onMessage((msg) => {
  if (msg.type === 'error') {
    setError(msg.message);
    if (mode !== 'online' || snapshot.phase === 'lobby') renderMenu();
    return;
  }

  if (msg.type === 'room') {
    you = msg.you;
    showOnline(msg.snapshot);
    return;
  }

  if (msg.type === 'state') {
    showOnline(msg.snapshot);
  }
});

local.startAttract();
mountPlayfield();
