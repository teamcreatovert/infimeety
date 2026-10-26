/**
 * Which local file stands in for a shared one: a watch party's movie copied from the host, or
 * picked from this computer by someone who already had it. Remembered across restarts.
 */

const KEY = 'infimeety.partyCopies';

export function savedCopies(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function rememberCopy(fileId: string, localId: string) {
  const all = { ...savedCopies(), [fileId]: localId };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

export const localCopyOf = (fileId: string): string | undefined => savedCopies()[fileId];
