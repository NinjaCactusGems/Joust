import { Lobby } from './components/Lobby';
import { MusicNotes } from './components/MusicNotes';

export default function App() {
  return (
    <div className="relative min-h-dvh bg-staff text-ink flex flex-col">
      <MusicNotes />

      <main className="relative z-10 flex-1 px-6 pt-12 pb-10 sm:px-8 sm:pt-16 max-w-md mx-auto w-full flex flex-col items-center gap-10">
        <h1 className="font-serif text-5xl sm:text-6xl font-semibold tracking-tight text-center">
          Joust
        </h1>

        <Lobby />
      </main>
    </div>
  );
}
