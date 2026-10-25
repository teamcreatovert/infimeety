import type { Transition } from 'motion/react';

/** Shared spring presets so everything moves with the same physics. */
export const spring: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 };
export const softSpring: Transition = { type: 'spring', stiffness: 300, damping: 32, mass: 1 };
export const snappy: Transition = { type: 'spring', stiffness: 700, damping: 42 };
export const bouncy: Transition = { type: 'spring', stiffness: 600, damping: 22 };

export const popIn = {
  initial: { opacity: 0, scale: 0.96, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 2, transition: { duration: 0.12 } },
  transition: spring,
};

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18 },
};
