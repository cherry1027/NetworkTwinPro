// Network Digital Twin simulation engine.
// Pure TypeScript: towers, UEs (users), mobility, traffic, congestion
// prediction (EWMA + linear trend) and heuristic RL-style recommendations.

export type Band = "n78" | "n28" | "n258";

export interface Tower {
  id: string;
  name: string;
  x: number; // 0..100 grid units
  y: number;
  band: Band;
  radius: number; // coverage radius in grid units
  capacityMbps: number; // configurable via power/bandwidth actions
  txPowerDbm: number;
  tiltDeg: number;
  enabled: boolean;
}

export interface UserEquipment {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  demandMbps: number;
  servingTowerId: string | null;
  sinrDb: number;
  throughputMbps: number;
}

export interface TowerMetric {
  towerId: string;
  attached: number;
  offeredMbps: number;
  servedMbps: number;
  utilization: number; // 0..1+
  avgSinrDb: number;
  drops: number;
}

export interface Tick {
  t: number;
  clockMin: number;
  totalOffered: number;
  totalServed: number;
  attached: number;
  dropped: number;
  perTower: Record<string, TowerMetric>;
}

export interface Prediction {
  towerId: string;
  current: number;
  predicted: number; // utilization forecast, horizon ticks ahead
  slope: number;
  risk: "ok" | "watch" | "critical";
  etaTicks: number | null;
}

export interface Recommendation {
  id: string;
  towerId: string;
  action:
    | "increase_bandwidth"
    | "reduce_tilt"
    | "load_balance"
    | "sleep_cell"
    | "boost_power";
  title: string;
  detail: string;
  gain: string;
  severity: "high" | "medium" | "low";
  reward: number;
}

const BAND_PROFILE: Record<Band, { radius: number; capacity: number }> = {
  n78: { radius: 22, capacity: 900 },
  n28: { radius: 34, capacity: 420 },
  n258: { radius: 12, capacity: 1800 },
};

let uid = 0;
const nextId = (p: string) => `${p}-${(++uid).toString(36)}`;

export function createTowers(): Tower[] {
  const layout: Array<[string, number, number, Band]> = [
    ["Kista-01", 22, 24, "n78"],
    ["Kista-02", 62, 18, "n78"],
    ["Solna-03", 82, 46, "n28"],
    ["Central-04", 46, 48, "n258"],
    ["Sodermalm-05", 26, 72, "n78"],
    ["Hammarby-06", 68, 78, "n28"],
  ];
  return layout.map(([name, x, y, band]) => ({
    id: nextId("twr"),
    name,
    x,
    y,
    band,
    radius: BAND_PROFILE[band].radius,
    capacityMbps: BAND_PROFILE[band].capacity,
    txPowerDbm: band === "n258" ? 52 : band === "n78" ? 44 : 41,
    tiltDeg: 6,
    enabled: true,
  }));
}

export function createUsers(n: number): UserEquipment[] {
  return Array.from({ length: n }, () => spawnUser());
}

export function spawnUser(): UserEquipment {
  const clusters = [
    [46, 48],
    [24, 26],
    [66, 76],
    [80, 44],
  ];
  const c = clusters[Math.floor(Math.random() * clusters.length)]!;
  return {
    id: nextId("ue"),
    x: clamp(c[0]! + gauss() * 16, 2, 98),
    y: clamp(c[1]! + gauss() * 16, 2, 98),
    vx: gauss() * 0.35,
    vy: gauss() * 0.35,
    demandMbps: Math.max(0.6, 4 + gauss() * 5),
    servingTowerId: null,
    sinrDb: 0,
    throughputMbps: 0,
  };
}

function gauss() {
  return (
    (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.9
  );
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Diurnal traffic multiplier, clockMin = minutes into simulated day. */
export function trafficMultiplier(clockMin: number) {
  const h = (clockMin / 60) % 24;
  const morning = Math.exp(-((h - 9) ** 2) / 6);
  const evening = Math.exp(-((h - 19.5) ** 2) / 8) * 1.35;
  const base = 0.35;
  return base + morning + evening;
}

function pathLoss(dist: number, band: Band) {
  const f = band === "n258" ? 26 : band === "n78" ? 3.5 : 0.7; // GHz
  return 32.4 + 20 * Math.log10(Math.max(dist, 0.5) * 0.1) + 20 * Math.log10(f);
}

export interface StepResult {
  users: UserEquipment[];
  tick: Tick;
}

export function step(
  towers: Tower[],
  users: UserEquipment[],
  t: number,
  clockMin: number,
  loadFactor: number,
): StepResult {
  // 1. Mobility
  const moved = users.map((u) => {
    let { x, y, vx, vy } = u;
    vx = clamp(vx + gauss() * 0.12, -1.4, 1.4);
    vy = clamp(vy + gauss() * 0.12, -1.4, 1.4);
    x += vx;
    y += vy;
    if (x < 1 || x > 99) vx = -vx;
    if (y < 1 || y > 99) vy = -vy;
    return { ...u, x: clamp(x, 1, 99), y: clamp(y, 1, 99), vx, vy };
  });

  const mult = trafficMultiplier(clockMin) * loadFactor;
  const active = towers.filter((tw) => tw.enabled);

  // 2. Attach: best SINR-ish (min path loss adjusted by tx power / tilt)
  const perTower: Record<string, TowerMetric> = {};
  for (const tw of towers) {
    perTower[tw.id] = {
      towerId: tw.id,
      attached: 0,
      offeredMbps: 0,
      servedMbps: 0,
      utilization: 0,
      avgSinrDb: 0,
      drops: 0,
    };
  }

  const sinrSum: Record<string, number> = {};
  const assigned = moved.map((u) => {
    let best: Tower | null = null;
    let bestRx = -Infinity;
    let bestScore = -Infinity;
    let interference = 0;
    for (const tw of active) {
      const d = Math.hypot(tw.x - u.x, tw.y - u.y);
      if (d > tw.radius * 1.15) continue;
      const rx =
        tw.txPowerDbm - pathLoss(d, tw.band) - Math.abs(tw.tiltDeg - 6) * 0.8;
      const lin = 10 ** (rx / 10);
      interference += lin;
      // Cell-individual offset: selection is normalised by each cell's own
      // footprint so bands don't starve each other (like real CIO/A3 offsets).
      const score = -(d / tw.radius) * 20 + (tw.txPowerDbm - 44) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestRx = rx;
        best = tw;
      }
    }

    if (!best) {
      return { ...u, servingTowerId: null, sinrDb: -20, throughputMbps: 0 };
    }
    const bestLin = 10 ** (bestRx / 10);
    const noise = 1e-11;
    const sinr = 10 * Math.log10(bestLin / (interference - bestLin + noise));
    const demand = u.demandMbps * mult;
    const m = perTower[best.id]!;
    m.attached += 1;
    m.offeredMbps += demand;
    sinrSum[best.id] = (sinrSum[best.id] ?? 0) + sinr;
    return {
      ...u,
      servingTowerId: best.id,
      sinrDb: sinr,
      throughputMbps: demand,
    };
  });

  // 3. Scheduling — proportional share of tower capacity
  let dropped = 0;
  for (const tw of towers) {
    const m = perTower[tw.id]!;
    m.avgSinrDb = m.attached ? (sinrSum[tw.id] ?? 0) / m.attached : 0;
    m.utilization = tw.enabled ? m.offeredMbps / tw.capacityMbps : 0;
    m.servedMbps = Math.min(m.offeredMbps, tw.capacityMbps);
    if (m.utilization > 1.15) {
      m.drops = Math.round(m.attached * (m.utilization - 1.15) * 0.5);
      dropped += m.drops;
    }
  }

  const final = assigned.map((u) => {
    if (!u.servingTowerId) return u;
    const m = perTower[u.servingTowerId]!;
    const share = m.utilization > 1 ? 1 / m.utilization : 1;
    const q = clamp((u.sinrDb + 5) / 25, 0.25, 1);
    return { ...u, throughputMbps: u.throughputMbps * share * q };
  });

  const tick: Tick = {
    t,
    clockMin,
    totalOffered: sum(Object.values(perTower).map((m) => m.offeredMbps)),
    totalServed: sum(Object.values(perTower).map((m) => m.servedMbps)),
    attached: final.filter((u) => u.servingTowerId).length,
    dropped,
    perTower,
  };
  return { users: final, tick };
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** EWMA-smoothed linear-trend forecast of utilization, `horizon` ticks ahead. */
export function predict(
  towers: Tower[],
  history: Tick[],
  horizon = 12,
): Prediction[] {
  const window = history.slice(-24);
  return towers.map((tw) => {
    const series = window
      .map((h) => h.perTower[tw.id]?.utilization ?? 0)
      .filter((v) => Number.isFinite(v));
    const current = series.at(-1) ?? 0;
    if (series.length < 4) {
      return {
        towerId: tw.id,
        current,
        predicted: current,
        slope: 0,
        risk: riskOf(current),
        etaTicks: null,
      };
    }
    // EWMA smoothing
    const alpha = 0.4;
    const sm: number[] = [];
    series.forEach((v, i) => sm.push(i === 0 ? v : alpha * v + (1 - alpha) * sm[i - 1]!));
    // least squares slope
    const n = sm.length;
    const mx = (n - 1) / 2;
    const my = sum(sm) / n;
    let num = 0;
    let den = 0;
    sm.forEach((v, i) => {
      num += (i - mx) * (v - my);
      den += (i - mx) ** 2;
    });
    const slope = den ? num / den : 0;
    const smoothed = sm.at(-1)!;
    const predicted = Math.max(0, smoothed + slope * horizon);
    const eta =
      slope > 0.0005 && smoothed < 0.85
        ? Math.round((0.85 - smoothed) / slope)
        : null;
    return {
      towerId: tw.id,
      current,
      predicted,
      slope,
      risk: riskOf(Math.max(current, predicted)),
      etaTicks: eta !== null && eta <= 60 ? eta : null,
    };
  });
}

function riskOf(u: number): Prediction["risk"] {
  if (u >= 0.85) return "critical";
  if (u >= 0.65) return "watch";
  return "ok";
}

/**
 * Policy layer: scores candidate actions per cell (a greedy one-step
 * Q-approximation) and emits the highest-reward interventions.
 */
export function recommend(
  towers: Tower[],
  preds: Prediction[],
  last: Tick | undefined,
): Recommendation[] {
  if (!last) return [];
  const byId = new Map(towers.map((t) => [t.id, t]));
  const out: Recommendation[] = [];

  for (const p of preds) {
    const tw = byId.get(p.towerId);
    if (!tw) continue;
    const m = last.perTower[tw.id];
    if (!m) continue;
    const head = p.predicted;

    if (head >= 0.85 && tw.enabled) {
      const neighbour = towers
        .filter(
          (o) =>
            o.id !== tw.id &&
            o.enabled &&
            Math.hypot(o.x - tw.x, o.y - tw.y) < tw.radius + o.radius &&
            (last.perTower[o.id]?.utilization ?? 1) < 0.55,
        )
        .sort(
          (a, b) =>
            (last.perTower[a.id]?.utilization ?? 1) -
            (last.perTower[b.id]?.utilization ?? 1),
        )[0];

      if (neighbour) {
        out.push({
          id: `${tw.id}-lb`,
          towerId: tw.id,
          action: "load_balance",
          title: `Offload ${tw.name} → ${neighbour.name}`,
          detail: `Predicted load ${(head * 100).toFixed(0)}% in 12 ticks. Down-tilt ${tw.name} and raise ${neighbour.name} power to steer ~${Math.round(m.attached * 0.25)} UEs to an underused neighbour cell.`,
          gain: `−${Math.round((head - 0.7) * 100)} pp load`,
          severity: "high",
          reward: (head - 0.6) * 2.4,
        });
      } else {
        out.push({
          id: `${tw.id}-bw`,
          towerId: tw.id,
          action: "increase_bandwidth",
          title: `Allocate carrier bandwidth to ${tw.name}`,
          detail: `Cell is forecast at ${(head * 100).toFixed(0)}% utilization with ${m.drops} sessions at risk. Add a secondary component carrier (+25% capacity).`,
          gain: "+25% capacity",
          severity: "high",
          reward: (head - 0.6) * 2.1,
        });
      }
    } else if (head >= 0.65 && tw.enabled) {
      out.push({
        id: `${tw.id}-tilt`,
        towerId: tw.id,
        action: "reduce_tilt",
        title: `Pre-emptive tilt optimisation on ${tw.name}`,
        detail: `Trend is +${(p.slope * 100).toFixed(1)} pp/tick${p.etaTicks !== null ? `, congestion in ~${p.etaTicks} ticks` : ""}. Tighten the beam to shrink the overlap zone before load peaks.`,
        gain: "+1.5 dB avg SINR",
        severity: "medium",
        reward: (head - 0.5) * 1.2,
      });
    } else if (head < 0.08 && m.attached < 3 && tw.enabled) {
      out.push({
        id: `${tw.id}-sleep`,
        towerId: tw.id,
        action: "sleep_cell",
        title: `Energy saving: sleep ${tw.name}`,
        detail: `Only ${m.attached} attached UEs at ${(head * 100).toFixed(0)}% load. Neighbour coverage is sufficient — put the cell in micro-sleep.`,
        gain: "−18% site energy",
        severity: "low",
        reward: 0.4,
      });
    } else if (!tw.enabled) {
      out.push({
        id: `${tw.id}-wake`,
        towerId: tw.id,
        action: "boost_power",
        title: `Re-activate ${tw.name}`,
        detail: `Cell is asleep while the grid load is rising. Wake it to restore coverage capacity.`,
        gain: "restore coverage",
        severity: "medium",
        reward: 0.6,
      });
    }
  }
  return out.sort((a, b) => b.reward - a.reward).slice(0, 5);
}

export function applyAction(tower: Tower, action: Recommendation["action"]): Tower {
  switch (action) {
    case "increase_bandwidth":
      return { ...tower, capacityMbps: Math.round(tower.capacityMbps * 1.25) };
    case "reduce_tilt":
      return { ...tower, tiltDeg: clamp(tower.tiltDeg + 2, 0, 14), radius: tower.radius * 0.92 };
    case "load_balance":
      return { ...tower, radius: tower.radius * 0.88, tiltDeg: clamp(tower.tiltDeg + 1, 0, 14) };
    case "sleep_cell":
      return { ...tower, enabled: false };
    case "boost_power":
      return { ...tower, enabled: true, txPowerDbm: clamp(tower.txPowerDbm + 2, 30, 49) };
    default:
      return tower;
  }
}

export function formatClock(clockMin: number) {
  const h = Math.floor((clockMin / 60) % 24);
  const m = Math.floor(clockMin % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
