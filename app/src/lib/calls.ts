import { create } from 'zustand';

/** When each call room's callee last declined, so the caller can see it. */
export const useDeclined = create<Record<string, number>>()(() => ({}));

export function onCallDeclined(roomId: string) {
  useDeclined.setState({ [roomId]: Date.now() });
}
