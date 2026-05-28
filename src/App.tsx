import { useEffect, useState } from 'react';
import { useShakeDetector } from './hooks/useShakeDetector';

const DISPLAY_MAX = 40;
const FLASH_MS = 250;

export default function App() {
  const {
    start,
    started,
    permissionState,
    magnitude,
    threshold,
    setThreshold,
    shakeCount,
    lastShakeAt,
  } = useShakeDetector(15);

  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (lastShakeAt === null) return;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [lastShakeAt]);

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-6 py-12 gap-6">
      <div className="text-6xl sm:text-7xl" aria-hidden="true">:)</div>
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-center">
        Joust
      </h1>

      {!started ? (
        <IdleView start={start} permissionState={permissionState} />
      ) : (
        <RunningView
          magnitude={magnitude}
          threshold={threshold}
          setThreshold={setThreshold}
          shakeCount={shakeCount}
          flashing={flashing}
        />
      )}
    </main>
  );
}

function IdleView({
  start,
  permissionState,
}: {
  start: () => Promise<void>;
  permissionState: 'idle' | 'granted' | 'denied' | 'unavailable';
}) {
  const blocked = permissionState === 'denied' || permissionState === 'unavailable';
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm">
      <button
        type="button"
        onClick={start}
        disabled={blocked}
        className="w-full rounded-full bg-indigo-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-indigo-500/30 active:scale-95 transition disabled:bg-slate-700 disabled:shadow-none"
      >
        Start
      </button>
      <p className="text-sm text-slate-400 text-center">
        Tap to enable motion sensing.
      </p>
      {blocked && (
        <p className="text-sm text-rose-400 text-center">
          Motion sensors aren&apos;t available or were denied. Open
          joust.ninja-cactus.com on a phone.
        </p>
      )}
    </div>
  );
}

function RunningView({
  magnitude,
  threshold,
  setThreshold,
  shakeCount,
  flashing,
}: {
  magnitude: number;
  threshold: number;
  setThreshold: (v: number) => void;
  shakeCount: number;
  flashing: boolean;
}) {
  const fillPct = Math.min(100, (magnitude / DISPLAY_MAX) * 100);
  const tickPct = Math.min(100, (threshold / DISPLAY_MAX) * 100);

  return (
    <div className="flex flex-col items-stretch gap-5 w-full max-w-sm">
      <label className="flex flex-col gap-2">
        <span className="flex justify-between text-sm text-slate-400">
          <span>Threshold</span>
          <span className="font-mono text-slate-200">
            {threshold.toFixed(1)} m/s²
          </span>
        </span>
        <input
          type="range"
          min={5}
          max={DISPLAY_MAX}
          step={0.5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm text-slate-400">
          <span>Acceleration</span>
          <span className="font-mono text-slate-200">
            {magnitude.toFixed(1)} m/s²
          </span>
        </div>
        <div
          className={`relative h-4 w-full rounded-full overflow-hidden transition-colors duration-150 ${
            flashing ? 'bg-rose-500/40' : 'bg-slate-800'
          }`}
        >
          <div
            className="h-full bg-indigo-500 transition-[width] duration-75 ease-linear"
            style={{ width: `${fillPct}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-rose-300/80"
            style={{ left: `${tickPct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="text-sm text-slate-400 text-center">
        Shakes: <span className="font-mono text-slate-200">{shakeCount}</span>
      </div>
    </div>
  );
}
