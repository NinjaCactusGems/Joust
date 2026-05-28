import { Lobby } from './components/Lobby';
import { ShakeCard } from './components/ShakeCard';

export default function App() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">
      <header className="px-6 pt-6 sm:px-8 sm:pt-8">
        <a href="/" className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-950 font-bold text-lg shadow-sm"
          >
            J
          </span>
          <span className="font-semibold tracking-tight text-lg">Joust</span>
        </a>
      </header>

      <main className="flex-1 px-6 py-10 sm:px-8 max-w-md mx-auto w-full flex flex-col items-center gap-8">
        <div className="text-6xl sm:text-7xl" aria-hidden="true">
          :)
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-center">
          Joust
        </h1>

        <ShakeCard />
        <Lobby />
      </main>

      <footer className="px-6 py-6 text-center text-xs text-slate-500 border-t border-slate-900">
        In development.
      </footer>
    </div>
  );
}
