import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  createTowers,
  createUsers,
  predict,
  recommend,
  spawnUser,
  step,
  type Recommendation,
  type Tick,
  type Tower,
  type UserEquipment,
} from "@/lib/network-sim";

const TICK_MS = 700;
const MINUTES_PER_TICK = 6;
const MAX_HISTORY = 180;

export function useSimulation() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [users, setUsers] = useState<UserEquipment[]>([]);
  const [history, setHistory] = useState<Tick[]>([]);
  const [running, setRunning] = useState(true);
  const [loadFactor, setLoadFactor] = useState(1);
  const [userCount, setUserCount] = useState(220);
  const [autopilot, setAutopilot] = useState(false);
  const [applied, setApplied] = useState<Recommendation[]>([]);
  const [selectedTower, setSelectedTower] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const tRef = useRef(0);
  const clockRef = useRef(7 * 60);

  // Initialise on the client only (avoids SSR/hydration mismatch from Math.random).
  useEffect(() => {
    setTowers(createTowers());
    setUsers(createUsers(220));
    setReady(true);
  }, []);

  // Keep UE population in sync with the requested count.
  useEffect(() => {
    setUsers((prev) => {
      if (!prev.length && !ready) return prev;
      if (prev.length === userCount) return prev;
      if (prev.length > userCount) return prev.slice(0, userCount);
      return [
        ...prev,
        ...Array.from({ length: userCount - prev.length }, () => spawnUser()),
      ];
    });
  }, [userCount, ready]);

  const tick = useCallback(() => {
    setUsers((prevUsers) => {
      let nextUsers = prevUsers;
      setTowers((prevTowers) => {
        tRef.current += 1;
        clockRef.current += MINUTES_PER_TICK;
        const res = step(
          prevTowers,
          prevUsers,
          tRef.current,
          clockRef.current,
          loadFactor,
        );
        nextUsers = res.users;
        setHistory((h) => [...h, res.tick].slice(-MAX_HISTORY));
        return prevTowers;
      });
      return nextUsers;
    });
  }, [loadFactor]);

  useEffect(() => {
    if (!running || !ready) return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [running, ready, tick]);

  const predictions = useMemo(
    () => predict(towers, history),
    [towers, history],
  );
  const last = history.at(-1);
  const recommendations = useMemo(
    () => recommend(towers, predictions, last),
    [towers, predictions, last],
  );

  const apply = useCallback((rec: Recommendation) => {
    setTowers((prev) =>
      prev.map((t) => (t.id === rec.towerId ? applyAction(t, rec.action) : t)),
    );
    setApplied((prev) => [rec, ...prev].slice(0, 12));
  }, []);

  // Autonomous mode: apply the top-reward action whenever risk is critical.
  useEffect(() => {
    if (!autopilot) return;
    const top = recommendations[0];
    if (top && top.severity === "high") apply(top);
  }, [autopilot, recommendations, apply]);

  const reset = useCallback(() => {
    tRef.current = 0;
    clockRef.current = 7 * 60;
    setTowers(createTowers());
    setUsers(createUsers(userCount));
    setHistory([]);
    setApplied([]);
  }, [userCount]);

  return {
    towers,
    users,
    history,
    last,
    predictions,
    recommendations,
    applied,
    running,
    setRunning,
    loadFactor,
    setLoadFactor,
    userCount,
    setUserCount,
    autopilot,
    setAutopilot,
    apply,
    reset,
    selectedTower,
    setSelectedTower,
    clockMin: clockRef.current,
    ready,
  };
}
