import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const CELL = 32;
const COLS = 22;
const ROWS = 18;

const CellType = {
  EMPTY: 0, START: 1, DESTINATION: 2, WIND: 3, RAIN: 4,
  HIGH_BUILDING: 5, NO_FLY: 6, DRONE: 7, TRAIL: 8, FINAL_PATH: 9, MULTI_DESTINATION: 10,
};

const COST_MAP = {
  [CellType.EMPTY]: 1, [CellType.START]: 1, [CellType.DESTINATION]: 1,
  [CellType.MULTI_DESTINATION]: 1, [CellType.TRAIL]: 1, [CellType.FINAL_PATH]: 1,
  [CellType.WIND]: 999999, [CellType.RAIN]: 999999,
  [CellType.HIGH_BUILDING]: 999999, [CellType.NO_FLY]: 999999,
};

const HINDRANCE_TYPES = [CellType.WIND, CellType.RAIN, CellType.HIGH_BUILDING, CellType.NO_FLY];

const COLORS = {
  [CellType.EMPTY]: "#0a0a0a",
  [CellType.START]: "#00ff41",
  [CellType.MULTI_DESTINATION]: "#ffe600",
  [CellType.WIND]: "rgba(0,120,255,0.45)",
  [CellType.RAIN]: "rgba(100,100,255,0.45)",
  [CellType.HIGH_BUILDING]: "#ff3232",
  [CellType.NO_FLY]: "#8b0000",
  [CellType.TRAIL]: "#00f0ff",
  [CellType.FINAL_PATH]: "#39ff14",
};

const ICONS = {
  [CellType.WIND]: "💨",
  [CellType.RAIN]: "🌧️",
  [CellType.HIGH_BUILDING]: "🏢",
  [CellType.NO_FLY]: "⛔",
};

const HINDRANCE_LABELS = ["WIND SHEAR 💨", "ACID RAIN 🌧️", "STRUCTURE 🏢", "RESTRICTED ZONE ⛔"];

// ─── PATHFINDING (A*) ────────────────────────────────────────────────────────
function heuristic([ax, ay], [bx, by]) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function findPath(grid, start, end) {
  const key = ([x, y]) => `${x},${y}`;
  const open = new Map();
  const closed = new Set();
  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();

  gScore.set(key(start), 0);
  fScore.set(key(start), heuristic(start, end));
  open.set(key(start), start);

  while (open.size > 0) {
    let current = null;
    let minF = Infinity;
    for (const [k, node] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < minF) { minF = f; current = node; }
    }

    if (!current) break;
    const ck = key(current);

    if (current[0] === end[0] && current[1] === end[1]) {
      const path = [];
      let node = ck;
      while (node) { path.unshift(node.split(",").map(Number)); node = cameFrom.get(node); }
      return path;
    }

    open.delete(ck);
    closed.add(ck);

    const [cx, cy] = current;
    for (const [dx, dy] of [[0,1],[1,0],[0,-1],[-1,0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const cell = grid[ny][nx];
      if ((cell.cost ?? 1) >= 999999) continue;
      const nk = `${nx},${ny}`;
      if (closed.has(nk)) continue;

      const tentG = (gScore.get(ck) ?? Infinity) + (cell.cost ?? 1);
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, ck);
        gScore.set(nk, tentG);
        fScore.set(nk, tentG + heuristic([nx, ny], end));
        open.set(nk, [nx, ny]);
      }
    }
  }
  return null;
}

// ─── GRID FACTORY ────────────────────────────────────────────────────────────
function createGrid() {
  const grid = Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLS }, (_, x) => ({
      x, y, type: CellType.EMPTY, cost: 1, label: "",
    }))
  );
  grid[1][1].type = CellType.START;
  return grid;
}

function addRandomHindrances(grid, count = 5) {
  const newGrid = grid.map(row => row.map(c => ({ ...c })));
  let added = 0, attempts = 0;
  while (added < count && attempts < count * 10) {
    attempts++;
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);
    if ((x === 1 && y === 1) || newGrid[y][x].type === CellType.MULTI_DESTINATION) continue;
    const t = HINDRANCE_TYPES[Math.floor(Math.random() * HINDRANCE_TYPES.length)];
    newGrid[y][x] = { ...newGrid[y][x], type: t, cost: COST_MAP[t] };
    added++;
  }
  return newGrid;
}

function getNextLabel(count) {
  let num = count, label = "";
  while (true) {
    label = String.fromCharCode(65 + (num % 26)) + label;
    num = Math.floor(num / 26);
    if (num === 0) break;
    num -= 1;
  }
  return label;
}

// ─── NEAREST DESTINATION ─────────────────────────────────────────────────────
function findNearest(grid, from, destinations) {
  let nearest = null, minCost = Infinity;
  for (const dest of destinations) {
    const path = findPath(grid, from, [dest.x, dest.y]);
    if (path && path.length < minCost) {
      minCost = path.length;
      nearest = dest;
    }
  }
  return nearest;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [grid, setGrid] = useState(() => addRandomHindrances(createGrid()));
  const [destinations, setDestinations] = useState([]);
  const [clickMode, setClickMode] = useState(null); // null | 'destination' | 'hindrance'
  const [hindranceType, setHindranceType] = useState(0); // index into HINDRANCE_LABELS

  // Drone state
  const [isMoving, setIsMoving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [path, setPath] = useState([]);
  const [pathIndex, setPathIndex] = useState(0);
  const [trail, setTrail] = useState(new Set());
  const [finalPath, setFinalPath] = useState(new Set());
  const [status, setStatus] = useState("READY");
  const [distance, setDistance] = useState(0);
  const [replanCount, setReplanCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [deliveryLog, setDeliveryLog] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [missionResult, setMissionResult] = useState(null); // null | 'success' | 'partial' | 'blocked'

  // Refs for animation loop
  const stateRef = useRef({});
  stateRef.current = { grid, path, pathIndex, destinations, isMoving, isPaused, distance, replanCount, completed, blocked, elapsedSeconds };

  const animRef = useRef(null);
  const timerRef = useRef(null);
  const remainingRef = useRef([]);
  const currentTargetRef = useRef(null);

  // ── DRAW ──────────────────────────────────────────────────────────────────
  const canvasRef = useRef(null);
  const dronePos = path.length && pathIndex < path.length ? path[pathIndex] : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);

    // Background
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = grid[y][x];
        const px = x * CELL, py = y * CELL;
        const posKey = `${x},${y}`;

        if (finalPath.has(posKey)) {
          ctx.fillStyle = COLORS[CellType.FINAL_PATH];
          ctx.fillRect(px, py, CELL, CELL);
        } else if (trail.has(posKey) && !(x === 1 && y === 1)) {
          ctx.fillStyle = "rgba(0,240,255,0.3)";
          ctx.fillRect(px + 8, py + 8, CELL - 16, CELL - 16);
        } else if (cell.type === CellType.START) {
          ctx.fillStyle = COLORS[CellType.START];
          ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
        } else if (cell.type === CellType.MULTI_DESTINATION) {
          ctx.strokeStyle = COLORS[CellType.MULTI_DESTINATION];
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 3, py + 3, CELL - 6, CELL - 6);
          ctx.fillStyle = COLORS[CellType.MULTI_DESTINATION];
          ctx.font = "bold 13px 'Courier New'";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(cell.label, px + CELL / 2, py + CELL / 2);
        } else if (cell.type === CellType.WIND || cell.type === CellType.RAIN) {
          ctx.fillStyle = COLORS[cell.type];
          ctx.fillRect(px, py, CELL, CELL);
          ctx.font = "14px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ICONS[cell.type], px + CELL / 2, py + CELL / 2);
        } else if (cell.type === CellType.HIGH_BUILDING || cell.type === CellType.NO_FLY) {
          ctx.strokeStyle = COLORS[cell.type];
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
          ctx.font = "14px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ICONS[cell.type], px + CELL / 2, py + CELL / 2);
        }

        // Grid lines
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, CELL, CELL);
      }
    }

    // Draw START label
    ctx.fillStyle = "#00ff41";
    ctx.font = "bold 10px 'Courier New'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", 1 * CELL + CELL / 2, 1 * CELL + CELL / 2);

    // Draw drone
    if (dronePos) {
      const [dx, dy] = dronePos;
      const px = dx * CELL, py = dy * CELL;
      const grad = ctx.createRadialGradient(px + CELL/2, py + CELL/2, 2, px + CELL/2, py + CELL/2, CELL/2);
      grad.addColorStop(0, "rgba(0,240,255,0.6)");
      grad.addColorStop(1, "rgba(0,240,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px + CELL/2, py + CELL/2, CELL/2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "18px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("💠", px + CELL/2, py + CELL/2);
    }
  }, [grid, dronePos, trail, finalPath]);

  // ── ANIMATION LOOP ────────────────────────────────────────────────────────
  const stepDrone = useCallback(() => {
    const s = stateRef.current;
    if (!s.isMoving || s.isPaused) return;

    const newIndex = s.pathIndex + 1;
    if (newIndex >= s.path.length) {
      // Path ended - check if there are more destinations
      if (remainingRef.current.length > 0 && currentTargetRef.current) {
        const label = currentTargetRef.current.label;
        remainingRef.current = remainingRef.current.filter(d => d.label !== label);
        setCompleted(prev => [...prev, label]);
        setDeliveryLog(prev => [...prev, `✓ DROP: ${label}`]);
      }
      finishDelivery();
      return;
    }

    const newPos = s.path[newIndex];
    setPathIndex(newIndex);
    setDistance(prev => prev + 1);
    setTrail(prev => new Set([...prev, `${newPos[0]},${newPos[1]}`]));

    // Check if reached current target
    if (currentTargetRef.current) {
      const t = currentTargetRef.current;
      if (newPos[0] === t.x && newPos[1] === t.y) {
        const label = t.label;
        remainingRef.current = remainingRef.current.filter(d => d.label !== label);
        setCompleted(prev => [...prev, label]);
        setDeliveryLog(prev => [...prev, `✓ DROP: ${label}`]);

        if (remainingRef.current.length === 0) {
          finishDelivery(label);
          return;
        }

        // Find next
        const next = findNearest(s.grid, newPos, remainingRef.current);
        if (!next) {
          setBlocked(remainingRef.current.map(d => d.label));
          finishDelivery(label, true);
          return;
        }
        currentTargetRef.current = next;
        setStatus(`DELIVERING TO ${next.label}...`);
        const newPath = findPath(s.grid, newPos, [next.x, next.y]);
        if (newPath) {
          setPath(prev => [...prev.slice(0, newIndex), ...newPath]);
        } else {
          setBlocked(prev => [...prev, next.label]);
          finishDelivery(label, true);
        }
      }
    }
  }, []);

  function finishDelivery(lastLabel, partial = false) {
    clearInterval(animRef.current);
    clearInterval(timerRef.current);
    setIsMoving(false);
    setPath(prev => {
      setFinalPath(new Set(prev.map(p => `${p[0]},${p[1]}`)));
      return prev;
    });
    setTrail(new Set());
    if (partial) {
      setStatus("MISSION PARTIAL");
      setMissionResult("partial");
    } else {
      setStatus("ALL DELIVERED!");
      setMissionResult("success");
    }
  }

  // ── START ─────────────────────────────────────────────────────────────────
  function startDelivery() {
    if (destinations.length === 0) { setStatus("NO TARGETS!"); return; }

    const start = [1, 1];
    remainingRef.current = [...destinations];
    const nearest = findNearest(grid, start, remainingRef.current);
    if (!nearest) { setStatus("NO PATH FOUND!"); setBlocked(destinations.map(d => d.label)); setMissionResult("blocked"); return; }

    currentTargetRef.current = nearest;
    const p = findPath(grid, start, [nearest.x, nearest.y]);
    if (!p) { setStatus("NO PATH FOUND!"); setBlocked([nearest.label]); setMissionResult("blocked"); return; }

    setPath(p);
    setPathIndex(0);
    setTrail(new Set());
    setFinalPath(new Set());
    setCompleted([]);
    setBlocked([]);
    setDeliveryLog([]);
    setDistance(0);
    setReplanCount(0);
    setElapsedSeconds(0);
    setIsMoving(true);
    setIsPaused(false);
    setMissionResult(null);
    setStatus(`DELIVERING TO ${nearest.label}...`);

    clearInterval(animRef.current);
    clearInterval(timerRef.current);
    animRef.current = setInterval(stepDrone, 150);
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
  }

  function pauseDelivery() {
    if (!isMoving) return;
    if (isPaused) {
      setIsPaused(false);
      animRef.current = setInterval(stepDrone, 150);
      timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      setIsPaused(true);
      clearInterval(animRef.current);
      clearInterval(timerRef.current);
    }
  }

  function resetAll() {
    clearInterval(animRef.current);
    clearInterval(timerRef.current);
    const fresh = addRandomHindrances(createGrid());
    setGrid(fresh);
    setDestinations([]);
    setPath([]);
    setPathIndex(0);
    setTrail(new Set());
    setFinalPath(new Set());
    setIsMoving(false);
    setIsPaused(false);
    setStatus("READY");
    setDistance(0);
    setReplanCount(0);
    setElapsedSeconds(0);
    setDeliveryLog([]);
    setCompleted([]);
    setBlocked([]);
    setMissionResult(null);
    remainingRef.current = [];
    currentTargetRef.current = null;
  }

  // ── GRID CLICK ────────────────────────────────────────────────────────────
  function handleCanvasClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = (COLS * CELL) / rect.width;
    const scaleY = (ROWS * CELL) / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX / CELL);
    const y = Math.floor((e.clientY - rect.top) * scaleY / CELL);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (x === 1 && y === 1) return;

    if (clickMode === "destination") {
      if (grid[y][x].type !== CellType.EMPTY && grid[y][x].type !== CellType.MULTI_DESTINATION) return;
      if (destinations.some(d => d.x === x && d.y === y)) {
        // toggle off
        const newDests = destinations.filter(d => !(d.x === x && d.y === y));
        const relabeled = newDests.map((d, i) => ({ ...d, label: getNextLabel(i) }));
        setDestinations(relabeled);
        const newGrid = grid.map(row => row.map(c => ({ ...c })));
        newDests.forEach((d, i) => {
          newGrid[d.y][d.x] = { ...newGrid[d.y][d.x], label: getNextLabel(i) };
        });
        newGrid[y][x] = { ...newGrid[y][x], type: CellType.EMPTY, label: "" };
        setGrid(newGrid);
      } else {
        const label = getNextLabel(destinations.length);
        setDestinations(prev => [...prev, { x, y, label }]);
        const newGrid = grid.map(row => row.map(c => ({ ...c })));
        newGrid[y][x] = { ...newGrid[y][x], type: CellType.MULTI_DESTINATION, cost: 1, label };
        setGrid(newGrid);
      }
    } else if (clickMode === "hindrance") {
      const t = HINDRANCE_TYPES[hindranceType];
      if (grid[y][x].type === CellType.MULTI_DESTINATION) return;
      const newGrid = grid.map(row => row.map(c => ({ ...c })));
      newGrid[y][x] = { ...newGrid[y][x], type: t, cost: COST_MAP[t], label: "" };
      setGrid(newGrid);
    }
  }

  function addRandomHindrance() {
    const t = HINDRANCE_TYPES[hindranceType];
    let attempts = 0;
    let newGrid = grid.map(row => row.map(c => ({ ...c })));
    while (attempts < 100) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if ((x === 1 && y === 1) || newGrid[y][x].type === CellType.MULTI_DESTINATION) { attempts++; continue; }
      newGrid[y][x] = { ...newGrid[y][x], type: t, cost: COST_MAP[t] };
      setGrid(newGrid);
      break;
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  const canW = COLS * CELL;
  const canH = ROWS * CELL;

  return (
    <div style={{
      minHeight: "100vh", background: "#050505", color: "#e0e0e0",
      fontFamily: "'Courier New', monospace", display: "flex", flexDirection: "column",
      alignItems: "center", padding: "16px", boxSizing: "border-box",
    }}>
      {/* Title */}
      <div style={{
        color: "#00f0ff", fontSize: "clamp(16px,2vw,26px)", fontWeight: "bold",
        letterSpacing: "6px", marginBottom: "14px", textShadow: "0 0 20px #00f0ff",
        textAlign: "center",
      }}>
        ⬡ TRON DRONE OS // v2.0
      </div>

      <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center", width: "100%" }}>

        {/* LEFT PANEL */}
        <Panel color="#00f0ff" style={{ minWidth: 180, maxWidth: 210 }}>
          <PanelTitle>SYSTEM STATS</PanelTitle>
          <StatRow label="TIME" value={`T+ ${elapsedSeconds}s`} />
          <StatRow label="DIST" value={distance} />
          <StatRow label="REPLAN" value={replanCount} />
          <div style={{ color: "#39ff14", fontWeight: "bold", fontSize: 11, marginTop: 6, letterSpacing: 1 }}>
            SYSTEM: {status}
          </div>
          <Divider />
          <PanelTitle>DELIVERY LOG</PanelTitle>
          <div style={{ fontSize: 11, color: "#ccc", minHeight: 60, maxHeight: 100, overflowY: "auto" }}>
            {deliveryLog.length === 0 ? <span style={{ color: "#444" }}>AWAITING LAUNCH...</span>
              : deliveryLog.map((l, i) => <div key={i} style={{ color: "#39ff14" }}>{l}</div>)}
          </div>

          {missionResult === "success" && (
            <AlertBox color="#39ff14">
              <div style={{ color: "#39ff14", fontWeight: "bold" }}>MISSION SUCCESS</div>
              <div style={{ fontSize: 10 }}>DELIVERED: {completed.join(" → ")}</div>
              <div style={{ fontSize: 10 }}>TIME: {elapsedSeconds}s | DIST: {distance}</div>
            </AlertBox>
          )}
          {(missionResult === "partial") && completed.length > 0 && (
            <AlertBox color="#ffe600">
              <div style={{ color: "#ffe600", fontWeight: "bold" }}>MISSION PARTIAL</div>
              <div style={{ fontSize: 10 }}>DONE: {completed.join(" → ")}</div>
              <div style={{ fontSize: 10 }}>TIME: {elapsedSeconds}s | DIST: {distance}</div>
            </AlertBox>
          )}
          {blocked.length > 0 && (
            <AlertBox color="#ff1e1e">
              <div style={{ color: "#ff1e1e", fontWeight: "bold" }}>PATH BLOCKED</div>
              <div style={{ fontSize: 10 }}>UNREACHABLE: {blocked.join(", ")}</div>
            </AlertBox>
          )}
        </Panel>

        {/* CANVAS */}
        <div style={{ flex: "0 0 auto" }}>
          <canvas
            ref={canvasRef}
            width={canW}
            height={canH}
            onClick={handleCanvasClick}
            style={{
              display: "block",
              cursor: clickMode ? "crosshair" : "default",
              border: "1px solid #00f0ff",
              boxShadow: "0 0 20px rgba(0,240,255,0.2)",
              maxWidth: "100%",
            }}
          />
          {/* Legend */}
          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap", justifyContent: "center", fontSize: 11, color: "#666" }}>
            {[["#00ff41","START"],["#ffe600","TARGET"],["rgba(0,120,255,0.7)","WIND"],
              ["rgba(100,100,255,0.7)","RAIN"],["#ff3232","BUILDING"],["#8b0000","NO-FLY"],
              ["#00f0ff","TRAIL"],["#39ff14","ROUTE"]].map(([col, lbl]) => (
              <span key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 10, height: 10, background: col, display: "inline-block", borderRadius: 2 }} />
                {lbl}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <Panel color="#00f0ff" style={{ minWidth: 180, maxWidth: 210 }}>
          <PanelTitle>COMMAND DECK</PanelTitle>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <TronBtn onClick={startDelivery} disabled={isMoving && !isPaused} color="#39ff14" title="INITIATE">▶</TronBtn>
            <TronBtn onClick={pauseDelivery} disabled={!isMoving} color="#00f0ff" title={isPaused ? "RESUME" : "HALT"}>{isPaused ? "▶▶" : "⏸"}</TronBtn>
            <TronBtn onClick={resetAll} color="#ff1e1e" title="REBOOT">⚡</TronBtn>
          </div>

          <Divider />
          <PanelTitle>TARGETING</PanelTitle>
          <TronBtnFull
            active={clickMode === "destination"}
            onClick={() => setClickMode(m => m === "destination" ? null : "destination")}
          >➕ ADD TARGET</TronBtnFull>
          <div style={{ fontSize: 11, color: destinations.length ? "#ffe600" : "#444", marginTop: 4, minHeight: 30 }}>
            {destinations.length === 0 ? "NO TARGETS LOCKED"
              : "LOCKED: " + destinations.map(d => d.label).join(", ")}
          </div>

          <Divider />
          <PanelTitle>OBSTACLES</PanelTitle>
          <select
            value={hindranceType}
            onChange={e => setHindranceType(+e.target.value)}
            style={{
              width: "100%", background: "#000", border: "1px solid #00f0ff",
              color: "#00f0ff", padding: "4px 6px", borderRadius: 3, fontSize: 12,
              marginBottom: 6, fontFamily: "inherit",
            }}
          >
            {HINDRANCE_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <TronBtnFull onClick={addRandomHindrance} style={{ flex: 1 }}>🎲 RND</TronBtnFull>
            <TronBtnFull
              active={clickMode === "hindrance"}
              onClick={() => setClickMode(m => m === "hindrance" ? null : "hindrance")}
              style={{ flex: 1 }}
            >🖱️ GRID</TronBtnFull>
          </div>
          {clickMode && (
            <div style={{ color: "#ffe600", fontWeight: "bold", textAlign: "center", marginTop: 4, fontSize: 11 }}>
              MODE: {clickMode === "destination" ? "ADD TARGET" : HINDRANCE_LABELS[hindranceType].split(" ")[0]}
            </div>
          )}
          <Divider />
          <div style={{ fontSize: 10, color: "#444", lineHeight: 1.6 }}>
            HOW TO USE:<br />
            1. Click ADD TARGET → click grid cells<br />
            2. Select obstacle type → RND or GRID<br />
            3. Click ▶ to launch drone<br />
            4. Add obstacles mid-flight!
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ─── SMALL UI COMPONENTS ─────────────────────────────────────────────────────
function Panel({ children, color = "#00f0ff", style = {} }) {
  return (
    <div style={{
      background: "#0a0a0a", border: `1px solid ${color}`, borderRadius: 8,
      padding: 14, boxShadow: `0 0 12px ${color}33`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function PanelTitle({ children }) {
  return (
    <div style={{
      color: "#00f0ff", fontWeight: "bold", fontSize: 12,
      letterSpacing: 2, marginBottom: 8, textTransform: "uppercase",
    }}>{children}</div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid #222", margin: "10px 0" }} />;
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <span style={{ color: "#666", fontSize: 11 }}>{label}:</span>
      <span style={{
        background: "#000", border: "1px solid #333", color: "#ffe600",
        padding: "2px 8px", borderRadius: 3, fontSize: 12, fontFamily: "monospace",
      }}>{value}</span>
    </div>
  );
}

function AlertBox({ color, children }) {
  return (
    <div style={{
      border: `1px solid ${color}`, borderRadius: 4, padding: "6px 8px",
      marginTop: 8, background: "rgba(0,0,0,0.5)", fontSize: 11,
    }}>{children}</div>
  );
}

function TronBtn({ onClick, disabled, color, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 42, height: 42, border: `1px solid ${disabled ? "#333" : color}`,
        background: "transparent", color: disabled ? "#444" : color,
        borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 16, fontFamily: "inherit", transition: "all 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) { e.target.style.background = color; e.target.style.color = "#000"; } }}
      onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = disabled ? "#444" : color; }}
    >
      {children}
    </button>
  );
}

function TronBtnFull({ onClick, active, children, style = {} }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", padding: "6px 8px",
        border: `1px solid ${active ? "#ffe600" : "#00f0ff"}`,
        background: active ? "#ffe600" : "rgba(0,240,255,0.08)",
        color: active ? "#000" : "#00f0ff",
        borderRadius: 4, cursor: "pointer", fontSize: 12,
        fontFamily: "inherit", fontWeight: "bold", letterSpacing: 1,
        marginBottom: 4, transition: "all 0.15s", ...style,
      }}
    >
      {children}
    </button>
  );
}