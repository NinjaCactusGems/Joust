import { Lobby } from './components/Lobby';
import { HowToPlay } from './components/HowToPlay';
import { MusicNotes } from './components/MusicNotes';
import { LanguageSwitcher } from './components/LanguageSwitcher';

export default function App() {
  return (
    <div className="relative min-h-dvh bg-staff text-ink flex flex-col">
      <MusicNotes />

      <main className="relative z-10 flex-1 px-6 pt-12 pb-10 sm:px-8 sm:pt-16 max-w-md mx-auto w-full flex flex-col items-center gap-8">
        <div className="relative w-full">
          <div className="absolute right-0 top-0">
            <LanguageSwitcher />
          </div>
          <h1 className="font-serif text-5xl sm:text-6xl font-semibold tracking-tight text-center">
            Joust
          </h1>
        </div>

        <HowToPlay />
        <Lobby />
      </main>
    </div>
  );
}
