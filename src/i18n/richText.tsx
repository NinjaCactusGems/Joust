import type { ReactNode } from 'react';
import type { Locale } from './translations';

// The four "How to play" rules carry inline <strong> emphasis, so they live as
// per-locale JSX fragments rather than plain strings in the translation table.
// Order matches the numbered list (and BulletFigure n) in HowToPlay.tsx.
export const howToPlayRules: Record<Locale, (() => ReactNode)[]> = {
  en: [
    () => (
      <>
        Hold your phone out, <strong>away from your body</strong>, and keep it
        steady.
      </>
    ),
    () => (
      <>
        <strong>Dance and weave</strong> around the other players without
        jostling your own phone.
      </>
    ),
    () => (
      <>
        Make rivals move too quickly — a <strong>touch on the arm</strong> is
        fair game. Move your phone too fast and you're out.
      </>
    ),
    () => (
      <>
        Be the <strong>last one standing</strong> to win the joust.
      </>
    ),
  ],
  de: [
    () => (
      <>
        Halte dein Handy nach vorne, <strong>weg von deinem Körper</strong>, und
        halte es ruhig.
      </>
    ),
    () => (
      <>
        <strong>Tanze und weiche aus</strong> rund um die anderen Spieler, ohne
        dein eigenes Handy zu erschüttern.
      </>
    ),
    () => (
      <>
        Bring deine Rivalen dazu, sich zu schnell zu bewegen — eine{' '}
        <strong>Berührung am Arm</strong> ist erlaubt. Bewegst du dein Handy zu
        schnell, bist du raus.
      </>
    ),
    () => (
      <>
        Sei der <strong>Letzte, der übrig bleibt</strong>, um das Turnier zu
        gewinnen.
      </>
    ),
  ],
};
