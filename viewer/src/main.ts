// Application : sélection d'une simulation, lecture du match typique en 2D, export vidéo, tableau de bord.
import { buildTimeline } from './timeline.ts';
import { buildSnapshots } from './stats.ts';
import { drawFrame, makeCtx, type Ctx } from './render.ts';
import { renderDashboard, type DashExtra } from './dashboard.ts';
import type { TypicalFile, Summary, IndexEntry } from './types.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx2d = canvas.getContext('2d')!;
const pick = document.getElementById('gamePick') as HTMLSelectElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const seek = document.getElementById('seek') as HTMLInputElement;
const timeEl = document.getElementById('time')!;
const recBtn = document.getElementById('rec') as HTMLButtonElement;

let C: Ctx | null = null;
let tau = 0;
let playing = false;
let speed = 2;
let last = performance.now();
let recorder: MediaRecorder | null = null;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function load(dir: string): Promise<void> {
  const [tf, summary] = await Promise.all([
    fetch(`/${dir}/typical.json`).then((r) => r.json() as Promise<TypicalFile>),
    fetch(`/${dir}/summary.json`).then((r) => (r.ok ? (r.json() as Promise<Summary & { insights?: string[]; meta?: DashExtra['meta'] }>) : undefined)),
  ]);
  const tl = buildTimeline(tf);
  const snaps = buildSnapshots(tf.result.events, tf.players);
  C = makeCtx(tf, tl, snaps, summary);
  tau = 0;
  await document.fonts.ready;
  if (summary) {
    renderDashboard(document.getElementById('dash')!, summary, {
      insights: summary.insights, meta: summary.meta, actual: tf.actual,
      typical: { home: tf.result.home.pts, away: tf.result.away.pts, index: tf.index },
    });
  }
  draw();
}

function draw(): void {
  if (!C) return;
  drawFrame(ctx2d, C, tau);
  seek.value = String(Math.round((tau / C.tl.duration) * 1000));
  timeEl.textContent = `${fmt(tau / speed)} / ${fmt(C.tl.duration / speed)}`;
}

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && C) {
    tau = Math.min(C.tl.duration, tau + dt * speed);
    if (tau >= C.tl.duration) {
      playing = false;
      playBtn.textContent = '▶';
      if (recorder && recorder.state === 'recording') recorder.stop();
    }
    draw();
  }
  requestAnimationFrame(loop);
}

playBtn.onclick = () => {
  if (C && tau >= C.tl.duration) tau = 0;
  playing = !playing;
  playBtn.textContent = playing ? '❚❚' : '▶';
};
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
    e.preventDefault();
    playBtn.click();
  }
});
seek.oninput = () => {
  if (!C) return;
  tau = (Number(seek.value) / 1000) * C.tl.duration;
  draw();
};
document.querySelectorAll<HTMLButtonElement>('.speeds button').forEach((b) => {
  b.onclick = () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('.speeds button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
});
document.querySelectorAll<HTMLButtonElement>('.jump button').forEach((b) => {
  b.onclick = () => {
    if (!C) return;
    const q = b.dataset.q!;
    tau = q === 'end' ? Math.max(0, C.tl.duration - 23) : C.tl.periodTau[Number(q)] ?? 0;
    draw();
  };
});
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === b.dataset.tab));
  };
});

// Export vidéo : relecture complète enregistrée depuis le canvas (WebM, ou MP4 si le navigateur le supporte).
recBtn.onclick = () => {
  if (!C) return;
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const stream = canvas.captureStream(30);
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    recBtn.classList.remove('recording');
    recBtn.textContent = '● Export vidéo';
    const blob = new Blob(chunks, { type: mime || 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pick.value || 'match'}_typique.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
  };
  tau = 0;
  playing = true;
  playBtn.textContent = '❚❚';
  recorder.start(1000);
  recBtn.classList.add('recording');
  recBtn.textContent = '■ Arrêter';
};

// Accès de débogage depuis la console : __sim.seek(secondes de vidéo à 1×), __sim.duration().
(window as unknown as Record<string, unknown>).__sim = {
  seek: (t: number) => {
    tau = Math.max(0, Math.min(C?.tl.duration ?? 0, t));
    draw();
  },
  duration: () => C?.tl.duration ?? 0,
  periods: () => C?.tl.periodTau ?? [],
  banners: (kind?: string) => (C?.tl.banners ?? []).filter((b) => !kind || b.kind === kind).map((b) => ({ t: b.tau0, kind: b.kind, label: b.label })),
};

async function init(): Promise<void> {
  const idx: IndexEntry[] = await fetch('/index.json').then((r) => (r.ok ? r.json() : []));
  idx.sort((a, b) => (a.date === b.date ? a.dir.localeCompare(b.dir) : b.date.localeCompare(a.date)));
  pick.innerHTML = idx.map((e) => `<option value="${e.dir}">${e.date} · ${e.away} @ ${e.home} (${e.n} sims, ${e.home} ${(e.pHome * 100).toFixed(0)}%)</option>`).join('');
  const fromUrl = new URLSearchParams(location.search).get('game');
  if (fromUrl && idx.some((e) => e.dir === fromUrl)) pick.value = fromUrl;
  pick.onchange = () => {
    history.replaceState(null, '', `?game=${pick.value}`);
    void load(pick.value);
  };
  if (pick.value) await load(pick.value);
  else {
    ctx2d.fillStyle = '#0b1424';
    ctx2d.fillRect(0, 0, 1920, 1080);
    ctx2d.fillStyle = '#fff';
    ctx2d.font = '600 40px Inter, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Aucune simulation : lancez  npm run sim -- --game OKC@SAS --date 2026-10-20', 960, 540);
  }
  requestAnimationFrame(loop);
}
void init();
