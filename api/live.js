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
  const T2 = st.score[0] + st.score[1];
  const t0 = pre.total / 48;
  const precT = 1 / P.tauT ** 2 + e / P.sT ** 2;
  const rate = (t0 / P.tauT ** 2 + T2 / P.sT ** 2) / precT;
  const meanT = T2 + rate * r;
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
var DEFAULT_TENNIS = { formSd: 0.165, setSd: 0.1, base: { Hard: 0.645, Clay: 0.625, Grass: 0.665, Carpet: 0.65 } };
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
  let cur = 0, tw = 0;
  const cp = st.curSetPts;
  for (const [z, w0] of P.setSd ? N_SET : [[0, 1]]) {
    const a = Sg(Lg(pA) + P.setSd * z), b = Sg(Lg(pB) - P.setSd * z);
    const w = cp ? w0 * Math.exp(cp[0][0] * Math.log(a) + (cp[0][1] - cp[0][0]) * Math.log(1 - a) + cp[1][0] * Math.log(b) + (cp[1][1] - cp[1][0]) * Math.log(1 - b)) : w0;
    cur += w * setFrom(a, b, g[0], g[1], aServesNow, tbNow, st.points);
    tw += w;
  }
  cur = tw > 0 ? cur / tw : cur;
  return cur * series(s, last, need, sa + 1, sb) + (1 - cur) * series(s, last, need, sa, sb + 1);
}
function likelihood(P, pA, pB, st) {
  if (st.servePts && st.servePts[0][1] + st.servePts[1][1] >= 8) {
    const k = P.pointW ?? P.formSd ** 2 / (P.formSd ** 2 + P.setSd ** 2);
    const [[wa, na], [wb, nb]] = st.servePts;
    return Math.exp(k * (wa * Math.log(pA) + (na - wa) * Math.log(1 - pA) + wb * Math.log(pB) + (nb - wb) * Math.log(1 - pB)));
  }
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

// src/live/stats/catalog.ts
var toNum = (s) => Number(s.replace(/\s/g, "").replace(",", "."));
function parseValue(input) {
  const raw = input == null ? "" : String(input).trim();
  if (typeof input === "number") return { value: Number.isFinite(input) ? input : null, raw, unit: "count" };
  if (!raw || raw === "-" || raw === "\u2013") return { value: null, raw };
  let m = raw.match(/^(-?[\d.,]+)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)$/);
  if (m) return { value: toNum(m[1]) / 100, pct: toNum(m[1]) / 100, made: Number(m[2]), att: Number(m[3]), unit: "pct", raw };
  m = raw.match(/^(\d+)\s*\/\s*(\d+)\s*(?:\(\s*(-?[\d.,]+)\s*%\s*\))?$/);
  if (m) {
    const made = Number(m[1]), att = Number(m[2]);
    return { value: att ? made / att : null, made, att, pct: att ? made / att : void 0, unit: "pct", raw };
  }
  m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const made = Number(m[1]), att = Number(m[2]);
    return { value: att ? made / att : null, made, att, pct: att ? made / att : void 0, unit: "pct", raw };
  }
  m = raw.match(/^(\d+)\s+of\s+(\d+)$/i);
  if (m) {
    const made = Number(m[1]), att = Number(m[2]);
    return { value: att ? made / att : null, made, att, pct: att ? made / att : void 0, unit: "pct", raw };
  }
  m = raw.match(/^(-?[\d.,]+)\s*%$/);
  if (m) return { value: toNum(m[1]) / 100, pct: toNum(m[1]) / 100, unit: "pct", raw };
  m = raw.match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (m) return { value: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), unit: "sec", raw };
  m = raw.match(/^([\d.,]+)\s*(km\/h|kmh)$/i);
  if (m) return { value: toNum(m[1]), unit: "kmh", raw };
  m = raw.match(/^([\d.,]+)\s*mph$/i);
  if (m) return { value: toNum(m[1]) * 1.609344, unit: "kmh", raw };
  m = raw.match(/^([\d.,]+)\s*(m|km)$/i);
  if (m) return { value: toNum(m[1]) * (m[2].toLowerCase() === "km" ? 1e3 : 1), unit: "m", raw };
  const n = toNum(raw);
  return Number.isFinite(n) ? { value: n, unit: "count", raw } : { value: null, raw };
}
var norm = (s) => s.replace(/([a-z])([A-Z])/g, "$1 $2").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\-./:()%]+/g, " ").replace(/\s+/g, " ").trim();
var T = {
  unforced: /\b(unforced|ue|fautes? directes?|errores? no forzados?|no forzados?|gratuit[io]|errori gratuiti|unerzwungene?|eigenfehler)\b/,
  forced: /\b(forced|fe|fautes? provoquees?|errores? forzados?|forzati|erzwungene?)\b/,
  error: /\b(errors?|fautes?|errores?|errori|fehler)\b/,
  winner: /\b(winners?|coups? gagnants?|gagnants?|golpes ganadores|ganadores|vincenti|winner schlage)\b/,
  forehand: /\b(forehand|fh|coup droit|derecha|drive|dritto|vorhand)\b/,
  backhand: /\b(backhand|bh|revers|reves|rovescio|ruckhand)\b/,
  volley: /\b(volleys?|volees?|voleas?|volee)\b/,
  smash: /\b(smash|overhead|smashes)\b/,
  drop: /\b(drop shots?|drops?|amorties?|dejadas?|smorzate?|stopp)\b/,
  lob: /\b(lobs?|globos?|pallonetti)\b/,
  groundstroke: /\b(groundstrokes?|fond de court)\b/,
  passing: /\b(passing shots?|passings?)\b/,
  return: /\b(returns?|retours?|restos?|risposta|ruckschlag)\b/,
  serve: /\b(serves?|services?|servicio|servizio|aufschlag|serving)\b/,
  ace: /\b(aces?)\b/,
  doubleFault: /\b(double faults?|doubles? fautes?|dobles? faltas?|doppi falli|doppelfehler|df)\b/,
  first: /\b(1st|first|1er|premiere?s?|primer|prima|erste)\b/,
  second: /\b(2nd|second|2e|2eme|deuxiemes?|seconde?s?|segundo|seconda|zweite)\b/,
  won: /\b(won|win|gagnes?|ganados?|vinti|gewonnen|pts won|points won)\b/,
  inPct: /\b(in|%|percentage|pourcentage|reussite|percent)\b/,
  points: /\b(points?|pts|puntos?|punti|punkte)\b/,
  games: /\b(games?|jeux|juegos?|giochi|spiele)\b/,
  breakPt: /\b(break points?|balles? de break|bp|puntos de quiebre|palle break|breakballe)\b/,
  saved: /\b(saved|sauvees?|salvad[oa]s|salvate|abgewehrt)\b/,
  converted: /\b(converted|convertis|converties|convertid[oa]s|convertite|genutzt)\b/,
  net: /\b(net|filet|red|rete|netz)\b/,
  rally: /\b(rally|rallies|echanges?|peloteo|scambi)\b/,
  inRow: /\b(in a row|consecutifs?|consecutivos|di fila|in folge|streak|serie)\b/,
  total: /\b(total|totaux?)\b/,
  speed: /\b(speed|vitesse|velocidad|velocita|geschwindigkeit)\b/,
  distance: /\b(distance|distancia|km run|run)\b/,
  duration: /\b(duration|duree|tiempo|durata|dauer|time)\b/,
  max: /\b(max|maximum|fastest|plus rapide|top)\b/,
  avg: /\b(avg|average|moyenne?|promedio|media)\b/
};
var has = (s, r) => r.test(s);
var strokeOf = (s) => {
  if (has(s, T.forehand)) return "forehand";
  if (has(s, T.backhand)) return "backhand";
  if (has(s, T.volley)) return "volley";
  if (has(s, T.smash)) return "smash";
  if (has(s, T.drop)) return "drop";
  if (has(s, T.lob)) return "lob";
  if (has(s, T.passing)) return "passing";
  if (has(s, T.groundstroke)) return "groundstroke";
  if (has(s, T.return)) return "return";
  return void 0;
};
var NAMES = {
  "serve.aces": "Aces",
  "serve.df": "Doubles fautes",
  "serve.first.in": "1re balle pass\xE9e",
  "serve.first.won": "Points gagn\xE9s sur 1re balle",
  "serve.second.won": "Points gagn\xE9s sur 2e balle",
  "serve.won": "Points gagn\xE9s au service",
  "serve.games.won": "Jeux de service gagn\xE9s",
  "serve.bp.saved": "Balles de break sauv\xE9es",
  "serve.speed.max": "Service le plus rapide",
  "serve.speed.avg": "Vitesse moyenne de service",
  "serve.speed.first": "Vitesse moyenne 1re balle",
  "serve.speed.second": "Vitesse moyenne 2e balle",
  "return.won": "Points gagn\xE9s en retour",
  "return.first.won": "Retours gagn\xE9s sur 1re balle",
  "return.second.won": "Retours gagn\xE9s sur 2e balle",
  "return.bp.converted": "Balles de break converties",
  "return.games.won": "Jeux de retour gagn\xE9s",
  "points.won": "Points gagn\xE9s",
  "points.inrow": "Points d'affil\xE9e (max)",
  "games.inrow": "Jeux d'affil\xE9e (max)",
  "winners": "Coups gagnants",
  "ue": "Fautes directes",
  "fe": "Fautes provoqu\xE9es",
  "net.won": "Points gagn\xE9s au filet",
  "rally.avg": "Longueur moyenne des \xE9changes",
  "distance": "Distance parcourue",
  "duration": "Dur\xE9e",
  // foot
  "poss": "Possession",
  "shots": "Tirs",
  "sot": "Tirs cadr\xE9s",
  "shots.off": "Tirs non cadr\xE9s",
  "shots.blocked": "Tirs contr\xE9s",
  "shots.box": "Tirs dans la surface",
  "shots.outbox": "Tirs hors de la surface",
  "xg": "Buts attendus (xG)",
  "xgot": "xG cadr\xE9s",
  "xa": "Passes d\xE9cisives attendues (xA)",
  "bigc": "Grosses occasions",
  "bigc.missed": "Grosses occasions manqu\xE9es",
  "corners": "Corners",
  "fouls": "Fautes",
  "yellow": "Cartons jaunes",
  "red": "Cartons rouges",
  "offsides": "Hors-jeu",
  "saves": "Arr\xEAts",
  "passes": "Passes",
  "passes.acc": "Passes r\xE9ussies",
  "crosses": "Centres",
  "long": "Longs ballons",
  "tackles": "Tacles",
  "inter": "Interceptions",
  "clear": "D\xE9gagements",
  "duels": "Duels gagn\xE9s",
  "aerial": "Duels a\xE9riens gagn\xE9s",
  "dribbles": "Dribbles r\xE9ussis",
  "tbox": "Ballons touch\xE9s dans la surface",
  "wood": "Poteaux",
  "freekicks": "Coups francs",
  "throwins": "Touches",
  "goalkicks": "Sorties de but",
  "dangerous": "Attaques dangereuses",
  "attacks": "Attaques",
  // NBA
  "fg": "Tirs",
  "fg2": "Tirs \xE0 2 pts",
  "fg3": "Tirs \xE0 3 pts",
  "ft": "Lancers francs",
  "reb": "Rebonds",
  "reb.off": "Rebonds offensifs",
  "reb.def": "Rebonds d\xE9fensifs",
  "ast": "Passes d\xE9cisives",
  "tov": "Pertes de balle",
  "stl": "Interceptions",
  "blk": "Contres",
  "pf": "Fautes",
  "tech": "Fautes techniques",
  "paint": "Points dans la raquette",
  "fastbreak": "Points en contre-attaque",
  "second": "Points de seconde chance",
  "tovpts": "Points sur pertes de balle",
  "bench": "Points du banc",
  "lead.max": "Plus grosse avance",
  "leadchanges": "Changements de leader",
  "timeouts": "Temps morts restants",
  "run.max": "Plus grosse s\xE9rie"
};
function tennisKey(s) {
  const st = strokeOf(s);
  const stroke = st && st !== "return" ? `.${st}` : st === "return" ? ".return" : "";
  if (has(s, T.doubleFault)) return ["serve.df", "serve"];
  if (has(s, T.ace) && !has(s, T.points)) return ["serve.aces", "serve"];
  if (has(s, T.unforced)) return [`ue${stroke}`, "errors"];
  if (has(s, T.forced) && has(s, T.error)) return [`fe${stroke}`, "errors"];
  if (has(s, T.forced) && !has(s, T.winner)) return [`fe${stroke}`, "errors"];
  if (has(s, T.winner) && !has(s, T.points)) return [`winners${stroke}`, "winners"];
  if (has(s, T.breakPt)) {
    if (has(s, T.saved)) return ["serve.bp.saved", "pressure"];
    if (has(s, T.converted) || has(s, T.won)) return ["return.bp.converted", "pressure"];
    if (has(s, T.serve)) return ["serve.bp.saved", "pressure"];
    return ["return.bp.converted", "pressure"];
  }
  if (/\b(fastest|plus rapide|mas rapido|piu veloce)\b/.test(s)) return ["serve.speed.max", "speed"];
  if (has(s, T.speed)) return [has(s, T.first) ? "serve.speed.first" : has(s, T.second) ? "serve.speed.second" : has(s, T.avg) ? "serve.speed.avg" : "serve.speed.max", "speed"];
  if (has(s, T.inRow)) return [has(s, T.games) ? "games.inrow" : "points.inrow", "points"];
  if (has(s, T.net)) return ["net.won", "net"];
  if (has(s, T.rally)) return ["rally.avg", "rally"];
  if (has(s, T.distance)) return ["distance", "physical"];
  if (has(s, T.duration)) return ["duration", "physical"];
  if (has(s, T.return) || /\breceiv/.test(s) || /\bretour\b/.test(s)) {
    if (has(s, T.games)) return ["return.games.won", "return"];
    if (has(s, T.first)) return ["return.first.won", "return"];
    if (has(s, T.second)) return ["return.second.won", "return"];
    return ["return.won", "return"];
  }
  if (has(s, T.serve) || has(s, T.first) || has(s, T.second)) {
    if (has(s, T.games)) return ["serve.games.won", "serve"];
    if (has(s, T.first)) return [has(s, T.won) || has(s, T.points) ? "serve.first.won" : "serve.first.in", "serve"];
    if (has(s, T.second)) return ["serve.second.won", "serve"];
    return ["serve.won", "serve"];
  }
  if (has(s, T.points) && (has(s, T.total) || has(s, T.won))) return ["points.won", "points"];
  return void 0;
}
var FOOT2 = [
  [/\b(xgot|expected goals on target|xg on target)\b/, "xgot", "chances"],
  [/\b(xa|expected assists?)\b/, "xa", "chances"],
  [/\b(xg|expected goals?|buts attendus|goles esperados)\b/, "xg", "chances"],
  [/\b(big chances? missed|grosses occasions manquees)\b/, "bigc.missed", "chances"],
  [/\b(big chances?|grosses occasions|ocasiones claras)\b/, "bigc", "chances"],
  [/\b(shots? on (target|goal)|tirs cadres|tiros a puerta|on target)\b/, "sot", "attack"],
  [/\b(shots? off (target|goal)|tirs non cadres|off target)\b/, "shots.off", "attack"],
  [/\b(blocked shots?|tirs contres)\b/, "shots.blocked", "attack"],
  [/\b(shots? inside( the)? box|tirs dans la surface)\b/, "shots.box", "attack"],
  [/\b(shots? outside( the)? box|tirs hors de la surface)\b/, "shots.outbox", "attack"],
  [/\b(total shots?|shots?|tirs|tiros)\b/, "shots", "attack"],
  [/\b(possession|ball possession|posesion)\b/, "poss", "possession"],
  [/\b(touches in (opposition|opp) box|touches? (dans la )?surface)\b/, "tbox", "attack"],
  [/\b(dangerous attacks?|attaques dangereuses)\b/, "dangerous", "attack"],
  [/\b(attacks?|attaques)\b/, "attacks", "attack"],
  [/\b(corners?|corner kicks?)\b/, "corners", "setpiece"],
  [/\b(free kicks?|coups francs)\b/, "freekicks", "setpiece"],
  [/\b(throw ins?|touches)\b/, "throwins", "setpiece"],
  [/\b(goal kicks?|sorties de but)\b/, "goalkicks", "setpiece"],
  [/\b(yellow cards?|cartons jaunes|amarillas)\b/, "yellow", "discipline"],
  [/\b(red cards?|cartons rouges|rojas)\b/, "red", "discipline"],
  [/\b(fouls?( committed)?|fautes|faltas)\b/, "fouls", "discipline"],
  [/\b(offsides?|hors jeu|fueras de juego)\b/, "offsides", "discipline"],
  [/\b(keeper saves?|goalkeeper saves?|saves|arrets|paradas)\b/, "saves", "goalkeeping"],
  [/\b(accurate passes|passes reussies|pass(es)? accuracy|passing accuracy)\b/, "passes.acc", "passing"],
  [/\b(crosses|centres)\b/, "crosses", "passing"],
  [/\b(long balls|longs ballons)\b/, "long", "passing"],
  [/\b(passes|pases)\b/, "passes", "passing"],
  [/\b(tackles?|tacles)\b/, "tackles", "defence"],
  [/\b(interceptions?)\b/, "inter", "defence"],
  [/\b(clearances?|degagements)\b/, "clear", "defence"],
  [/\b(aerial duels?|duels aeriens)\b/, "aerial", "defence"],
  [/\b(duels? won|duels? gagnes|duels?)\b/, "duels", "defence"],
  [/\b(dribbles?|successful dribbles|dribbles reussis)\b/, "dribbles", "attack"],
  [/\b(woodwork|poteaux|hit woodwork)\b/, "wood", "chances"]
];
var NBA2 = [
  [/\b(3 ?(pt|pts|point|points)|three point|fg3|3fg|tirs a 3)\b/, "fg3", "shooting"],
  [/\b(2 ?(pt|pts|point|points)|two point|fg2|tirs a 2)\b/, "fg2", "shooting"],
  [/\b(free throws?|ft|lancers? francs?)\b/, "ft", "shooting"],
  [/\b(field goals?|fg|tirs)\b/, "fg", "shooting"],
  [/\b(offensive rebounds?|rebonds offensifs|oreb)\b/, "reb.off", "rebounds"],
  [/\b(defensive rebounds?|rebonds defensifs|dreb)\b/, "reb.def", "rebounds"],
  [/\b(rebounds?|rebonds|reb)\b/, "reb", "rebounds"],
  [/\b(assists?|passes decisives|ast)\b/, "ast", "playmaking"],
  [/\b(points? (off|from|on) turnovers?|turnover points|points sur pertes)\b/, "tovpts", "scoring"],
  [/\b(turnovers?|pertes de balle|tov|to)\b/, "tov", "playmaking"],
  [/\b(steals?|interceptions|stl)\b/, "stl", "defence"],
  [/\b(blocks?|contres|blk)\b/, "blk", "defence"],
  [/\b(technical fouls?|fautes techniques)\b/, "tech", "fouls"],
  [/\b(personal fouls?|fouls?|fautes|pf)\b/, "pf", "fouls"],
  [/\b(points in (the )?paint|points dans la raquette|paint)\b/, "paint", "scoring"],
  [/\b(fast ?break|contre attaque)\b/, "fastbreak", "scoring"],
  [/\b(second chance|seconde chance)\b/, "second", "scoring"],
  [/\b(bench points|points du banc)\b/, "bench", "scoring"],
  [/\b(largest lead|biggest lead|plus grosse avance)\b/, "lead.max", "flow"],
  [/\b(lead changes|changements de leader)\b/, "leadchanges", "flow"],
  [/\b(timeouts?( remaining)?|temps morts)\b/, "timeouts", "flow"],
  [/\b(biggest (scoring )?run|plus grosse serie)\b/, "run.max", "flow"]
];
function classify(sport, label) {
  const s = norm(label);
  let hit;
  if (sport === "tennis") hit = tennisKey(s);
  else for (const [rx, key3, group2] of sport === "foot" ? FOOT2 : NBA2) if (rx.test(s)) {
    hit = [key3, group2];
    break;
  }
  if (!hit) return { key: `other.${s.replace(/ /g, "_")}`, group: "other", label, name: label, known: false };
  const [key2, group] = hit;
  const base = key2.split(".").slice(0, 1)[0];
  const name = NAMES[key2] ?? (NAMES[base] ? `${NAMES[base]} (${STROKE_FR[key2.split(".")[1]] ?? key2.split(".")[1]})` : key2);
  return { key: key2, group, label, name, known: true };
}
var STROKE_FR = { forehand: "coup droit", backhand: "revers", volley: "vol\xE9e", smash: "smash", drop: "amortie", lob: "lob", passing: "passing", groundstroke: "fond de court", return: "retour" };
function periodOf(label) {
  const s = norm(label ?? "");
  if (!s || /\b(all|match|total|game|full)\b/.test(s)) return "all";
  let m = s.match(/\b(\d)(st|nd|rd|th|e|er)? set\b|\bset (\d)\b/);
  if (m) return `set${m[1] ?? m[3]}`;
  m = s.match(/\bq ?(\d)\b|\b(\d)(st|nd|rd|th)? quarter\b|\b(\d)e? quart/);
  if (m) return `q${m[1] ?? m[2] ?? m[4]}`;
  if (/\b(1st|first|1re|premiere) half\b|\b1 ?h\b|\b1re mi temps\b/.test(s)) return "1h";
  if (/\b(2nd|second|2e|seconde) half\b|\b2 ?h\b|\b2e mi temps\b/.test(s)) return "2h";
  if (/\b(ot|overtime|prolongation)/.test(s)) return "ot";
  return s.replace(/ /g, "_");
}
function statsFromRow(sport, row) {
  const c = classify(sport, row.label);
  const period2 = periodOf(row.period);
  return [
    { ...c, side: 0, period: period2, v: parseValue(row.home) },
    { ...c, side: 1, period: period2, v: parseValue(row.away) }
  ];
}
var StatBook = class {
  all = [];
  by = /* @__PURE__ */ new Map();
  add(stats) {
    for (const s of stats) {
      this.all.push(s);
      this.by.set(`${s.period}|${s.key}|${s.side}`, s);
    }
    return this;
  }
  get(key2, side, period2 = "all") {
    return this.by.get(`${period2}|${key2}|${side}`)?.v;
  }
  /** Somme d'une famille (« ue » : toutes les fautes directes, par coup compris si seul le détail est fourni). */
  family(prefix, side, period2 = "all") {
    const whole = this.get(prefix, side, period2)?.value;
    if (whole != null) return whole;
    let t = 0, any = false;
    for (const s of this.all) if (s.side === side && s.period === period2 && s.key.startsWith(`${prefix}.`) && s.v.value != null) {
      t += s.v.value;
      any = true;
    }
    return any ? t : null;
  }
  unknown() {
    return this.all.filter((s) => !s.known);
  }
};

// src/live/stats/tennis-points.ts
function outcomeFromText(text2) {
  const c = classify("tennis", text2);
  const k = c.key;
  const stroke = k.split(".")[1];
  if (k === "serve.aces") return { outcome: "ace", stroke: "serve" };
  if (k === "serve.df") return { outcome: "double_fault", stroke: "serve" };
  if (/service winner|service gagnant|unreturned|non retourne/i.test(text2)) return { outcome: "service_winner", stroke: "serve" };
  if (k.startsWith("ue")) return { outcome: "unforced_error", stroke: stroke ?? "other" };
  if (k.startsWith("fe")) return { outcome: "forced_error", stroke: stroke ?? "other" };
  if (k.startsWith("winners")) return { outcome: "winner", stroke: stroke ?? "other" };
  return { outcome: "unknown" };
}
var emptyAgg = () => ({
  servePlayed: 0,
  serveWon: 0,
  firstPlayed: 0,
  firstWon: 0,
  secondPlayed: 0,
  secondWon: 0,
  returnPlayed: 0,
  returnWon: 0,
  aces: 0,
  df: 0,
  serviceWinners: 0,
  winners: 0,
  ue: 0,
  fe: 0,
  winnersBy: {},
  ueBy: {},
  feBy: {},
  bpFaced: 0,
  bpSaved: 0,
  bpChances: 0,
  bpWon: 0,
  recentWon: 0,
  recentPlayed: 0,
  streak: 0,
  bestStreak: 0,
  rallyLong: 0,
  rallyLongWon: 0
});
function aggregate(points, recent = 20) {
  const A = [emptyAgg(), emptyAgg()];
  points.forEach((p, i) => {
    const s = A[p.server], r = A[1 - p.server];
    const srvWon = p.winner === p.server;
    s.servePlayed++;
    r.returnPlayed++;
    if (srvWon) s.serveWon++;
    else r.returnWon++;
    if (p.serve === 2) {
      s.secondPlayed++;
      if (srvWon) s.secondWon++;
    } else if (p.serve === 1) {
      s.firstPlayed++;
      if (srvWon) s.firstWon++;
    }
    if (p.breakPoint) {
      s.bpFaced++;
      r.bpChances++;
      if (srvWon) s.bpSaved++;
      else r.bpWon++;
    }
    const by = p.by ?? (p.outcome === "unforced_error" || p.outcome === "forced_error" || p.outcome === "double_fault" ? 1 - p.winner : p.winner);
    const st = p.stroke ?? "other";
    switch (p.outcome) {
      case "ace":
        A[p.server].aces++;
        break;
      case "double_fault":
        A[p.server].df++;
        break;
      case "service_winner":
        A[p.server].serviceWinners++;
        break;
      case "winner":
        A[by].winners++;
        A[by].winnersBy[st] = (A[by].winnersBy[st] ?? 0) + 1;
        break;
      case "unforced_error":
        A[by].ue++;
        A[by].ueBy[st] = (A[by].ueBy[st] ?? 0) + 1;
        break;
      case "forced_error":
        A[by].fe++;
        A[by].feBy[st] = (A[by].feBy[st] ?? 0) + 1;
        break;
    }
    if ((p.rally ?? 0) >= 9) {
      A[0].rallyLong++;
      A[1].rallyLong++;
      A[p.winner].rallyLongWon++;
    }
    for (const k of [0, 1]) {
      const w = p.winner === k;
      const a = A[k];
      a.streak = w ? Math.max(1, a.streak + 1) : Math.min(-1, a.streak - 1);
      a.bestStreak = Math.max(a.bestStreak, a.streak);
      if (i >= points.length - recent) {
        a.recentPlayed++;
        if (w) a.recentWon++;
      }
    }
  });
  return A;
}
function stateFromPoints(points, bestOf, superTb = bestOf === 5) {
  const need = bestOf === 5 ? 3 : 2;
  const sets = [];
  let g = [0, 0], pt = [0, 0];
  let server = points[0]?.server ?? 0;
  let setServer = server;
  const won = () => sets.reduce((acc, [a, b]) => a > b ? [acc[0] + 1, acc[1]] : [acc[0], acc[1] + 1], [0, 0]);
  for (const p of points) {
    const [sa, sb] = won();
    if (sa >= need || sb >= need) break;
    const decisive = sa === need - 1 && sb === need - 1;
    const tb = g[0] === 6 && g[1] === 6;
    const to = tb && decisive && superTb ? 10 : 7;
    pt[p.winner]++;
    const [x, y] = pt;
    const gameOver = tb ? Math.max(x, y) >= to && Math.abs(x - y) >= 2 : Math.max(x, y) >= 4 && Math.abs(x - y) >= 2;
    if (tb) {
      const n = x + y;
      if (!gameOver && n % 2 === 1) server = 1 - server;
    }
    if (gameOver) {
      g[x > y ? 0 : 1]++;
      pt = [0, 0];
      const setOver = Math.max(...g) >= 6 && Math.abs(g[0] - g[1]) >= 2 || Math.max(...g) === 7;
      if (setOver) {
        sets.push([g[0], g[1]]);
        setServer = (g[0] + g[1]) % 2 === 1 ? 1 - setServer : setServer;
        server = setServer;
        g = [0, 0];
      } else if (!tb) server = 1 - server;
    }
  }
  const st = { bestOf, sets, games: g, points: pt, server, superTb };
  if (g[0] === 0 && g[1] === 0 && pt[0] === 0 && pt[1] === 0) {
    delete st.points;
  }
  return st;
}

// src/live/flashscore-odds.ts
var obj = (v) => v != null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
var text = (v) => typeof v === "string" ? v : null;
var array = (v, name) => {
  if (!Array.isArray(v)) throw new Error("Format des cotes modifi\xE9 : " + name);
  return v;
};
var idOf = (v) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Error("Identifiant bookmaker absent ou invalide");
  return v;
};
var decimal = (v) => {
  const s = typeof v === "number" ? String(v) : text(v);
  return s && /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) && Number(s) >= 1 ? Number(s) : null;
};
function oddsData(feed, key2) {
  const root = obj(JSON.parse(feed.raw));
  const data = obj(root?.data);
  if (!root || root.errors != null && (!Array.isArray(root.errors) || root.errors.length > 0) || !data || !Object.hasOwn(data, key2)) throw new Error("R\xE9ponse de cotes incompl\xE8te : " + key2);
  if (data[key2] === null) return null;
  const value = obj(data[key2]);
  if (!value) throw new Error("Format des cotes modifi\xE9 : " + key2);
  return value;
}
function bookmakerNames(settings) {
  const entries = obj(settings)?.bookmakers;
  const names = /* @__PURE__ */ new Map();
  if (entries == null) return names;
  for (const entry of array(entries, "bookmakers")) {
    const book = obj(obj(entry)?.bookmaker);
    if (book && typeof book.name === "string") names.set(idOf(book.id), book.name);
  }
  return names;
}
function quote(match, feed, feedKey, phase, book, names, market, scope, value, context = {}) {
  const participantId = text(value.eventParticipantId);
  const homeId = match.fields.find(([k]) => k === "JA")?.[1], awayId = match.fields.find(([k]) => k === "JB")?.[1];
  let side = participantId && participantId === homeId ? "home" : participantId && participantId === awayId ? "away" : null;
  const explicit = text(context.outcome);
  if (!side && ["home", "away", "draw"].includes(explicit ?? "")) side = explicit;
  if (!side && participantId == null && market === "HOME_DRAW_AWAY") side = "draw";
  const handicap = obj(value.handicap) ?? obj(context.handicap);
  const line = handicap && text(handicap.value);
  const change = obj(value.change);
  const active = typeof value.active === "boolean" ? value.active : null;
  const historical = phase === "prematch" && match.state !== "pre";
  const doubleChance = market === "DOUBLE_CHANCE" ? side === "home" ? "1X" : side === "away" ? "X2" : participantId == null ? "12" : null : null;
  const outcome = text(value.selection) ?? text(value.score) ?? text(value.winner) ?? (typeof value.bothTeamsToScore === "boolean" ? value.bothTeamsToScore ? "yes" : "no" : null) ?? text(context.score) ?? explicit ?? doubleChance ?? side ?? participantId ?? "unknown";
  return {
    kind: "bookmaker",
    label: "Cote",
    phase,
    bookmakerId: book,
    bookmakerName: names.get(book) ?? null,
    market,
    scope,
    outcome,
    side,
    participantId,
    handicap: line != null ? { value: line, type: text(handicap?.type) } : null,
    odds: decimal(value.value),
    openingOdds: decimal(value.opening),
    previousOdds: decimal(change?.previous),
    rawValue: text(value.value),
    active,
    status: feed.stale ? "stale" : historical ? "historical" : active === false ? "suspended" : decimal(value.value) == null ? "unknown" : active === true ? "active" : "unknown",
    fetchedAt: feed.fetchedAt,
    ageSeconds: feed.ageSeconds,
    feedKey
  };
}
function parsePrematchOdds(feed, match) {
  const data = oddsData(feed, "findOddsByEventId");
  if (!data) return [];
  if (data.eventId !== match.id) throw new Error("Les cotes re\xE7ues concernent un autre match");
  const names = bookmakerNames(data.settings);
  const quotes = [];
  for (const entry of array(data.odds, "odds")) {
    const market = obj(entry);
    if (!market || typeof market.bettingType !== "string" || typeof market.bettingScope !== "string") throw new Error("March\xE9 de cotes invalide");
    const book = idOf(market.bookmakerId);
    for (const item of array(market.odds, "market.odds")) {
      const value = obj(item);
      if (!value) throw new Error("S\xE9lection de cote invalide");
      quotes.push(quote(match, feed, "prematch", "prematch", book, names, market.bettingType, market.bettingScope, value));
    }
  }
  return quotes;
}
function parseLiveOdds(feed, match, query, names = /* @__PURE__ */ new Map()) {
  const data = oddsData(feed, "findLiveOddsForBookmaker");
  if (!data) return [];
  if (!Object.hasOwn(data, "eventOddsOverview")) throw new Error("March\xE9 live absent de la r\xE9ponse");
  const root = data.eventOddsOverview;
  if (root === null) return [];
  if (!obj(root) && !Array.isArray(root)) throw new Error("March\xE9 live invalide");
  const book = idOf(query.bookmakerId), market = query.market, scope = query.scope;
  if (obj(root)?.bookmakerId != null && obj(root)?.bookmakerId !== book) throw new Error("Les cotes live re\xE7ues concernent un autre bookmaker");
  const feedKey = "live:" + book + ":" + market + ":" + scope;
  const quotes = [];
  let explicitEmpty = false;
  const outcomes = { home: "home", away: "away", draw: "draw", over: "OVER", under: "UNDER", yes: "yes", no: "no", odd: "ODD", even: "EVEN", homeOrDraw: "1X", awayOrDraw: "X2", noDraw: "12", none: "none" };
  const walk = (node, context = {}) => {
    if (Array.isArray(node)) {
      if (!node.length) explicitEmpty = true;
      for (const item of node) walk(item, context);
      return;
    }
    const value = obj(node);
    if (!value) return;
    const inherited = { ...context, ...obj(value.handicap) ? { handicap: value.handicap } : {}, ...typeof value.score === "string" ? { score: value.score } : {} };
    const priceFields = Object.hasOwn(value, "active") || Object.hasOwn(value, "opening") || Object.hasOwn(value, "eventParticipantId");
    if (value.__typename === "EventOddsOverviewItem" || priceFields && (Object.hasOwn(value, "value") || context.outcome != null)) {
      quotes.push(quote(match, feed, feedKey, "live", book, names, market, scope, value, inherited));
      return;
    }
    for (const [key2, child] of Object.entries(value)) {
      if (["handicap", "change", "subscriptionSubjects"].includes(key2)) continue;
      if (outcomes[key2] && child === null) explicitEmpty = true;
      walk(child, { ...inherited, ...outcomes[key2] ? { outcome: outcomes[key2] } : {} });
    }
  };
  walk(root);
  if (!quotes.length && !explicitEmpty) throw new Error("Structure du march\xE9 live non reconnue");
  return quotes;
}
async function readOdds(match, request, options = {}) {
  const feeds = {}, errors = {};
  const quotes = [];
  let liveMarkets = 0, liveReads = 0;
  const get2 = async (key2, query) => {
    const feed = await request(query);
    feeds[key2] = feed;
    if (feed.stale) errors[key2] = feed.staleReason ?? "Derni\xE8res cotes connues, source indisponible";
    return feed;
  };
  const prematch = (async () => {
    try {
      quotes.push(...parsePrematchOdds(await get2("prematch", { hash: "oce", eventId: match.id }), match));
    } catch (e) {
      errors.prematch = e instanceof Error ? e.message : "Cotes indisponibles";
    }
  })();
  const live = (async () => {
    if (match.state !== "in") return;
    try {
      const menu = oddsData(await get2("liveMenu", { hash: "lobtm", eventId: match.id }), "getLiveOddsBettingTypeMenu");
      if (!menu) return;
      const names = bookmakerNames(menu.settings);
      const jobs = /* @__PURE__ */ new Map();
      for (const entry of array(menu.items, "liveMenu.items")) {
        const item = obj(entry);
        if (!item || typeof item.bettingType !== "string" || typeof item.bettingScope !== "string") throw new Error("Menu de march\xE9s live invalide");
        if (item.isActive === false || !array(item.types, "liveMenu.types").includes("LIVE")) continue;
        if (options.liveMarkets && !options.liveMarkets.includes(item.bettingType)) continue;
        if (options.liveScopes && !options.liveScopes.includes(item.bettingScope)) continue;
        for (const book of array(item.bookmakerIds, "liveMenu.bookmakerIds")) {
          const id = idOf(book), key2 = "live:" + id + ":" + item.bettingType + ":" + item.bettingScope;
          jobs.set(key2, { hash: "ole2", eventId: match.id, bookmakerId: id, market: item.bettingType, scope: item.bettingScope });
        }
      }
      liveMarkets = jobs.size;
      const entries = [...jobs];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (index < entries.length) {
          const [key2, query] = entries[index++];
          try {
            quotes.push(...parseLiveOdds(await get2(key2, query), match, query, names));
            liveReads++;
          } catch (e) {
            errors[key2] = e instanceof Error ? e.message : "Cote live indisponible";
          }
        }
      }));
    } catch (e) {
      errors.liveMenu = e instanceof Error ? e.message : "Menu des cotes live indisponible";
    }
  })();
  await Promise.all([prematch, live]);
  quotes.sort((a, b) => (a.phase + a.bookmakerId + a.market + a.scope + a.outcome).localeCompare(b.phase + b.bookmakerId + b.market + b.scope + b.outcome));
  return { source: "flashscore", label: "Cote", complete: !Object.keys(errors).length, quotes, feeds, errors, liveRequested: match.state === "in", liveMarkets, liveReads, retryAfterMs: 0 };
}

// src/live/flashscore.ts
var SPORTS = ["foot", "tennis", "nba"];
function records(raw) {
  return raw.split("~").map((record) => record.split("\xAC").flatMap((field2) => {
    const i = field2.indexOf("\xF7");
    return i < 0 ? [] : [[field2.slice(0, i), field2.slice(i + 1)]];
  })).filter((fields) => fields.length > 0);
}
var field = (fields, key2) => fields.find(([k]) => k === key2)?.[1];
var number = (value) => value != null && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
function parseBoard(sport, feed) {
  const matches = [];
  let leagueFields = [];
  for (const fields of records(feed.raw)) {
    if (field(fields, "ZA") != null) leagueFields = fields;
    const id = field(fields, "AA");
    if (!id || !/^[a-zA-Z0-9]{8}$/.test(id)) continue;
    const league = field(leagueFields, "ZA") ?? "";
    if (sport === "nba" && !/^USA: NBA(?:\s+-|$)/.test(league)) continue;
    const state = field(fields, "AB");
    const timestamp = number(field(fields, "AD"));
    const date = timestamp == null ? null : new Date(timestamp * 1e3);
    matches.push({
      id,
      sport,
      league,
      leagueFields,
      fields,
      start: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      state: state === "1" ? "pre" : state === "2" ? "in" : state === "3" ? "post" : "unknown",
      stage: field(fields, "AC") ?? "",
      home: field(fields, "AE") ?? "",
      away: field(fields, "AF") ?? "",
      score: [number(field(fields, "AG")), number(field(fields, "AH"))]
    });
  }
  return { sport, fetchedAt: feed.fetchedAt, ageSeconds: feed.ageSeconds, matches, stale: !!feed.stale, staleReason: feed.staleReason };
}
function parseStatistics(raw) {
  let period2 = "", group = "";
  const out = [];
  for (const fields of records(raw)) {
    period2 = field(fields, "SE") ?? period2;
    group = field(fields, "SF") ?? group;
    const label = field(fields, "SG");
    if (label != null) out.push({ period: period2, group, id: field(fields, "SD"), label, home: field(fields, "SH") ?? null, away: field(fields, "SI") ?? null });
  }
  return out;
}
function publicSettings(html) {
  const match = /window\.environment\s*=\s*/.exec(html);
  if (!match) throw new Error("Configuration publique Flashscore introuvable");
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const settings = JSON.parse(html.slice(start, i + 1));
      const sign = settings.config?.app?.feed_sign;
      if (typeof sign !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(sign)) throw new Error("Format de configuration Flashscore modifi\xE9");
      return { sign };
    }
  }
  throw new Error("Configuration publique Flashscore incompl\xE8te");
}
var SourceError = class extends Error {
  status;
  retryAfterMs;
  refreshable;
  constructor(message, status, retryAfterMs, refreshable = false) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.refreshable = refreshable;
  }
};
var SETTINGS_TTL_MS = 5 * 6e4;
var SETTINGS_RETRY_MS = 3e4;
var STALE_MS = 6e4;
var Flashscore = class {
  fetcher;
  now;
  ttlMs;
  concurrency;
  active = 0;
  waiting = [];
  cache = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  oddsCache = /* @__PURE__ */ new Map();
  oddsPending = /* @__PURE__ */ new Map();
  settings;
  settingPending;
  settingsRetryAt = 0;
  settingsError;
  renewal;
  blockedUntil = 0;
  oddsBlockedUntil = 0;
  constructor(options = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 1e3;
    this.concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error("Concurrence invalide");
  }
  retryAfterMs() {
    return Math.max(0, this.blockedUntil - this.now(), this.settings ? 0 : this.settingsRetryAt - this.now());
  }
  oddsRetryAfterMs() {
    return Math.max(0, this.oddsBlockedUntil - this.now());
  }
  pause(error) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + error.retryAfterMs);
  }
  async request(url, headers = {}, mayRefresh = false, settingsRequest = false, oddsRequest = false) {
    if (this.active >= this.concurrency) await new Promise((resolve) => settingsRequest ? this.waiting.unshift(resolve) : this.waiting.push(resolve));
    else this.active++;
    try {
      const blockedUntil = oddsRequest ? this.oddsBlockedUntil : this.blockedUntil;
      if (this.now() < blockedUntil) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, blockedUntil - this.now());
      const response = await this.fetcher(url, { headers: typeof headers === "function" ? headers() : headers, signal: AbortSignal.timeout(8e3) });
      if (oddsRequest && response.status === 202) {
        const ms = Number(response.headers.get("x-retry-after-ms"));
        const retry = response.headers.get("retry-after");
        const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1e3 : retry ? Date.parse(retry) - this.now() : 0;
        const wait = Math.max(Number.isFinite(ms) && ms > 0 ? ms : 5e3, Number.isFinite(retryMs) ? retryMs : 0);
        this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + wait);
        await response.body?.cancel().catch(() => void 0);
        throw new SourceError("Cotes Flashscore en pr\xE9paration", 202, wait);
      }
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1e3 : retry ? Date.parse(retry) - this.now() : 6e4;
        const retryAfterMs = Number.isFinite(delay) ? Math.max(5e3, delay) : 6e4;
        const refreshable = mayRefresh && [401, 403].includes(response.status) && retry == null;
        const error = new SourceError("Flashscore : HTTP " + response.status, response.status, retryAfterMs, refreshable);
        if (!settingsRequest && !refreshable && ([401, 403, 429].includes(response.status) || retry != null)) {
          if (oddsRequest) this.oddsBlockedUntil = Math.max(this.oddsBlockedUntil, this.now() + retryAfterMs);
          else this.pause(error);
        }
        await response.body?.cancel().catch(() => void 0);
        throw error;
      }
      const raw = await response.text();
      const age = response.headers.get("age");
      return { raw, fetchedAt: new Date(this.now()).toISOString(), sourceDate: response.headers.get("date"), ageSeconds: age == null ? null : number(age), stale: false };
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  async refreshSettings() {
    if (this.settingPending) return this.settingPending;
    if (this.now() < this.settingsRetryAt) throw this.settingsError;
    this.settingPending = (async () => {
      const page = await this.request("https://www.flashscore.com/basketball/usa/nba/", { "Cache-Control": "no-cache", Pragma: "no-cache" }, false, true);
      this.settings = { ...publicSettings(page.raw), at: this.now() };
      this.settingsRetryAt = 0;
      this.settingsError = void 0;
      return this.settings;
    })();
    try {
      return await this.settingPending;
    } catch (error) {
      this.settingsError = error;
      this.settingsRetryAt = this.now() + Math.max(SETTINGS_RETRY_MS, this.retryAfterMs(), error instanceof SourceError ? error.retryAfterMs : 0);
      throw error;
    } finally {
      this.settingPending = void 0;
    }
  }
  async sign() {
    const current = this.settings;
    if (!current) return this.refreshSettings();
    if (this.now() - current.at >= SETTINGS_TTL_MS && this.now() >= this.settingsRetryAt && !this.settingPending) {
      void this.refreshSettings().catch(() => void 0);
    }
    return current;
  }
  async renew(rejected, error) {
    if (this.retryAfterMs()) throw new SourceError("Flashscore en pause apr\xE8s un refus ou une limite de d\xE9bit", 429, this.retryAfterMs());
    if (this.settings && this.settings.sign !== rejected) return this.settings;
    if (this.renewal?.rejected === rejected) return this.renewal.promise;
    const promise = (async () => {
      try {
        const next = await this.refreshSettings();
        if (next.sign === rejected) throw error;
        return next;
      } catch (refreshError) {
        this.pause(error);
        throw refreshError;
      }
    })();
    this.renewal = { rejected, promise };
    try {
      return await promise;
    } finally {
      if (this.renewal?.promise === promise) this.renewal = void 0;
    }
  }
  async readFeed(name) {
    let signature = await this.sign();
    const read = async (mayRefresh) => {
      const feed = await this.request("https://global.flashscore.ninja/2/x/feed/" + name, () => {
        signature = this.settings ?? signature;
        return { "x-fsign": signature.sign, Referer: "https://www.flashscore.com/" };
      }, mayRefresh);
      if (feed.raw.trim() && !/^~*[A-Z][A-Z0-9]*÷/.test(feed.raw.trim())) {
        const error = new SourceError("R\xE9ponse Flashscore inattendue (flux remplac\xE9 par une page ou une erreur)", 502, 6e4, mayRefresh);
        if (!mayRefresh) this.pause(error);
        throw error;
      }
      return feed;
    };
    try {
      return await read(true);
    } catch (error) {
      if (!(error instanceof SourceError) || !error.refreshable) throw error;
      signature = await this.renew(signature.sign, error);
      return read(false);
    }
  }
  async feed(name) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("Nom de flux invalide");
    const cached = this.cache.get(name);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending2 = (async () => {
      try {
        const feed = await this.readFeed(name);
        this.cache.set(name, { at: this.now(), feed });
        if (this.cache.size > 1e3) this.cache.delete(this.cache.keys().next().value);
        return feed;
      } catch (error) {
        if (cached && this.now() - cached.at <= STALE_MS) return {
          ...cached.feed,
          stale: true,
          staleReason: error instanceof Error ? error.message : "Source indisponible"
        };
        throw error;
      }
    })();
    this.pending.set(name, pending2);
    try {
      return await pending2;
    } finally {
      this.pending.delete(name);
    }
  }
  async board(sport, day = 0) {
    if (!SPORTS.includes(sport)) throw new Error("Sport invalide");
    if (!Number.isInteger(day) || day < 0 || day > 7) throw new Error("Jour Flashscore : un entier de 0 \xE0 7");
    const id = { foot: 1, tennis: 2, nba: 3 }[sport];
    return parseBoard(sport, await this.feed("f_" + id + "_" + day + "_3_en_1"));
  }
  async oddsFeed(query) {
    if (!/^[a-zA-Z0-9]{8}$/.test(query.eventId) || !["oce", "lobtm", "ole2"].includes(query.hash)) throw new Error("Requ\xEAte de cotes invalide");
    const params = new URLSearchParams({ _hash: query.hash, eventId: query.eventId });
    if (query.hash === "ole2") {
      if (!Number.isSafeInteger(query.bookmakerId) || query.bookmakerId <= 0 || !/^[A-Z0-9_]{1,80}$/.test(query.market ?? "") || !/^[A-Z0-9_]{1,80}$/.test(query.scope ?? "")) throw new Error("March\xE9 live invalide");
      params.set("bookmakerId", String(query.bookmakerId));
      params.set("betType", query.market);
      params.set("betScope", query.scope);
    } else {
      params.set("projectId", "2");
      params.set("geoIpCode", "");
      params.set("geoIpSubdivisionCode", "");
    }
    const key2 = "odds:" + params;
    const cached = this.oddsCache.get(key2);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.feed;
    const existing = this.oddsPending.get(key2);
    if (existing) return existing;
    const pending2 = (async () => {
      try {
        const origin = query.hash === "oce" ? "https://global.ds.lsapp.eu/odds/pq_graphql" : "https://2.ds.lsapp.eu/pq_graphql";
        const feed = await this.request(origin + "?" + params, { Accept: "application/json" }, false, false, true);
        oddsData(feed, query.hash === "oce" ? "findOddsByEventId" : query.hash === "lobtm" ? "getLiveOddsBettingTypeMenu" : "findLiveOddsForBookmaker");
        this.oddsCache.set(key2, { at: this.now(), feed });
        if (this.oddsCache.size > 1e3) this.oddsCache.delete(this.oddsCache.keys().next().value);
        return feed;
      } catch (error) {
        if (cached && this.now() - cached.at <= STALE_MS) return { ...cached.feed, stale: true, staleReason: error instanceof Error ? error.message : "Cotes indisponibles" };
        throw error;
      }
    })();
    this.oddsPending.set(key2, pending2);
    try {
      return await pending2;
    } finally {
      this.oddsPending.delete(key2);
    }
  }
  async odds(match, options = {}) {
    const result = await readOdds(match, (query) => this.oddsFeed(query), options);
    return { ...result, retryAfterMs: this.oddsRetryAfterMs() };
  }
  async detail(match, board, options = {}) {
    if (!/^[a-zA-Z0-9]{8}$/.test(match.id)) throw new Error("Identifiant Flashscore invalide");
    const id = match.id;
    const names = {
      summary: "df_sur_1_" + id,
      common: "dc_1_" + id,
      statistics: "df_st_1_" + id,
      players: "df_psn_1_" + id,
      timeline: "df_sui_1_" + id
    };
    if (match.sport === "tennis") {
      names.history = "df_mh_1_" + id;
      names.currentGame = "df_mhs_1_" + id;
    }
    const feeds = {}, errors = {};
    if (board.stale) errors.board = board.staleReason ?? "Dernier tableau connu, source indisponible";
    await Promise.all(Object.entries(names).map(async ([kind, name]) => {
      try {
        feeds[kind] = await this.feed(name);
        if (feeds[kind].stale) errors[kind] = feeds[kind].staleReason ?? "Derni\xE8re lecture connue, source indisponible";
      } catch (e) {
        errors[kind] = e instanceof Error ? e.message : "Flux indisponible";
      }
    }));
    const odds = options.odds ? await this.odds(match) : void 0;
    if (odds && !odds.complete) errors.odds = Object.values(odds.errors).join("; ");
    return {
      source: "flashscore",
      match,
      boardFetchedAt: board.fetchedAt,
      boardAgeSeconds: board.ageSeconds,
      boardStale: board.stale,
      collectedAt: new Date(this.now()).toISOString(),
      complete: !Object.keys(errors).length,
      statistics: parseStatistics(feeds.statistics?.raw ?? ""),
      feeds,
      errors,
      ...odds ? { odds } : {}
    };
  }
};

// src/live/sources/flashscore.ts
var get = (fields, key2) => fields.find(([k]) => k === key2)?.[1];
var integer = (s) => s != null && /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : void 0;
var setWon = ([a, b]) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return hi === 6 && lo <= 4 || hi === 7 && (lo === 5 || lo === 6) || hi >= 8 && hi - lo === 2;
};
function flashscoreTennis(match) {
  const sets = [];
  let games;
  for (const [a2, b2] of [["BA", "BB"], ["BC", "BD"], ["BE", "BF"], ["BG", "BH"], ["BI", "BJ"]]) {
    const h = integer(get(match.fields, a2)), w = integer(get(match.fields, b2));
    if (h == null && w == null) break;
    if (h == null || w == null || games) throw new Error("Score des sets Flashscore incomplet");
    const pair = [h, w];
    if (setWon(pair)) sets.push(pair);
    else games = pair;
  }
  const won = [sets.filter(([a2, b2]) => a2 > b2).length, sets.filter(([a2, b2]) => b2 > a2).length];
  if (match.score.some((value, i) => value == null || value !== won[i])) throw new Error("Score des sets Flashscore en cours de synchronisation");
  if (!sets.length && !games) throw new Error("Score des jeux Flashscore indisponible");
  const point = (key2) => {
    const value = get(match.fields, key2);
    if (games?.[0] === 6 && games[1] === 6) return integer(value);
    return { "0": 0, "15": 1, "30": 2, "40": 3, A: 4, AD: 4 }[value ?? ""];
  };
  const a = point("WA"), b = point("WB");
  const serving = get(match.fields, "WC");
  return { sets, games, ...games && a != null && b != null ? { points: [a, b] } : {}, ...serving === "1" || serving === "2" ? { server: serving === "1" ? 0 : 1 } : {} };
}
function flashscoreSourceMatch(detail, board) {
  const match = detail.match;
  if (board.stale || detail.feeds.statistics?.stale || !match.home || !match.away || match.state === "unknown") throw new Error("Donn\xE9es Flashscore anciennes ou incompl\xE8tes : repli sur la source principale");
  const errors = { ...detail.errors };
  const { odds, ...native } = detail;
  let tennis;
  if (match.sport === "tennis") {
    try {
      tennis = flashscoreTennis(match);
    } catch (error) {
      errors.tennisScore = error instanceof Error ? error.message : "Score tennis indisponible";
    }
  }
  return {
    id: match.id,
    sport: match.sport,
    home: match.home,
    away: match.away,
    state: match.state,
    score: match.score,
    stats: detail.statistics.map((s) => ({ label: s.label, home: s.home, away: s.away, period: s.period })),
    tennis,
    quality: { at: detail.collectedAt, stale: false, complete: !Object.keys(errors).length, errors },
    native: { home: match.home, away: match.away, data: native },
    ...odds ? { odds: { home: match.home, away: match.away, data: odds } } : {}
  };
}
function createFlashscoreSource(client = new Flashscore()) {
  return {
    name: "flashscore",
    sports: ["foot", "nba", "tennis"],
    ready: () => process.env.LIVE_FLASHSCORE !== "0",
    async live(sport) {
      const board = await client.board(sport);
      if (board.stale) throw new Error("Tableau Flashscore ancien");
      return board.matches.filter((m) => m.state === "in" && m.home && m.away && (sport !== "tennis" || !m.home.includes("/") && !m.away.includes("/"))).map((m) => ({
        id: m.id,
        sport,
        home: m.home,
        away: m.away,
        start: m.start ?? void 0,
        tourney: m.league
      }));
    },
    async match(sport, id, options = {}) {
      const board = await client.board(sport);
      const match = board.matches.find((m) => m.id === id);
      if (!match) throw new Error("Match Flashscore absent du tableau");
      const detail = await client.detail(match, board, options);
      return flashscoreSourceMatch(detail, board);
    }
  };
}
var flashscore = createFlashscoreSource();

// src/live/sources/matching.ts
var words = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
var norm2 = (s) => words(s).join(" ");
var NBA3 = {
  ATL: ["Atlanta Hawks"],
  BOS: ["Boston Celtics"],
  BKN: ["Brooklyn Nets", "BRK"],
  CHA: ["Charlotte Hornets"],
  CHI: ["Chicago Bulls"],
  CLE: ["Cleveland Cavaliers"],
  DAL: ["Dallas Mavericks"],
  DEN: ["Denver Nuggets"],
  DET: ["Detroit Pistons"],
  GSW: ["Golden State Warriors", "GS"],
  HOU: ["Houston Rockets"],
  IND: ["Indiana Pacers"],
  LAC: ["Los Angeles Clippers", "LA Clippers"],
  LAL: ["Los Angeles Lakers", "LA Lakers"],
  MEM: ["Memphis Grizzlies"],
  MIA: ["Miami Heat"],
  MIL: ["Milwaukee Bucks"],
  MIN: ["Minnesota Timberwolves"],
  NOP: ["New Orleans Pelicans", "NO"],
  NYK: ["New York Knicks", "NY"],
  OKC: ["Oklahoma City Thunder"],
  ORL: ["Orlando Magic"],
  PHI: ["Philadelphia 76ers"],
  PHX: ["Phoenix Suns", "PHO"],
  POR: ["Portland Trail Blazers"],
  SAC: ["Sacramento Kings"],
  SAS: ["San Antonio Spurs", "SA"],
  TOR: ["Toronto Raptors"],
  UTA: ["Utah Jazz", "UTAH"],
  WAS: ["Washington Wizards", "WSH"]
};
var nbaNames = new Map(Object.entries(NBA3).flatMap(([tri, names]) => [tri, ...names].map((name) => [norm2(name), tri])));
var footballAliases = {
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  "man utd": "manchester united",
  "manchester utd": "manchester united",
  "man city": "manchester city",
  inter: "inter milan",
  internazionale: "inter milan",
  "internazionale milano": "inter milan"
};
var club = (s) => {
  const name = words(s).filter((w) => !["fc", "cf", "afc", "sc"].includes(w)).map((w) => ["w", "women", "feminin", "feminines"].includes(w) ? "women" : w).join(" ");
  return footballAliases[name] ?? name;
};
function player(s) {
  const tokens = words(s);
  if (!tokens.length) return { surnames: [] };
  const tail = tokens.findIndex((w) => w.length === 1);
  if (tail > 0 && tokens.slice(tail).every((w) => w.length === 1)) return { surnames: [tokens.slice(0, tail).join(" ")], initial: tokens[tail] };
  let first = 0;
  while (tokens[first]?.length === 1) first++;
  if (first) return { surnames: [tokens.slice(first).join(" ")].filter(Boolean), initial: tokens[0] };
  if (tokens.length === 1) return { surnames: tokens };
  return { surnames: tokens.slice(1).map((_, i) => tokens.slice(i + 1).join(" ")), initial: tokens[0][0], firstName: tokens[0] };
}
function sameParticipant(a, b, sport) {
  if (!norm2(a) || !norm2(b)) return false;
  if (norm2(a) === norm2(b)) return true;
  if (sport === "nba") {
    const x2 = nbaNames.get(norm2(a)), y2 = nbaNames.get(norm2(b));
    return x2 != null && x2 === y2;
  }
  if (sport === "foot") return !!club(a) && club(a) === club(b);
  if (a.includes("/") || b.includes("/")) return false;
  const x = player(a), y = player(b);
  if (x.firstName && y.firstName && x.firstName !== y.firstName) return false;
  return !!x.initial && x.initial === y.initial && x.surnames.some((name) => y.surnames.includes(name));
}

// src/live/source.ts
var SOURCES = [
  flashscore
  // modele,
];
var sourcesFor = (sport) => SOURCES.filter((s) => s.sports.includes(sport) && s.ready());
var STROKES = /* @__PURE__ */ new Set(["serve", "return", "forehand", "backhand", "volley", "smash", "drop", "lob", "passing", "halfvolley", "other"]);
function normalizePoints(raw) {
  return raw.map((r) => {
    const read = r.result ? outcomeFromText(r.result) : void 0;
    const outcome = r.outcome ?? read?.outcome ?? "unknown";
    const stroke = r.stroke && STROKES.has(String(r.stroke)) ? r.stroke : r.stroke ? outcomeFromText(`${r.stroke} winner`).stroke : read?.stroke;
    return { server: r.server, winner: r.winner, set: r.set, game: r.game, serve: r.serve, outcome, stroke, by: r.by, rally: r.rally, breakPoint: r.breakPoint, tiebreak: r.tiebreak, t: r.t };
  });
}
function bookOf(sport, stats = []) {
  const b = new StatBook();
  for (const s of stats) b.add(statsFromRow(sport, s));
  return b;
}
function sameMatch(a, b, sport = "tennis") {
  const same = sameParticipant(a.home, b.home, sport) && sameParticipant(a.away, b.away, sport);
  const swapped = sameParticipant(a.home, b.away, sport) && sameParticipant(a.away, b.home, sport);
  if (same && !swapped) return "same";
  if (swapped && !same) return "swapped";
  return void 0;
}
async function enrich(sport, want, options = {}, sources = sourcesFor(sport)) {
  for (const src of sources) {
    if (!src.ready() || !src.sports.includes(sport)) continue;
    try {
      const list = await src.live(sport);
      const candidates = list.filter((ref2) => ref2.sport === sport && ref2.id).map((ref2) => ({ ref: ref2, how: sameMatch(want, ref2, sport) })).filter((c) => c.how);
      if (candidates.length !== 1) continue;
      const { ref, how } = candidates[0];
      const m = await src.match(sport, ref.id, options);
      if (m.id !== ref.id || m.sport !== sport || m.state === "pre" || m.quality?.stale || sameMatch(ref, m, sport) !== "same") continue;
      return { source: src.name, match: how === "same" ? m : swap(m) };
    } catch {
    }
  }
  return void 0;
}
function swap(m) {
  const f = (x) => x == null ? x : 1 - x;
  const pair = (p) => p ? [p[1], p[0]] : p;
  return {
    ...m,
    home: m.away,
    away: m.home,
    score: pair(m.score),
    tennis: m.tennis && {
      ...m.tennis,
      sets: m.tennis.sets?.map(([a, b]) => [b, a]),
      games: pair(m.tennis.games),
      points: pair(m.tennis.points),
      server: f(m.tennis.server),
      pointLog: m.tennis.pointLog?.map((p) => ({ ...p, server: f(p.server), winner: f(p.winner), by: f(p.by) }))
    },
    stats: m.stats?.map((s) => ({ ...s, home: s.away, away: s.home })),
    events: m.events?.map((e) => ({ ...e, side: f(e.side) }))
  };
}

// src/live/stats/tennis-engine.ts
var NEUTRAL_WEIGHTS = {
  outcome: { ace: 1, double_fault: 1, service_winner: 1, winner: 1, unforced_error: 1, forced_error: 1, unknown: 1 },
  recent: 0
};
var val = (b, k, side) => b?.get(k, side)?.value ?? null;
function weighted(points, W) {
  const out = [[0, 0], [0, 0]];
  const n = points.length;
  points.forEach((p, i) => {
    let w = W.outcome[p.outcome ?? "unknown"] ?? 1;
    if (i >= n - 20) w *= 1 + W.recent;
    out[p.server][1] += w;
    if (p.winner === p.server) out[p.server][0] += w;
  });
  return out;
}
function fromStats(b, W) {
  const sp = [0, 1].map((k) => {
    const side = k;
    const all = b.get("serve.won", side);
    if (all?.made != null && all.att) return [all.made, all.att];
    const f = b.get("serve.first.won", side), s = b.get("serve.second.won", side);
    if (f?.made != null && f.att != null && s?.made != null && s.att != null) return [f.made + s.made, f.att + s.att];
    const r = b.get("return.won", 1 - side);
    if (r?.made != null && r.att) return [r.att - r.made, r.att];
    return void 0;
  });
  if (!sp[0] || !sp[1]) return void 0;
  const out = [[...sp[0]], [...sp[1]]];
  const wUe = W.outcome.unforced_error;
  if (wUe !== 1) {
    const tot = out[0][1] + out[1][1];
    for (const side of [0, 1]) {
      const own = b.family("ue", side), opp = b.family("ue", 1 - side);
      const share = out[side][1] / tot;
      const lostOwn = (own ?? 0) * share, wonOpp = (opp ?? 0) * share;
      out[side][0] -= (1 - wUe) * wonOpp;
      out[side][1] -= (1 - wUe) * (lostOwn + wonOpp);
    }
  }
  return out;
}
function countToSetEnd(points, bestOf, superTb) {
  let lo = 0;
  const done = stateFromPoints(points, bestOf, superTb).sets.length;
  if (!done) return 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (stateFromPoints(points.slice(0, mid), bestOf, superTb).sets.length >= done) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
var family = (ag, k) => Object.fromEntries(Object.entries(ag[k]).map(([s, n]) => [s, n ?? 0]));
function tennisFromStats(base, input, P = DEFAULT_TENNIS, W = NEUTRAL_WEIGHTS) {
  const read = { level: "score", serveExpected: base };
  let st;
  if (input.pointLog?.length) {
    st = stateFromPoints(input.pointLog, input.bestOf, input.superTb);
    if (input.server != null) st.server = input.server;
    st.servePts = weighted(input.pointLog, W);
    const inSet = input.pointLog.length - countToSetEnd(input.pointLog, input.bestOf, input.superTb);
    if (inSet > 0) st.curSetPts = weighted(input.pointLog.slice(-inSet), { ...W, recent: 0 });
    const [a, b] = aggregate(input.pointLog);
    read.level = "points";
    read.serveRate = [a.servePlayed ? a.serveWon / a.servePlayed : null, b.servePlayed ? b.serveWon / b.servePlayed : null];
    read.ue = [a.ue, b.ue];
    read.winners = [a.winners, b.winners];
    read.netShots = [a.winners - a.ue, b.winners - b.ue];
    read.ueBy = [family(a, "ueBy"), family(b, "ueBy")];
    read.winnersBy = [family(a, "winnersBy"), family(b, "winnersBy")];
    read.aces = [a.aces, b.aces];
    read.df = [a.df, b.df];
    read.recent = [a.recentWon, b.recentWon];
    read.streak = [a.streak, b.streak];
    read.breakPoints = { saved: [a.bpSaved, b.bpSaved], faced: [a.bpFaced, b.bpFaced] };
  } else {
    st = { bestOf: input.bestOf, superTb: input.superTb, sets: input.sets ?? [], games: input.games, points: input.points, server: input.server };
    const sp = input.stats ? fromStats(input.stats, W) : void 0;
    if (sp) {
      st.servePts = sp;
      read.level = "stats";
    }
  }
  if (input.stats) {
    const b = input.stats;
    const pick = (k) => [val(b, k, 0), val(b, k, 1)];
    read.ue ??= [b.family("ue", 0), b.family("ue", 1)];
    read.winners ??= [b.family("winners", 0), b.family("winners", 1)];
    read.netShots ??= [read.winners[0] != null && read.ue[0] != null ? read.winners[0] - read.ue[0] : null, read.winners[1] != null && read.ue[1] != null ? read.winners[1] - read.ue[1] : null];
    read.aces ??= pick("serve.aces");
    read.df ??= pick("serve.df");
    if (!read.ueBy) {
      const by = (side, pre) => Object.fromEntries(b.all.filter((s) => s.side === side && s.period === "all" && s.key.startsWith(`${pre}.`) && s.v.value != null).map((s) => [s.key.split(".")[1], s.v.value]));
      read.ueBy = [by(0, "ue"), by(1, "ue")];
      read.winnersBy = [by(0, "winners"), by(1, "winners")];
    }
  }
  if (st.servePts) {
    read.servePts = st.servePts;
    read.serveRate ??= [st.servePts[0][1] ? st.servePts[0][0] / st.servePts[0][1] : null, st.servePts[1][1] ? st.servePts[1][0] / st.servePts[1][1] : null];
  }
  return { ...tennisLive(P, base, st), read };
}

// src/live/tennis-weights.json
var tennis_weights_default = {
  outcome: {
    ace: 1,
    double_fault: 1.2,
    service_winner: 1,
    winner: 1,
    unforced_error: 1.2,
    forced_error: 1,
    unknown: 1
  },
  recent: 0,
  pointW: null,
  formSd: 0.165,
  setSd: 0.24,
  builtAt: "2026-11-11",
  source: "Match Charting Project (CC BY-NC-SA 4.0) \u2014 essais personnels uniquement, \xE0 r\xE9apprendre avec les donn\xE9es sous licence avant mise en ligne"
};

// src/live/api.ts
var WEIGHTS = process.env.LIVE_TENNIS_WEIGHTS === "mcp" ? { outcome: { ...NEUTRAL_WEIGHTS.outcome, ...tennis_weights_default.outcome }, recent: tennis_weights_default.recent ?? 0 } : NEUTRAL_WEIGHTS;
var REPO = process.env.GH_REPO ?? "mhdeezzi/razzia";
var TOKEN = (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_PAT ?? "").trim();
var LIVE = { "Cache-Control": "no-store" };
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
async function extraStats(sport, home, away, options = {}) {
  const extra = await enrich(sport, { home, away }, options);
  if (!extra) return void 0;
  const book = bookOf(sport, extra.match.stats);
  return { source: extra.source, id: extra.match.id, home: extra.match.home, away: extra.match.away, stats: book.all.map((s) => ({ key: s.key, name: s.name, group: s.group, side: s.side, period: s.period, value: s.v.value, made: s.v.made, att: s.v.att, raw: s.v.raw, known: s.known })), events: extra.match.events, score: extra.match.score, state: extra.match.state, quality: extra.match.quality, native: extra.match.native, odds: extra.match.odds };
}
async function footOne(id, options = {}) {
  const d = await fotmobMatch(id);
  const { pre, src } = await footPre(id);
  const o = footNow(pre, d.timeline);
  const more = await extraStats("foot", d.home.name, d.away.name, options);
  return {
    ...d,
    pre: src,
    more,
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
async function nbaOne(id, options = {}, withStats = true) {
  const d = await espnNbaGame(id);
  const { pre, src } = await nbaPre(d.date, d.away, d.home, d.market);
  const o = nbaNow(pre, d.st);
  const more = withStats ? await extraStats("nba", d.home, d.away, options) : void 0;
  return {
    ...d,
    pre: { ...pre, src },
    more,
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
      const x = await nbaOne(g.id, {}, false);
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
async function tennisOne(m, options = {}) {
  const { p0, surface, src } = await tennisPre(m.id, m.players);
  const k = `${m.id}|${p0}|${surface}`;
  const o = tennisNow(p0, surface, m.st, tennisBase.get(k));
  tennisBase.set(k, o.base);
  if (tennisBase.size > 300) tennisBase.clear();
  const extra = await enrich("tennis", { home: m.players[0], away: m.players[1] }, options);
  if (extra) {
    const t = extra.match.tennis ?? {};
    const st = { ...m.st, bestOf: t.bestOf ?? m.st.bestOf, sets: t.sets ?? m.st.sets, games: t.sets ? t.games : t.games ?? m.st.games, points: t.points, server: t.server };
    const book = bookOf("tennis", extra.match.stats);
    const pointLog = t.pointLog?.length ? normalizePoints(t.pointLog) : void 0;
    const x = tennisFromStats(o.base, { ...st, pointLog, stats: book }, TENNIS, WEIGHTS);
    return {
      ...m,
      st,
      state: extra.match.state,
      pre: { p0: r3(p0), surface, src },
      source: extra.source,
      sourceId: extra.match.id,
      quality: extra.match.quality,
      native: extra.match.native,
      odds: extra.match.odds,
      engine: { win: r3a(x.win), form: x.form, comeback: x.comeback, setNow: x.setNow, holdNow: x.holdNow, read: x.read },
      stats: book.all.map((s) => ({ key: s.key, name: s.name, group: s.group, side: s.side, period: s.period, value: s.v.value, made: s.v.made, att: s.v.att, raw: s.v.raw, known: s.known }))
    };
  }
  return { ...m, pre: { p0: r3(p0), surface, src }, engine: { win: r3a(o.win), form: o.form, comeback: o.comeback, setNow: o.setNow } };
}
async function GET(request) {
  const q = new URL(request.url).searchParams;
  const sport = q.get("sport"), id = q.get("id") ?? "";
  const options = { odds: q.get("odds") === "1" };
  try {
    if (!sport) {
      const [foot, nba, tennis] = await Promise.all([footList().catch((e) => ({ error: String(e.message) })), nbaList().catch((e) => ({ error: String(e.message) })), tennisList().catch((e) => ({ error: String(e.message) }))]);
      return Response.json({ at: (/* @__PURE__ */ new Date()).toISOString(), foot, nba, tennis }, { headers: LIVE });
    }
    if (sport === "foot" && /^\d{4,10}$/.test(id)) return Response.json(await footOne(Number(id), options), { headers: LIVE });
    if (sport === "nba" && /^\d{6,12}$/.test(id)) return Response.json(await nbaOne(id, options), { headers: LIVE });
    if (sport === "tennis" && /^\d{4,12}$/.test(id)) {
      const all = [...await espnTennisLive("atp").catch(() => []), ...await espnTennisLive("wta").catch(() => [])];
      const m = all.find((x) => x.id === id);
      if (!m) return Response.json({ error: "Match introuvable ou pas commenc\xE9" }, { status: 404, headers: noStore });
      return Response.json(await tennisOne(m, options), { headers: LIVE });
    }
    return Response.json({ error: "Param\xE8tres invalides" }, { status: 400, headers: noStore });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502, headers: noStore });
  }
}
export {
  GET
};
