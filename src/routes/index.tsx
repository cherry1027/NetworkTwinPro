import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Antenna,
  Bot,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Signal,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { NetworkMap } from "@/components/network-map";
import { TrafficChart } from "@/components/traffic-chart";
import { useSimulation } from "@/hooks/use-simulation";
import { formatClock, type Recommendation } from "@/lib/network-sim";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RAN Digital Twin — AI Network Simulation & Congestion Forecast" },
      {
        name: "description",
        content:
          "Live cellular network digital twin: simulated towers and users, traffic generation, AI congestion prediction and autonomous optimisation recommendations.",
      },
      { property: "og:title", content: "RAN Digital Twin — AI Network Simulation" },
      {
        property: "og:description",
        content:
          "Simulate a radio access network, forecast cell congestion and apply AI-driven resource-allocation actions in real time.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const sim = useSimulation();
  const { last, towers, predictions } = sim;

  const totalOffered = last?.totalOffered ?? 0;
  const totalServed = last?.totalServed ?? 0;
  const efficiency = totalOffered ? (totalServed / totalOffered) * 100 : 100;
  const avgSinr =
    towers.length && last
      ? towers.reduce((s, t) => s + (last.perTower[t.id]?.avgSinrDb ?? 0), 0) /
        towers.length
      : 0;
  const critical = predictions.filter((p) => p.risk === "critical").length;

  return (
    <main className="min-h-screen p-4 lg:p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Antenna className="h-5 w-5" />
            <span className="tabular text-xs uppercase tracking-[0.25em]">
              Radio Access Network · Digital Twin
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
            Autonomous Network Operations Twin
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A live simulation of a 6-cell 5G cluster — mobility, diurnal traffic,
            scheduling, congestion forecasting and closed-loop AI optimisation.
          </p>
        </div>
        <div className="tabular flex items-center gap-3 text-sm">
          <div className="panel px-3 py-2">
            <div className="text-[10px] uppercase text-muted-foreground">Sim clock</div>
            <div className="text-lg text-primary">
              {formatClock(last?.clockMin ?? 420)}
            </div>
          </div>
          <div className="panel px-3 py-2">
            <div className="text-[10px] uppercase text-muted-foreground">Tick</div>
            <div className="text-lg">{last?.t ?? 0}</div>
          </div>
        </div>
      </header>

      <Controls sim={sim} />

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          icon={<Users className="h-4 w-4" />}
          label="Attached UEs"
          value={`${last?.attached ?? 0}`}
          sub={`${sim.users.length} in area`}
        />
        <Kpi
          icon={<Activity className="h-4 w-4" />}
          label="Offered traffic"
          value={`${Math.round(totalOffered)}`}
          sub="Mbps demand"
        />
        <Kpi
          icon={<Gauge className="h-4 w-4" />}
          label="Served traffic"
          value={`${Math.round(totalServed)}`}
          sub={`${efficiency.toFixed(1)}% efficiency`}
          tone={efficiency < 92 ? "warning" : "success"}
        />
        <Kpi
          icon={<Signal className="h-4 w-4" />}
          label="Avg SINR"
          value={`${avgSinr.toFixed(1)}`}
          sub="dB across cluster"
        />
        <Kpi
          icon={<Zap className="h-4 w-4" />}
          label="Cells at risk"
          value={`${critical}`}
          sub={`${last?.dropped ?? 0} sessions dropped`}
          tone={critical ? "destructive" : "success"}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="panel relative overflow-hidden p-3">
          <PanelTitle>
            Topology · live radio map
            <span className="text-[10px] font-normal text-muted-foreground">
              click a cell to isolate its UEs
            </span>
          </PanelTitle>
          <div className="aspect-square w-full">
            <NetworkMap
              towers={sim.towers}
              users={sim.users}
              last={last}
              predictions={predictions}
              selected={sim.selectedTower}
              onSelect={sim.setSelectedTower}
            />
          </div>
          <Legend />
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel p-3">
            <PanelTitle>Cluster throughput</PanelTitle>
            <div className="h-56">
              <TrafficChart history={sim.history} />
            </div>
          </div>
          <div className="panel p-3">
            <PanelTitle>
              Congestion forecast
              <span className="text-[10px] font-normal text-muted-foreground">
                EWMA + trend · 12-tick horizon
              </span>
            </PanelTitle>
            <div className="mt-2 space-y-2">
              {predictions.map((p) => {
                const tw = towers.find((t) => t.id === p.towerId);
                if (!tw) return null;
                return (
                  <div key={p.towerId} className="space-y-1">
                    <div className="tabular flex items-center justify-between text-xs">
                      <span className="text-foreground">{tw.name}</span>
                      <span className="text-muted-foreground">
                        now {(p.current * 100).toFixed(0)}% →{" "}
                        <span className={toneText(p.risk)}>
                          {(p.predicted * 100).toFixed(0)}%
                        </span>
                        {p.etaTicks !== null && (
                          <span className="ml-2 text-warning">ETA {p.etaTicks}t</span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${toneBg(p.risk)}`}
                        style={{ width: `${Math.min(100, p.predicted * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="panel overflow-hidden">
          <PanelTitle className="p-3">Cell inventory</PanelTitle>
          <div className="overflow-x-auto">
            <table className="tabular w-full text-xs">
              <thead className="bg-surface-2 text-left text-muted-foreground">
                <tr>
                  {["Cell", "Band", "UEs", "Load", "Capacity", "SINR", "Tilt", "State"].map(
                    (h) => (
                      <th key={h} className="px-3 py-2 font-normal">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {towers.map((tw) => {
                  const m = last?.perTower[tw.id];
                  const util = m?.utilization ?? 0;
                  return (
                    <tr
                      key={tw.id}
                      onClick={() =>
                        sim.setSelectedTower(sim.selectedTower === tw.id ? null : tw.id)
                      }
                      className={`cursor-pointer border-t border-border transition-colors hover:bg-surface-2 ${
                        sim.selectedTower === tw.id ? "bg-surface-2" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-foreground">{tw.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{tw.band}</td>
                      <td className="px-3 py-2">{m?.attached ?? 0}</td>
                      <td
                        className={`px-3 py-2 ${
                          util >= 0.85
                            ? "text-destructive"
                            : util >= 0.65
                              ? "text-warning"
                              : "text-success"
                        }`}
                      >
                        {(util * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {tw.capacityMbps} Mbps
                      </td>
                      <td className="px-3 py-2">{(m?.avgSinrDb ?? 0).toFixed(1)} dB</td>
                      <td className="px-3 py-2 text-muted-foreground">{tw.tiltDeg}°</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            tw.enabled
                              ? "bg-success/15 text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {tw.enabled ? "ACTIVE" : "SLEEP"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel p-3">
            <PanelTitle>
              <span className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-accent" /> AI recommendations
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">
                greedy policy · ranked by reward
              </span>
            </PanelTitle>
            <div className="mt-2 space-y-2">
              {sim.recommendations.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Network is within policy. No intervention required.
                </p>
              )}
              {sim.recommendations.map((r) => (
                <RecCard key={r.id} rec={r} onApply={() => sim.apply(r)} />
              ))}
            </div>
          </div>

          <div className="panel p-3">
            <PanelTitle>Action log</PanelTitle>
            <ul className="tabular mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
              {sim.applied.length === 0 && <li>No actions applied yet.</li>}
              {sim.applied.map((a, i) => (
                <li key={`${a.id}-${i}`} className="flex gap-2">
                  <span className="text-primary">▸</span>
                  <span>
                    {a.action.replace(/_/g, " ")} — {a.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="tabular mt-6 pb-4 text-center text-[11px] text-muted-foreground">
        Digital twin runs entirely in the browser — mobility, path loss, SINR,
        proportional-fair scheduling, forecasting and closed-loop control.
      </footer>
    </main>
  );
}

function Controls({ sim }: { sim: ReturnType<typeof useSimulation> }) {
  return (
    <div className="panel flex flex-wrap items-center gap-4 p-3">
      <button
        onClick={() => sim.setRunning(!sim.running)}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {sim.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {sim.running ? "Pause" : "Resume"}
      </button>
      <button
        onClick={sim.reset}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-2"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reset twin
      </button>

      <label className="tabular flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        UEs
        <input
          type="range"
          min={40}
          max={600}
          step={20}
          value={sim.userCount}
          onChange={(e) => sim.setUserCount(Number(e.target.value))}
          className="w-32 accent-[var(--primary)]"
        />
        <span className="w-9 text-foreground">{sim.userCount}</span>
      </label>

      <label className="tabular flex items-center gap-2 text-xs text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        Demand
        <input
          type="range"
          min={0.4}
          max={3}
          step={0.1}
          value={sim.loadFactor}
          onChange={(e) => sim.setLoadFactor(Number(e.target.value))}
          className="w-32 accent-[var(--primary)]"
        />
        <span className="w-9 text-foreground">{sim.loadFactor.toFixed(1)}×</span>
      </label>

      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Bot className="h-3.5 w-3.5" /> Autonomous mode
        </span>
        <input
          type="checkbox"
          checked={sim.autopilot}
          onChange={(e) => sim.setAutopilot(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
      </label>
    </div>
  );
}

function RecCard({ rec, onApply }: { rec: Recommendation; onApply: () => void }) {
  const tone =
    rec.severity === "high"
      ? "border-destructive/50 bg-destructive/5"
      : rec.severity === "medium"
        ? "border-warning/40 bg-warning/5"
        : "border-border bg-surface-2/50";
  return (
    <div className={`rounded-md border p-2.5 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{rec.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {rec.detail}
          </p>
        </div>
        <button
          onClick={onApply}
          className="tabular shrink-0 rounded border border-primary/60 px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          APPLY
        </button>
      </div>
      <div className="tabular mt-2 flex gap-3 text-[10px] text-muted-foreground">
        <span className="text-success">{rec.gain}</span>
        <span>reward {rec.reward.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-primary";
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className={color}>{icon}</span>
        {label}
      </div>
      <div className={`tabular mt-1.5 text-2xl ${color}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function PanelTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`tabular flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground ${className}`}
    >
      {children}
    </h2>
  );
}

function Legend() {
  const items = [
    ["bg-success", "UE served"],
    ["bg-warning", "Degraded"],
    ["bg-destructive", "Out of coverage / congested cell"],
  ] as const;
  return (
    <div className="tabular mt-2 flex flex-wrap gap-4 text-[10px] text-muted-foreground">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${c}`} />
          {l}
        </span>
      ))}
    </div>
  );
}

const toneText = (r: string) =>
  r === "critical" ? "text-destructive" : r === "watch" ? "text-warning" : "text-success";
const toneBg = (r: string) =>
  r === "critical" ? "bg-destructive" : r === "watch" ? "bg-warning" : "bg-primary";
