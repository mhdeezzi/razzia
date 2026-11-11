// Fichier généré par scripts/build-live-api.mjs à partir de src/live (ne pas modifier à la main).

// src/live/foot-params.json
var foot_params_default = { share: [0, 445e-5, 636e-5, 758e-5, 853e-5, 906e-5, 949e-5, 932e-5, 921e-5, 923e-5, 913e-5, 939e-5, 949e-5, 985e-5, 949e-5, 92e-4, 917e-5, 926e-5, 954e-5, 928e-5, 92e-4, 925e-5, 956e-5, 967e-5, 966e-5, 937e-5, 942e-5, 946e-5, 959e-5, 0.01, 0.01008, 0.01068, 0.01026, 989e-5, 973e-5, 976e-5, 0.01017, 991e-5, 974e-5, 943e-5, 919e-5, 949e-5, 979e-5, 0.01013, 0.01017, 0.03774, 56e-4, 834e-5, 0.01022, 0.01052, 0.01083, 0.01099, 0.01128, 0.01143, 0.01158, 0.01175, 0.01191, 0.01163, 0.01136, 0.01113, 0.01119, 0.01126, 0.01115, 0.01133, 0.01125, 0.0113, 0.0107, 0.01064, 0.01072, 0.01091, 0.01087, 0.01067, 0.0104, 0.01033, 0.01043, 0.01063, 0.01088, 0.01073, 0.01083, 0.01052, 0.01033, 0.01034, 0.01045, 0.01075, 0.01083, 0.01073, 0.01082, 0.01089, 0.01101, 0.01061, 0.07953], state: [[1.09766, 1.10331, 1.07534], [1.02423, 1.0948, 1.16669], [1.01904, 1.00556, 0.96376], [0.93744, 0.92583, 0.90983], [0.98402, 0.95174, 0.93108]], red: [[1, 1.56236], [0.61112, 1.1062]], k: 1e9, goalW: 0, gamma: 0, stateK: 1, closeLate: 1.1, trail: 1, builtAt: "2026-11-11" };

// src/live/nba-params.json
var nba_params_default = { s: 2.3, tau: 0.04, kappa: 0.4, luck: 1.5, run: 0.05, poss: 0, sT: 2.6, tauT: 0.05, builtAt: "2026-11-11" };

// src/live/tennis-params.json
var tennis_params_default = { formSd: 0.165, setSd: 0.24, base: { Hard: 0.645, Clay: 0.625, Grass: 0.665, Carpet: 0.65 }, builtAt: "2026-11-11" };

// src/live/foot.ts
var DEFAULT_PARAMS = {
  share: Array.from({ length: 91 }, (_, m) => m === 0 ? 0 : m === 45 ? 2.2 / 90 : m === 90 ? 4.5 / 90 : 1 / 90),
  state: [[1.3, 1.35, 1.45], [1.15, 1.2, 1.3], [1, 1, 1], [0.92, 0.88, 0.85], [0.9, 0.85, 0.8]],
  red: [[1, 1.5], [0.65, 1]],
  k: 1.5,
  goalW: 0.25,
  gamma: 0.15,
  stateK: 1,
  closeLate: 1,
  trail: 1
};
var clampD = (d) => Math.max(-2, Math.min(2, d));
var period = (m) => m <= 45 ? 0 : m <= 70 ? 1 : 2;
var r1 = (n) => n > 0 ? 1 : 0;
function marketLambdas(o) {
  const ih = 1 / o.h, id = 1 / o.d, ia = 1 / o.a, s = ih + id + ia;
  const ph = ih / s, pa = ia / s;
  let pOver;
  if (o.over25 && o.under25) {
    const io = 1 / o.over25, iu = 1 / o.under25;
    pOver = io / (io + iu);
  }
  const pmf = (l) => {
    const p = [Math.exp(-l)];
    for (let i = 1; i <= 10; i++) p.push(p[i - 1] * l / i);
    return p;
  };
  const eval_ = (lh2, la2) => {
    const H = pmf(lh2), A = pmf(la2);
    let h = 0, a = 0, u = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const p = H[i] * A[j];
      if (i > j) h += p;
      else if (j > i) a += p;
      if (i + j <= 2) u += p;
    }
    return { h, a, over: 1 - u };
  };
  const loss = (lh2, la2) => {
    const e = eval_(lh2, la2);
    return (e.h - ph) ** 2 + (e.a - pa) ** 2 + (pOver != null ? 0.5 * (e.over - pOver) ** 2 : 0.15 * (lh2 + la2 - 2.65) ** 2 / 4);
  };
  let lh = 1.45, la = 1.15;
  for (const step of [0.4, 0.2, 0.1, 0.05, 0.02, 0.01, 5e-3]) {
    for (let it = 0; it < 20; it++) {
      let best = loss(lh, la), moved = false;
      for (const [dh, da] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const nh = lh + dh, na = la + da;
        if (nh < 0.05 || na < 0.05) continue;
        const l = loss(nh, na);
        if (l < best - 1e-12) {
          best = l;
          lh = nh;
          la = na;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return [lh, la];
}
function baseRate(P, lambda, m, diff, redOwn, redOpp) {
  const st = 1 + (P.stateK ?? 1) * (P.state[clampD(diff) + 2][period(m)] - 1);
  const close = m > 70 && Math.abs(diff) <= 1 ? P.closeLate ?? 1 : 1;
  const tr = diff < 0 ? P.trail ?? 1 : 1;
  return lambda * P.share[Math.min(90, Math.max(1, m))] * st * close * tr * P.red[r1(redOwn)][r1(redOpp)];
}
function evidence(P, lam, tl) {
  const t = tl.minute;
  const exp = [0, 0], expR = [0, 0];
  const xg = [0, 0], xgR = [0, 0], gl = [0, 0];
  let gh = 0, ga = 0, rh = 0, ra = 0;
  const goalsAt = /* @__PURE__ */ new Map(), redsAt = /* @__PURE__ */ new Map();
  for (const [m, s] of tl.goals) (goalsAt.get(m) ?? goalsAt.set(m, []).get(m)).push(s);
  for (const [m, s] of tl.reds) (redsAt.get(m) ?? redsAt.set(m, []).get(m)).push(s);
  for (let m = 1; m <= t; m++) {
    for (const s of [0, 1]) {
      const d = s === 0 ? gh - ga : ga - gh;
      const e = baseRate(P, lam[s], m, d, s === 0 ? rh : ra, s === 0 ? ra : rh);
      exp[s] += e;
      if (m > t - 15) expR[s] += e;
    }
    for (const s of goalsAt.get(m) ?? []) {
      if (s === 0) gh++;
      else ga++;
    }
    for (const s of redsAt.get(m) ?? []) {
      if (s === 0) rh++;
      else ra++;
    }
  }
  for (const [m, s, x] of tl.shots) {
    if (m > t) continue;
    xg[s] += x;
    if (m > t - 15) xgR[s] += x;
  }
  for (const [m, s] of tl.goals) if (m <= t) gl[s]++;
  const strength = [1, 1], pressure = [1, 1];
  for (const s of [0, 1]) {
    const obs = (1 - P.goalW) * xg[s] + P.goalW * gl[s];
    const kk = P.k * (lam[s] / 1.35);
    const base = (kk + obs) / (kk + exp[s]);
    const kr = 0.35 * (lam[s] / 1.35);
    pressure[s] = t >= 10 ? (kr + xgR[s]) / (kr + expR[s]) : 1;
    strength[s] = base * pressure[s] ** P.gamma;
  }
  return { expected: exp, xg, goals: gl, expRecent: expR, xgRecent: xgR, strength, pressure };
}
function footLive(P, lam, tl) {
  const t = Math.max(0, Math.min(90, tl.minute));
  const ev = evidence(P, lam, tl);
  let gh = 0, ga = 0, rh = 0, ra = 0;
  for (const [m, s] of tl.goals) if (m <= t) {
    if (s === 0) gh++;
    else ga++;
  }
  for (const [m, s] of tl.reds) if (m <= t) {
    if (s === 0) rh++;
    else ra++;
  }
  const G = 9;
  let dp = Array.from({ length: G }, () => new Float64Array(G));
  dp[0][0] = 1;
  let none = 1;
  const first = [0, 0];
  const soon = [0, 0];
  const rem = [0, 0];
  for (let m = t + 1; m <= 90; m++) {
    const nx = Array.from({ length: G }, () => new Float64Array(G));
    const late = m - t <= 10;
    let gotH = 0, gotA = 0;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const p = dp[i][j];
      if (p < 1e-14) continue;
      const d = gh + i - (ga + j);
      const lh = baseRate(P, lam[0], m, d, rh, ra) * ev.strength[0];
      const la = baseRate(P, lam[1], m, -d, ra, rh) * ev.strength[1];
      const qh = 1 - Math.exp(-lh), qa = 1 - Math.exp(-la);
      rem[0] += p * lh;
      rem[1] += p * la;
      const ii = Math.min(G - 1, i + 1), jj = Math.min(G - 1, j + 1);
      nx[i][j] += p * (1 - qh) * (1 - qa);
      nx[ii][j] += p * qh * (1 - qa);
      nx[i][jj] += p * (1 - qh) * qa;
      nx[ii][jj] += p * qh * qa;
      if (i === 0 && j === 0) {
        gotH = qh;
        gotA = qa;
      }
    }
    const both = gotH * gotA;
    first[0] += none * (gotH * (1 - gotA) + both / 2);
    first[1] += none * (gotA * (1 - gotH) + both / 2);
    if (late) {
    }
    none *= (1 - gotH) * (1 - gotA);
    dp = nx;
  }
  for (const s of [0, 1]) {
    let L = 0;
    for (let m = t + 1; m <= Math.min(90, t + 10); m++) {
      const d = s === 0 ? gh - ga : ga - gh;
      L += baseRate(P, lam[s], m, d, s === 0 ? rh : ra, s === 0 ? ra : rh) * ev.strength[s];
    }
    soon[s] = 1 - Math.exp(-L);
  }
  const grid = Array.from({ length: gh + G }, () => new Array(ga + G).fill(0));
  let pH = 0, pD = 0, pA = 0;
  const over = new Array(7).fill(0);
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const p = dp[i][j];
    const fh = gh + i, fa = ga + j;
    grid[fh][fa] += p;
    if (fh > fa) pH += p;
    else if (fh === fa) pD += p;
    else pA += p;
    for (let x = 0; x <= 6; x++) if (fh + fa > x) over[x] += p;
  }
  const out = { minute: t, score: [gh, ga], p1x2: [pH, pD, pA], nextGoal: [first[0], first[1], none], goalSoon: soon, remaining: rem, grid, over, ev };
  if (gh !== ga) {
    const lead = gh > ga ? 0 : 1, trail = lead === 0 ? 1 : 0;
    out.hold = { side: lead, win: lead === 0 ? pH : pA };
    out.comeback = { side: trail, draw: pD + (trail === 0 ? pH : pA), win: trail === 0 ? pH : pA };
  }
  return out;
}

// src/live/nba.ts
var LG3 = 0.36;
var LGFT = 0.78;
var Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function nbaLive(P, pre, st) {
  const e = Math.max(0, Math.min(48, st.elapsed)), r = 48 - e;
  const D = st.score[0] - st.score[1];
  const l3 = (st.fg3[0][0] - LG3 * st.fg3[0][1]) * 3 - (st.fg3[1][0] - LG3 * st.fg3[1][1]) * 3;
  const lft = st.ft[0][0] - LGFT * st.ft[0][1] - (st.ft[1][0] - LGFT * st.ft[1][1]);
  const luck = l3 + lft;
  const Dadj = D - P.luck * luck;
  const m0 = pre.spread / 48;
  const prec = 1 / P.tau ** 2 + e / P.s ** 2;
  const theta = (m0 / P.tau ** 2 + Dadj / P.s ** 2) / prec;
  const varTheta = 1 / prec;
  const run = st.diff5 != null ? D - st.diff5 : 0;
  const posV = st.possession == null ? 0 : st.possession === 0 ? P.poss : -P.poss;
  const muR = theta * r - P.kappa * D * (r / 48) + P.run * run * (r / 48) + (r > 0 ? posV : 0);
  const sdR = Math.sqrt(P.s ** 2 * r + varTheta * r * r + 0.25);
  const mean = D + muR;
  const T = st.score[0] + st.score[1];
  const t0 = pre.total / 48;
  const precT = 1 / P.tauT ** 2 + e / P.sT ** 2;
  const rate = (t0 / P.tauT ** 2 + T / P.sT ** 2) / precT;
  const meanT = T + rate * r;
  const sdT = Math.sqrt(P.sT ** 2 * r + 1 / precT * r * r + 0.25);
  const pH = r === 0 ? D > 0 ? 1 : D < 0 ? 0 : 0.5 : Phi(mean / sdR);
  const out = {
    elapsed: e,
    win: [pH, 1 - pH],
    margin: { mean, sd: sdR },
    total: { mean: meanT, sd: sdT },
    cover: (line) => Phi((mean + line) / sdR),
    over: (line) => 1 - Phi((line - meanT) / sdT),
    factors: { luck, run, strength: theta * 48, strengthPre: pre.spread, bonus: [(st.fouls?.[1] ?? 0) >= 5, (st.fouls?.[0] ?? 0) >= 5] }
  };
  if (D !== 0) {
    const side = D > 0 ? 1 : 0;
    out.comeback = { side, win: side === 0 ? pH : 1 - pH, deficit: Math.abs(D) };
  }
  return out;
}

// src/live/tennis.ts
var Sg = (z) => 1 / (1 + Math.exp(-z));
var Lg = (p) => Math.log(p / (1 - p));
var nodes = (n, span) => {
  const xs = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const z = -span + 2 * span * (i + 0.5) / n, w = Math.exp(-z * z / 2);
    xs.push([z, w]);
    t += w;
  }
  return xs.map(([z, w]) => [z, w / t]);
};
var N_FORM = nodes(17, 3.2);
var N_SET = nodes(5, 2.4);
function holdFrom(p, a = 0, b = 0) {
  const q = 1 - p;
  const deuce = p * p / (p * p + q * q);
  const memo = /* @__PURE__ */ new Map();
  const go = (x, y) => {
    if (x >= 4 && x - y >= 2) return 1;
    if (y >= 4 && y - x >= 2) return 0;
    if (x >= 3 && y >= 3) {
      if (x === y) return deuce;
      return x > y ? p + q * deuce : p * deuce;
    }
    const k = x * 16 + y;
    const c = memo.get(k);
    if (c != null) return c;
    const v = p * go(x + 1, y) + q * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(a, b);
}
function tbFrom(pA, pB, to, a = 0, b = 0, aFirst = true) {
  const aServes = (n) => {
    const first = n === 0 || Math.floor((n + 1) / 2) % 2 === 0;
    return aFirst ? first : !first;
  };
  const win = (n) => aServes(n) ? pA : 1 - pB;
  const memo = /* @__PURE__ */ new Map();
  const go = (x, y) => {
    if (x >= to && x - y >= 2) return 1;
    if (y >= to && y - x >= 2) return 0;
    const n = x + y;
    if (x >= to - 1 && y >= to - 1 && x === y) {
      const w1 = win(n), w2 = win(n + 1), both = w1 * w2, none = (1 - w1) * (1 - w2);
      return both / (both + none);
    }
    const k = x * 64 + y;
    const c = memo.get(k);
    if (c != null) return c;
    const w = win(n);
    const v = w * go(x + 1, y) + (1 - w) * go(x, y + 1);
    memo.set(k, v);
    return v;
  };
  return go(a, b);
}
function setFrom(pA, pB, ga, gb, aServes, tb, pts) {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const memo = /* @__PURE__ */ new Map();
  const go = (a, b, aSrv, first) => {
    if (a >= 6 && a - b >= 2 || a === 7) return 1;
    if (b >= 6 && b - a >= 2 || b === 7) return 0;
    if (a === 6 && b === 6) {
      if (first && pts) return tbFrom(pA, pB, tb, pts[0], pts[1], aSrv);
      return tbFrom(pA, pB, tb, 0, 0, aSrv);
    }
    const k = a * 32 + b * 2 + (aSrv ? 1 : 0);
    if (!first) {
      const c = memo.get(k);
      if (c != null) return c;
    }
    let w;
    if (first && pts) w = aSrv ? holdFrom(pA, pts[0], pts[1]) : 1 - holdFrom(pB, pts[1], pts[0]);
    else w = aSrv ? hA : 1 - hB;
    const v = w * go(a + 1, b, !aSrv, false) + (1 - w) * go(a, b + 1, !aSrv, false);
    if (!first) memo.set(k, v);
    return v;
  };
  return go(ga, gb, aServes, true);
}
function tbFast(pA, pB, to, aFirst) {
  const W = to + 1, P = new Float64Array(W * W);
  P[0] = 1;
  let total = 0;
  const win = (n) => {
    const f = n === 0 || Math.floor((n + 1) / 2) % 2 === 0;
    return (aFirst ? f : !f) ? pA : 1 - pB;
  };
  for (let n = 0; n < 2 * to - 2; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a >= to || b >= to) continue;
      const pr = P[a * W + b];
      if (!pr) continue;
      const w = win(n);
      if (a + 1 === to) total += pr * w;
      else P[(a + 1) * W + b] += pr * w;
      if (b + 1 < to) P[a * W + b + 1] += pr * (1 - w);
    }
  }
  const tie = P[(to - 1) * W + (to - 1)];
  const n0 = 2 * to - 2, w1 = win(n0), w2 = win(n0 + 1), both = w1 * w2, none = (1 - w1) * (1 - w2);
  return total + tie * (both / (both + none));
}
function setFast(pA, pB, aFirst, tb) {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const P = new Float64Array(64);
  P[0] = 1;
  let total = 0;
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a > 7 || b > 7) continue;
      const pr = P[a * 8 + b];
      if (!pr) continue;
      if (a === 6 && b <= 4 || b === 6 && a <= 4 || a === 7 || b === 7) continue;
      const aSrv = n % 2 === 0 === aFirst;
      const w = aSrv ? hA : 1 - hB;
      const na = a + 1, nb = b + 1;
      if (na === 6 && b <= 4 || na === 7 && b === 5) total += pr * w;
      else P[na * 8 + b] += pr * w;
      if (!(nb === 6 && a <= 4 || nb === 7 && a === 5)) P[a * 8 + nb] += pr * (1 - w);
    }
  }
  return total + P[6 * 8 + 6] * tbFast(pA, pB, tb, aFirst);
}
function setScoreDist(pA, pB, tb) {
  const hA = holdFrom(pA), hB = holdFrom(pB);
  const out = /* @__PURE__ */ new Map();
  const P = new Float64Array(8 * 8);
  P[0] = 1;
  for (let n = 0; n < 12; n++) {
    for (let a = 0; a <= n; a++) {
      const b = n - a;
      if (a > 7 || b > 7) continue;
      const pr = P[a * 8 + b];
      if (!pr) continue;
      if (a >= 6 && a - b >= 2 || b >= 6 && b - a >= 2) continue;
      const w = n % 2 === 0 ? hA : 1 - hB;
      const add = (x, y, v) => {
        if (x >= 6 && x - y >= 2 || y >= 6 && y - x >= 2) out.set(`${x}-${y}`, (out.get(`${x}-${y}`) ?? 0) + v);
        else P[x * 8 + y] += v;
      };
      add(a + 1, b, pr * w);
      add(a, b + 1, pr * (1 - w));
    }
  }
  const t = P[6 * 8 + 6];
  if (t) {
    const w = tbFast(pA, pB, tb, true);
    out.set("7-6", (out.get("7-6") ?? 0) + t * w);
    out.set("6-7", (out.get("6-7") ?? 0) + t * (1 - w));
  }
  return out;
}
function series(s, last, need, sa, sb) {
  const memo = /* @__PURE__ */ new Map();
  const go = (i, j) => {
    if (i === need) return 1;
    if (j === need) return 0;
    const k = i * 8 + j;
    const c = memo.get(k);
    if (c != null) return c;
    const x = i === need - 1 && j === need - 1 ? last : s;
    const v = x * go(i + 1, j) + (1 - x) * go(i, j + 1);
    memo.set(k, v);
    return v;
  };
  return go(sa, sb);
}
function winFrom(P, pA, pB, st, aServesNow) {
  const need = st.bestOf === 5 ? 3 : 2;
  let sa = 0, sb = 0;
  for (const [a, b] of st.sets) {
    if (a > b) sa++;
    else sb++;
  }
  if (sa >= need) return 1;
  if (sb >= need) return 0;
  const decisiveNow = sa === need - 1 && sb === need - 1;
  const superTb = st.superTb ?? st.bestOf === 5;
  const tbNow = decisiveNow && superTb ? 10 : 7;
  let s = 0, last = 0;
  for (const [z, w] of P.setSd ? N_SET : [[0, 1]]) {
    const a = Sg(Lg(pA) + P.setSd * z), b = Sg(Lg(pB) - P.setSd * z);
    const s7 = (setFast(a, b, true, 7) + setFast(a, b, false, 7)) / 2;
    s += w * s7;
    last += w * (superTb ? (setFast(a, b, true, 10) + setFast(a, b, false, 10)) / 2 : s7);
  }
  const g = st.games ?? [0, 0];
  if (!st.games && !st.points) return series(s, last, need, sa, sb);
  let cur = 0;
  for (const [z, w] of P.setSd ? N_SET : [[0, 1]]) {
    const a = Sg(Lg(pA) + P.setSd * z), b = Sg(Lg(pB) - P.setSd * z);
    cur += w * setFrom(a, b, g[0], g[1], aServesNow, tbNow, st.points);
  }
  return cur * series(s, last, need, sa + 1, sb) + (1 - cur) * series(s, last, need, sa, sb + 1);
}
function likelihood(P, pA, pB, st) {
  let total = 0;
  for (const aFirst of [true, false]) {
    let lik = 1, aSrv = aFirst;
    const need = st.bestOf === 5 ? 3 : 2;
    let sa = 0, sb = 0;
    for (const [a, b] of st.sets) {
      const tb = sa === need - 1 && sb === need - 1 && (st.superTb ?? st.bestOf === 5) ? 10 : 7;
      let l = 0;
      for (const [z, w] of P.setSd ? N_SET : [[0, 1]]) {
        const x = Sg(Lg(pA) + P.setSd * z), y = Sg(Lg(pB) - P.setSd * z);
        const d = aSrv ? setScoreDist(x, y, tb) : setScoreDist(y, x, tb);
        l += w * (aSrv ? d.get(`${a}-${b}`) ?? 0 : d.get(`${b}-${a}`) ?? 0);
      }
      lik *= Math.max(1e-12, l);
      if ((a + b) % 2 === 1) aSrv = !aSrv;
      if (a > b) sa++;
      else sb++;
    }
    total += 0.5 * lik;
  }
  if (st.servePts) {
    const [[wa, na], [wb, nb]] = st.servePts;
    total *= Math.exp(wa * Math.log(pA) + (na - wa) * Math.log(1 - pA) + wb * Math.log(pB) + (nb - wb) * Math.log(1 - pB));
  }
  return total;
}
function calibrateTennis(P, p0, surface, bestOf) {
  const base = P.base[surface] ?? 0.645;
  const st = { bestOf, sets: [] };
  let lo = -2.5, hi = 2.5;
  for (let it = 0; it < 22; it++) {
    const d2 = (lo + hi) / 2;
    let w = 0;
    for (const [z, wt] of N_FORM) w += wt * winFrom(P, Sg(Lg(base) + d2 + P.formSd * z), Sg(Lg(base) - d2 - P.formSd * z), st, true);
    if (w < p0) lo = d2;
    else hi = d2;
  }
  const d = (lo + hi) / 2;
  return [Sg(Lg(base) + d), Sg(Lg(base) - d)];
}
function tennisLive(P, base, st) {
  const post = [];
  let tot = 0;
  for (const [z, w] of N_FORM) {
    const e = P.formSd * z;
    const pA = Sg(Lg(base[0]) + e), pB = Sg(Lg(base[1]) - e);
    const l = w * (st.sets.length || st.servePts ? likelihood(P, pA, pB, st) : 1);
    post.push([e, l]);
    tot += l;
  }
  let win = 0, m = 0, m2 = 0, setNow = 0;
  for (const [e, l] of post) {
    const q = l / tot;
    const pA = Sg(Lg(base[0]) + e), pB = Sg(Lg(base[1]) - e);
    const srv = st.server;
    const w = srv == null ? (winFrom(P, pA, pB, st, true) + winFrom(P, pA, pB, st, false)) / 2 : winFrom(P, pA, pB, st, srv === 0);
    win += q * w;
    m += q * e;
    m2 += q * e * e;
    if (st.games || st.points) {
      const g2 = st.games ?? [0, 0];
      setNow += q * (srv == null ? (setFrom(pA, pB, g2[0], g2[1], true, 7, st.points) + setFrom(pA, pB, g2[0], g2[1], false, 7, st.points)) / 2 : setFrom(pA, pB, g2[0], g2[1], srv === 0, 7, st.points));
    }
  }
  const out = { win: [win, 1 - win], form: { mean: m, sd: Math.sqrt(Math.max(0, m2 - m * m)) } };
  let sa = 0, sb = 0;
  for (const [a, b] of st.sets) {
    if (a > b) sa++;
    else sb++;
  }
  const g = st.games ?? [0, 0];
  if (sa !== sb || g[0] !== g[1]) {
    const side = sa > sb || sa === sb && g[0] > g[1] ? 1 : 0;
    out.comeback = { side, win: side === 0 ? win : 1 - win };
  }
  if (st.games || st.points) out.setNow = setNow;
  if (st.server != null) {
    let h = 0;
    for (const [e, l] of post) {
      const pS = st.server === 0 ? Sg(Lg(base[0]) + e) : Sg(Lg(base[1]) - e);
      const pts = st.points ?? [0, 0];
      h += l / tot * holdFrom(pS, st.server === 0 ? pts[0] : pts[1], st.server === 0 ? pts[1] : pts[0]);
    }
    out.holdNow = h;
  }
  return out;
}

// src/live/index.ts
var FOOT = foot_params_default;
var NBA = nba_params_default;
var TENNIS = tennis_params_default;
function footNow(pre, tl) {
  const lam = Array.isArray(pre) ? pre : marketLambdas(pre);
  return footLive(FOOT, lam, tl);
}
function nbaNow(pre, st) {
  return nbaLive(NBA, pre, st);
}
function tennisNow(p0, surface, st, base) {
  const b = base ?? calibrateTennis(TENNIS, p0, surface, st.bestOf);
  return { ...tennisLive(TENNIS, b, st), base: b };
}

// src/live/feeds.ts
var UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", Accept: "application/json" };
var ESPN = "https://site.api.espn.com/apis/site/v2/sports";
var cache = /* @__PURE__ */ new Map();
var pending = /* @__PURE__ */ new Map();
async function getJson(url, ttlMs, tries = 2) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < ttlMs) return c.v;
  const p = pending.get(url);
  if (p) return p;
  const run = (async () => {
    let err;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8e3) });
        if (!r.ok) throw new Error(`${new URL(url).host} : ${r.status}`);
        const v = await r.json();
        cache.set(url, { at: Date.now(), v });
        if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
        return v;
      } catch (e) {
        err = e;
        if (i < tries - 1) await new Promise((res) => setTimeout(res, 400 * (i + 1)));
      }
    }
    if (c && Date.now() - c.at < 3e5) return c.v;
    throw err;
  })();
  pending.set(url, run);
  try {
    return await run;
  } finally {
    pending.delete(url);
  }
}
var ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");
function fotmobMinute(st) {
  const lt = st?.liveTime;
  const s = String(lt?.short ?? "").replace(/[^\d+A-Za-z]/g, "");
  if (/^HT$/i.test(s) || st?.reason?.short === "HT") return 45;
  const m = s.match(/^(\d+)(?:\+(\d+))?/);
  if (m) return Math.min(90, Number(m[1]));
  const long = String(lt?.long ?? "").match(/^(\d+):/);
  return long ? Math.min(90, Number(long[1]) + 1) : 0;
}
async function fotmobLive(now = /* @__PURE__ */ new Date()) {
  const days = [new Date(now.getTime() - 864e5), now];
  const lists = await Promise.all(days.map((d) => getJson(`https://www.fotmob.com/api/data/matches?date=${ymd(d)}`, 2e4).catch(() => ({ leagues: [] }))));
  const out = /* @__PURE__ */ new Map();
  for (const l of lists.flatMap((x) => x.leagues ?? [])) for (const m of l.matches ?? []) {
    const st = m.status ?? {};
    if (!st.started || st.finished || st.cancelled) continue;
    const ht = st.reason?.short === "HT" || /HT/.test(String(st.liveTime?.short ?? ""));
    out.set(m.id, {
      id: m.id,
      league: l.name,
      leagueId: l.primaryId ?? l.id,
      home: m.home?.name,
      away: m.away?.name,
      homeId: m.home?.id,
      awayId: m.away?.id,
      score: [Number(m.home?.score) || 0, Number(m.away?.score) || 0],
      minute: fotmobMinute(st),
      clock: String(st.liveTime?.short ?? "").replace(/[‎]/g, ""),
      reds: [Number(st.numberOfHomeRedCards) || 0, Number(st.numberOfAwayRedCards) || 0],
      state: ht ? "ht" : "live"
    });
  }
  return [...out.values()];
}
var STAT = {
  "Ball possession": "poss",
  "Total shots": "shots",
  "Shots on target": "sot",
  "Big chances": "bigc",
  "Big chances missed": "bigcm",
  "Corners": "corners",
  "Fouls committed": "fouls",
  "Yellow cards": "yellow",
  "Red cards": "red",
  "Expected goals (xG)": "xg",
  "Touches in opposition box": "tbox",
  "Accurate passes": "accp",
  "Offsides": "offsides",
  "Keeper saves": "saves",
  "Duels won": "duels",
  "Hit woodwork": "wood",
  "Shots inside box": "sibox"
};
var num = (v) => {
  const n = parseFloat(String(v ?? "").replace("%", "").replace(/\s*\(.*$/, ""));
  return Number.isFinite(n) ? n : NaN;
};
async function fotmobMatch(id) {
  const d = await getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`, 15e3);
  const h = d.header ?? {}, st = h.status ?? {}, c = d.content ?? {};
  const teams = h.teams ?? [];
  const homeId = Number(teams[0]?.id);
  const state = st.finished ? "post" : !st.started ? "pre" : st.reason?.short === "HT" || /HT/.test(String(st.liveTime?.short ?? "")) ? "ht" : "live";
  const minute = state === "post" ? 90 : state === "pre" ? 0 : fotmobMinute(st);
  const goals = [], reds = [];
  for (const e of c.matchFacts?.events?.events ?? []) {
    if (e.isPenaltyShootoutEvent) continue;
    const side = e.isHome ? 0 : 1;
    const m = Math.max(1, Math.min(90, Number(e.time) || 1));
    if (e.type === "Goal") goals.push([m, side]);
    if (e.type === "Card" && /red/i.test(String(e.card ?? ""))) reds.push([m, side]);
  }
  const shots = (c.shotmap?.shots ?? []).map((s) => [Math.max(1, Math.min(90, Number(s.min) || 1)), Number(s.teamId) === homeId ? 0 : 1, Number(s.expectedGoals) || 0]);
  const stats = {};
  for (const p of c.stats?.Periods?.All?.stats ?? []) for (const s of p.stats ?? []) {
    const k = STAT[s.title];
    const pair = s.stats;
    if (k && Array.isArray(pair) && !stats[k]) {
      const a = num(pair[0]), b = num(pair[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) stats[k] = [a, b];
    }
  }
  const xg = [0, 0];
  for (const [, s, x] of shots) xg[s] += x;
  const momentum = (c.momentum?.main?.data ?? []).map((p) => [Number(p.minute), Number(p.value)]);
  return {
    id,
    league: String(h.leagueName ?? c.matchFacts?.infoBox?.Tournament?.leagueName ?? ""),
    home: { id: homeId, name: teams[0]?.name },
    away: { id: Number(teams[1]?.id), name: teams[1]?.name },
    state,
    clock: String(st.liveTime?.short ?? st.reason?.short ?? "").replace(/[‎]/g, ""),
    timeline: { minute, goals, reds, shots },
    stats,
    momentum,
    xg
  };
}
var NBA_TRI = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX", BRK: "BKN" };
var nbaTri = (a) => NBA_TRI[a] ?? a;
var usDate = (iso) => new Date(new Date(iso).getTime() - 5 * 36e5).toISOString().slice(0, 10);
async function espnNbaBoard(date) {
  const d = await getJson(`${ESPN}/basketball/nba/scoreboard${date ? `?dates=${date.replaceAll("-", "")}` : ""}`, 15e3);
  return (d.events ?? []).map((e) => {
    const c = e.competitions?.[0] ?? {};
    const H = c.competitors?.find((x) => x.homeAway === "home"), A = c.competitors?.find((x) => x.homeAway === "away");
    return {
      id: String(e.id),
      home: nbaTri(H?.team?.abbreviation ?? ""),
      away: nbaTri(A?.team?.abbreviation ?? ""),
      score: [Number(H?.score) || 0, Number(A?.score) || 0],
      period: Number(e.status?.period) || 0,
      clock: String(e.status?.displayClock ?? ""),
      state: e.status?.type?.state ?? "pre",
      espnHomeWin: c.situation?.lastPlay?.probability?.homeWinPercentage,
      date: usDate(e.date)
    };
  });
}
var clockSec = (s) => {
  const m = String(s).match(/^(\d+):(\d+)(?:\.(\d+))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(s) || 0;
};
var elapsedOf = (period2, clock) => period2 <= 4 ? (period2 - 1) * 12 + (12 - clockSec(clock) / 60) : 48;
async function espnNbaGame(id) {
  const d = await getJson(`${ESPN}/basketball/nba/summary?event=${id}`, 1e4);
  const comp = d.header?.competitions?.[0] ?? {};
  const H = comp.competitors?.find((x) => x.homeAway === "home"), A = comp.competitors?.find((x) => x.homeAway === "away");
  const homeTeamId = String(H?.team?.id ?? H?.id);
  const status = comp.status ?? {};
  const period2 = Number(status.period) || 0, clock = String(status.displayClock ?? "12:00");
  const state = status.type?.state ?? "pre";
  const plays = d.plays ?? [];
  const stats = {};
  const fg3 = [[0, 0], [0, 0]], ft = [[0, 0], [0, 0]];
  for (const t of d.boxscore?.teams ?? []) {
    const side = String(t.team?.id) === homeTeamId ? 0 : 1;
    for (const s of t.statistics ?? []) {
      const v = String(s.displayValue ?? "");
      const mm = v.match(/^(\d+)-(\d+)$/);
      if (s.name === "threePointFieldGoalsMade-threePointFieldGoalsAttempted" && mm) fg3[side] = [Number(mm[1]), Number(mm[2])];
      if (s.name === "freeThrowsMade-freeThrowsAttempted" && mm) ft[side] = [Number(mm[1]), Number(mm[2])];
      const n = Number(v);
      if (!mm && Number.isFinite(n)) (stats[s.name] ??= [0, 0])[side] = n;
    }
  }
  const e = state === "post" ? 48 : state === "pre" ? 0 : elapsedOf(period2, clock);
  let diff5;
  const fouls = [0, 0];
  let possession;
  for (const p of plays) {
    const t = elapsedOf(Number(p.period?.number) || 1, p.clock?.displayValue ?? "12:00");
    if (t <= e - 5) diff5 = Number(p.homeScore) - Number(p.awayScore);
    if (Number(p.period?.number) === period2 && /foul/i.test(p.type?.text ?? "") && !/offensive|technical/i.test(p.type?.text ?? "")) {
      const side = String(p.team?.id) === homeTeamId ? 0 : 1;
      fouls[side]++;
    }
  }
  const last = plays.at(-1);
  if (last?.team?.id) {
    const by = String(last.team.id) === homeTeamId ? 0 : 1;
    const flips = last.scoringPlay || /turnover|defensive rebound/i.test(last.type?.text ?? "");
    possession = flips ? 1 - by : by;
  }
  const pc = (d.pickcenter ?? [])[0];
  const market = pc && Number.isFinite(Number(pc.spread)) ? { spread: -Number(pc.spread), total: Number(pc.overUnder) || 225 } : void 0;
  const score = [Number(H?.score) || 0, Number(A?.score) || 0];
  return {
    id,
    home: nbaTri(H?.team?.abbreviation ?? ""),
    away: nbaTri(A?.team?.abbreviation ?? ""),
    date: usDate(comp.date ?? d.header?.competitions?.[0]?.date ?? (/* @__PURE__ */ new Date()).toISOString()),
    state,
    period: period2,
    clock,
    st: { elapsed: e, score, fg3, ft, diff5: e >= 5 ? diff5 ?? 0 : void 0, possession, fouls },
    market,
    stats,
    espnHomeWin: d.winprobability?.at?.(-1)?.homeWinPercentage,
    plays: plays.filter((p) => p.scoringPlay || /timeout|end period|foul/i.test(p.type?.text ?? "")).slice(-40).reverse().map((p) => ({ t: elapsedOf(Number(p.period?.number) || 1, p.clock?.displayValue ?? "12:00"), text: String(p.text ?? ""), score: [Number(p.homeScore), Number(p.awayScore)], scoring: !!p.scoringPlay }))
  };
}
var SLAMS = /australian open|roland garros|french open|wimbledon|us open/i;
async function espnTennisLive(tour = "atp") {
  const d = await getJson(`${ESPN}/tennis/${tour}/scoreboard`, 15e3);
  const out = [];
  for (const ev of d.events ?? []) for (const g of ev.groupings ?? []) {
    if (!/singles/i.test(g.grouping?.displayName ?? "singles")) continue;
    for (const c of g.competitions ?? []) {
      const state = c.status?.type?.state ?? "pre";
      if (state === "pre") continue;
      const ps = [...c.competitors ?? []].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
      if (ps.length !== 2) continue;
      const bestOf = SLAMS.test(ev.name ?? "") && tour === "atp" ? 5 : 3;
      const la = ps[0].linescores ?? [], lb = ps[1].linescores ?? [];
      const n = Math.max(la.length, lb.length);
      const sets = [];
      let games;
      for (let i = 0; i < n; i++) {
        const a = Number(la[i]?.value) || 0, b = Number(lb[i]?.value) || 0;
        const done = la[i]?.winner || lb[i]?.winner || state === "post" || Math.max(a, b) >= 6 && Math.abs(a - b) >= 2 || Math.max(a, b) === 7;
        if (done && i < n - 1) sets.push([a, b]);
        else if (done && state === "post") sets.push([a, b]);
        else if (done && (la[i]?.winner || lb[i]?.winner)) sets.push([a, b]);
        else games = [a, b];
      }
      out.push({
        id: String(c.id),
        tourney: String(ev.name ?? ""),
        round: String(c.round?.displayName ?? ""),
        state,
        players: [ps[0].athlete?.displayName ?? "", ps[1].athlete?.displayName ?? ""],
        st: { bestOf, sets, games },
        detail: String(c.status?.type?.detail ?? "")
      });
    }
  }
  return out;
}

// src/live/api.ts
var REPO = process.env.GH_REPO ?? "mhdeezzi/razzia";
var TOKEN = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? "").trim();
var LIVE = { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" };
var noStore = { "Cache-Control": "no-store" };
var prev = /* @__PURE__ */ new Map();
async function resultat(path) {
  const c = prev.get(path);
  if (c && Date.now() - c.at < 6e5) return c.v;
  if (!TOKEN) return void 0;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=resultats`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(8e3)
    });
    const v = r.ok ? await r.json() : void 0;
    prev.set(path, { at: Date.now(), v });
    return v;
  } catch {
    return c?.v;
  }
}
var key = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
var r3 = (v) => Math.round(v * 1e3) / 1e3;
var r3a = (a) => a.map(r3);
var FOOT_DEFAULT = [1.45, 1.15];
var NBA_DEFAULT = { spread: 2, total: 226 };
function invPhi(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q0 = Math.min(1 - 1e-9, Math.max(1e-9, p));
  if (q0 < 0.02425) {
    const q2 = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0] * q2 + c[1]) * q2 + c[2]) * q2 + c[3]) * q2 + c[4]) * q2 + c[5]) / ((((d[0] * q2 + d[1]) * q2 + d[2]) * q2 + d[3]) * q2 + 1);
  }
  if (q0 > 1 - 0.02425) return -invPhi(1 - q0);
  const q = q0 - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
async function footPre(id) {
  const ix = await resultat("foot/index.json") ?? [];
  const f = ix.find((x) => String(x.id) === String(id))?.final;
  if (f && f.h > 0 && f.d > 0 && f.a > 0) return { pre: { h: 1 / f.h, d: 1 / f.d, a: 1 / f.a }, src: "razzia" };
  const sim = await resultat(`foot/sims/${id}.json`);
  if (sim?.lambda) return { pre: sim.lambda, src: "razzia" };
  return { pre: FOOT_DEFAULT, src: "defaut" };
}
async function nbaPre(date, away, home, market) {
  const s = await resultat(`sims/${date}_${away}@${home}/summary.json`);
  if (s?.margin && s.total) return { pre: { spread: s.pHome != null ? s.margin.sd * invPhi(s.pHome) : s.margin.mean, total: s.total.mean }, src: "razzia" };
  if (market) return { pre: market, src: "marche" };
  return { pre: NBA_DEFAULT, src: "defaut" };
}
async function tennisPre(id, players) {
  const ix = await resultat("tennis/index.json") ?? [];
  const m = ix.find((x) => String(x.id) === id) ?? ix.find((x) => key(x.home) === key(players[0]) && key(x.away) === key(players[1])) ?? ix.find((x) => key(x.home) === key(players[1]) && key(x.away) === key(players[0]));
  if (!m) return { p0: 0.5, surface: "Hard", src: "defaut" };
  const sim = await resultat(`tennis/sims/${m.id}.json`);
  const aIsHome = key(m.home) === key(players[0]);
  return { p0: aIsHome ? m.pHome : 1 - m.pHome, surface: sim?.surface ?? "Hard", src: "razzia" };
}
async function footList() {
  const list = await fotmobLive();
  return Promise.all(list.map(async (m) => {
    const { pre, src } = await footPre(m.id);
    const goals = [...Array(m.score[0]).fill([Math.max(1, m.minute), 0]), ...Array(m.score[1]).fill([Math.max(1, m.minute), 1])];
    const reds = [...Array(m.reds[0]).fill([Math.max(1, m.minute), 0]), ...Array(m.reds[1]).fill([Math.max(1, m.minute), 1])];
    const o = footNow(pre, { minute: m.minute, goals, reds, shots: [] });
    return { ...m, pre: src, p1x2: r3a(o.p1x2), nextGoal: r3a(o.nextGoal), comeback: o.comeback && { ...o.comeback, draw: r3(o.comeback.draw), win: r3(o.comeback.win) } };
  }));
}
async function footOne(id) {
  const d = await fotmobMatch(id);
  const { pre, src } = await footPre(id);
  const o = footNow(pre, d.timeline);
  return {
    ...d,
    pre: src,
    engine: {
      minute: o.minute,
      score: o.score,
      p1x2: r3a(o.p1x2),
      nextGoal: r3a(o.nextGoal),
      goalSoon: r3a(o.goalSoon),
      remaining: r3a(o.remaining),
      over: r3a(o.over),
      comeback: o.comeback,
      hold: o.hold,
      // Indicateurs (affichés, pas utilisés pour la probabilité : ils n'amélioraient pas la prévision du résultat).
      pressure: r3a(o.ev.pressure),
      luck: r3a([o.ev.goals[0] - o.ev.xg[0], o.ev.goals[1] - o.ev.xg[1]]),
      topScores: o.grid.flatMap((r, i) => r.map((p, j) => ({ s: `${i}-${j}`, p: r3(p) }))).sort((a, b) => b.p - a.p).slice(0, 6)
    }
  };
}
async function nbaOne(id) {
  const d = await espnNbaGame(id);
  const { pre, src } = await nbaPre(d.date, d.away, d.home, d.market);
  const o = nbaNow(pre, d.st);
  return {
    ...d,
    pre: { ...pre, src },
    engine: {
      win: r3a(o.win),
      margin: o.margin,
      total: o.total,
      comeback: o.comeback,
      factors: o.factors,
      cover: [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5].map((l) => ({ line: l, p: r3(o.cover(l)) })),
      over: [-15, -10, -5, 0, 5, 10, 15].map((dx) => {
        const line = Math.round(o.total.mean + dx) + 0.5;
        return { line, p: r3(o.over(line)) };
      })
    }
  };
}
async function nbaList() {
  const board = await espnNbaBoard();
  return Promise.all(board.filter((g) => g.state === "in").map(async (g) => {
    try {
      const x = await nbaOne(g.id);
      return { id: g.id, home: g.home, away: g.away, score: g.score, period: g.period, clock: g.clock, pre: x.pre.src, win: x.engine.win, comeback: x.engine.comeback, espnHomeWin: g.espnHomeWin };
    } catch {
      return { id: g.id, home: g.home, away: g.away, score: g.score, period: g.period, clock: g.clock, error: true };
    }
  }));
}
async function tennisList() {
  const all = [...await espnTennisLive("atp").catch(() => []), ...await espnTennisLive("wta").catch(() => [])];
  return Promise.all(all.filter((m) => m.state === "in").map((m) => tennisOne(m)));
}
var tennisBase = /* @__PURE__ */ new Map();
async function tennisOne(m) {
  const { p0, surface, src } = await tennisPre(m.id, m.players);
  const k = `${m.id}|${p0}|${surface}`;
  const o = tennisNow(p0, surface, m.st, tennisBase.get(k));
  tennisBase.set(k, o.base);
  if (tennisBase.size > 300) tennisBase.clear();
  return { ...m, pre: { p0: r3(p0), surface, src }, engine: { win: r3a(o.win), form: o.form, comeback: o.comeback, setNow: o.setNow } };
}
async function GET(request) {
  const q = new URL(request.url).searchParams;
  const sport = q.get("sport"), id = q.get("id") ?? "";
  try {
    if (!sport) {
      const [foot, nba, tennis] = await Promise.all([footList().catch((e) => ({ error: String(e.message) })), nbaList().catch((e) => ({ error: String(e.message) })), tennisList().catch((e) => ({ error: String(e.message) }))]);
      return Response.json({ at: (/* @__PURE__ */ new Date()).toISOString(), foot, nba, tennis }, { headers: LIVE });
    }
    if (sport === "foot" && /^\d{4,10}$/.test(id)) return Response.json(await footOne(Number(id)), { headers: LIVE });
    if (sport === "nba" && /^\d{6,12}$/.test(id)) return Response.json(await nbaOne(id), { headers: LIVE });
    if (sport === "tennis" && /^\d{4,12}$/.test(id)) {
      const all = [...await espnTennisLive("atp").catch(() => []), ...await espnTennisLive("wta").catch(() => [])];
      const m = all.find((x) => x.id === id);
      if (!m) return Response.json({ error: "Match introuvable ou pas commenc\xE9" }, { status: 404, headers: noStore });
      return Response.json(await tennisOne(m), { headers: LIVE });
    }
    return Response.json({ error: "Param\xE8tres invalides" }, { status: 400, headers: noStore });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502, headers: noStore });
  }
}
export {
  GET
};
