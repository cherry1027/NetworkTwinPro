import type { Prediction, Tick, Tower, UserEquipment } from "@/lib/network-sim";

interface Props {
  towers: Tower[];
  users: UserEquipment[];
  last: Tick | undefined;
  predictions: Prediction[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const riskColor = (u: number) =>
  u >= 0.85 ? "var(--destructive)" : u >= 0.65 ? "var(--warning)" : "var(--primary)";

export function NetworkMap({
  towers,
  users,
  last,
  predictions,
  selected,
  onSelect,
}: Props) {
  const predById = new Map(predictions.map((p) => [p.towerId, p]));

  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full"
      role="img"
      aria-label="Live radio network topology map with towers and connected users"
    >
      <defs>
        <radialGradient id="cellFill">
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.03" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
        </radialGradient>
      </defs>

      {/* coverage footprints */}
      {towers.map((tw) => {
        const util = last?.perTower[tw.id]?.utilization ?? 0;
        const c = tw.enabled ? riskColor(util) : "var(--muted-foreground)";
        const isSel = selected === tw.id;
        return (
          <g key={`cov-${tw.id}`} style={{ color: c }}>
            <circle
              cx={tw.x}
              cy={tw.y}
              r={tw.radius}
              fill="url(#cellFill)"
              stroke={c}
              strokeWidth={isSel ? 0.45 : 0.18}
              strokeOpacity={tw.enabled ? (isSel ? 0.9 : 0.45) : 0.2}
              strokeDasharray={tw.enabled ? undefined : "1.2 1.2"}
            />
          </g>
        );
      })}

      {/* attachments */}
      {users.map((u) => {
        const tw = towers.find((t) => t.id === u.servingTowerId);
        if (!tw) return null;
        if (selected && tw.id !== selected) return null;
        return (
          <line
            key={`l-${u.id}`}
            x1={u.x}
            y1={u.y}
            x2={tw.x}
            y2={tw.y}
            stroke="var(--primary)"
            strokeWidth={0.06}
            strokeOpacity={selected ? 0.35 : 0.12}
          />
        );
      })}

      {/* UEs */}
      {users.map((u) => (
        <circle
          key={u.id}
          cx={u.x}
          cy={u.y}
          r={0.55}
          fill={
            !u.servingTowerId
              ? "var(--destructive)"
              : u.throughputMbps < 1.5
                ? "var(--warning)"
                : "var(--success)"
          }
          fillOpacity={0.85}
        />
      ))}

      {/* towers */}
      {towers.map((tw) => {
        const m = last?.perTower[tw.id];
        const util = m?.utilization ?? 0;
        const c = tw.enabled ? riskColor(util) : "var(--muted-foreground)";
        const p = predById.get(tw.id);
        return (
          <g
            key={tw.id}
            className="cursor-pointer"
            onClick={() => onSelect(selected === tw.id ? null : tw.id)}
          >
            {p?.risk === "critical" && tw.enabled && (
              <circle cx={tw.x} cy={tw.y} r={4} fill={c} fillOpacity={0.18}>
                <animate
                  attributeName="r"
                  values="2.5;7;2.5"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
            <rect
              x={tw.x - 1.6}
              y={tw.y - 1.6}
              width={3.2}
              height={3.2}
              rx={0.7}
              fill="var(--background)"
              stroke={c}
              strokeWidth={0.5}
            />
            <circle cx={tw.x} cy={tw.y} r={0.8} fill={c} />
            <text
              x={tw.x}
              y={tw.y - 2.6}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              style={{ fontSize: 1.9, fontFamily: "var(--font-mono)" }}
            >
              {tw.name}
            </text>
            <text
              x={tw.x}
              y={tw.y + 4.4}
              textAnchor="middle"
              fill={c}
              style={{ fontSize: 2, fontFamily: "var(--font-mono)" }}
            >
              {tw.enabled ? `${Math.round(util * 100)}%` : "SLEEP"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
