/**
 * Subtitle files for the watch party, turned into WebVTT (the only format a <video> renders).
 * SRT and VTT convert directly; ASS/SSA keep their text and timing (styling is dropped).
 */

const stripBom = (s: string) => s.replace(/^﻿/, '');

function fromSrt(text: string) {
  const body = stripBom(text)
    .replace(/\r\n?/g, '\n')
    // 00:01:02,345 → 00:01:02.345
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

/** "0:01:02.34" (ASS centiseconds) → "00:01:02.340" */
function assTime(t: string) {
  const m = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(t.trim());
  if (!m) return null;
  const ms = m[4].padEnd(3, '0');
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${ms}`;
}

function fromAss(text: string) {
  const lines = stripBom(text).replace(/\r\n?/g, '\n').split('\n');
  let format: string[] = [];
  const cues: string[] = [];
  let section = '';
  for (const line of lines) {
    const head = /^\[(.+)\]$/.exec(line.trim());
    if (head) {
      section = head[1].toLowerCase();
      continue;
    }
    if (section !== 'events') continue;
    if (line.startsWith('Format:')) {
      format = line
        .slice(7)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!line.startsWith('Dialogue:')) continue;
    const fields = line.slice(9).split(',');
    const at = (name: string) => format.indexOf(name);
    const textIndex = at('text');
    if (textIndex < 0) continue;
    const start = assTime(fields[at('start')] ?? '');
    const end = assTime(fields[at('end')] ?? '');
    if (!start || !end) continue;
    const words = fields
      .slice(textIndex)
      .join(',')
      .replace(/\{[^}]*\}/g, '') // {\i1} styling
      .replace(/\\N/gi, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (words) cues.push(`${start} --> ${end}\n${words}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** WebVTT text for a subtitle file, by its name and contents. */
export function toVtt(name: string, text: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'vtt' || /^﻿?WEBVTT/.test(text)) return stripBom(text);
  if (ext === 'ass' || ext === 'ssa' || /^\[Script Info\]/m.test(text)) return fromAss(text);
  return fromSrt(text);
}

export const isSubtitle = (name: string) => /\.(srt|vtt|ass|ssa)$/i.test(name);
