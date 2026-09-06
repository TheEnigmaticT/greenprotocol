import { createHash } from 'node:crypto';

export interface Source {
  readonly id: string;
  readonly encoding: 'UTF-8';
  readonly bytes: readonly number[];
  readonly text: string;
}
export interface Anchor {
  readonly sourceId: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly preimageHash: string;
}
export interface NormalizedSource {
  readonly sourceId: string;
  readonly id: string;
  readonly text: string;
  readonly bytes: readonly number[];
  /** Byte boundary maps. A collapsed CR/LF interior has no exact inverse. */
  readonly rawToNormalized: readonly (number | null)[];
  readonly normalizedToRaw: readonly number[];
}

export function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
function decode(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Invalid UTF-8 encoding'); }
}
export function createSource(input: Uint8Array | string): Source {
  const bytes = Buffer.from(input);
  const text = decode(bytes);
  // Buffer replaces lone UTF-16 surrogates: never accept that silent change.
  if (typeof input === 'string' && input !== text) throw new Error('Invalid UTF-8: unpaired surrogate');
  return Object.freeze({ id: sha256(bytes), encoding: 'UTF-8', bytes: Object.freeze([...bytes]), text });
}
export function assertSource(source: Source): void {
  if (source.encoding !== 'UTF-8' || !source.bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Invalid source bytes');
  const bytes = Buffer.from(source.bytes);
  if (sha256(bytes) !== source.id || decode(bytes) !== source.text) throw new Error('Source preimage mismatch');
}
function boundary(source: Source, offset: number): boolean {
  return offset === source.bytes.length || (source.bytes[offset] & 0xc0) !== 0x80;
}
export function anchor(source: Source, start: number, end: number): Anchor {
  assertSource(source);
  return anchorValidated(source, start, end);
}
/** Private: callers must validate the source before entering a bulk loop. */
function anchorValidated(source: Source, start: number, end: number): Anchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.bytes.length || !boundary(source, start) || !boundary(source, end)) throw new Error('Invalid UTF-8 byte anchor');
  const bytes = Buffer.from(source.bytes.slice(start, end));
  return Object.freeze({ sourceId: source.id, start, end, quote: decode(bytes), preimageHash: sha256(bytes) });
}
export function verifyAnchor(source: Source, candidate: Anchor): boolean {
  try {
    const actual = anchor(source, candidate.start, candidate.end);
    return actual.sourceId === candidate.sourceId && actual.quote === candidate.quote && actual.preimageHash === candidate.preimageHash;
  } catch { return false; }
}
export function normalizeCRLF(source: Source): NormalizedSource {
  assertSource(source);
  const bytes: number[] = [];
  const rawToNormalized: (number | null)[] = [0];
  const normalizedToRaw = [0];
  let raw = 0;
  while (raw < source.bytes.length) {
    if (source.bytes[raw] === 13 && source.bytes[raw + 1] === 10) {
      bytes.push(10);
      rawToNormalized[++raw] = null;
      raw++;
    } else { bytes.push(source.bytes[raw++]); }
    rawToNormalized[raw] = bytes.length;
    normalizedToRaw.push(raw);
  }
  return Object.freeze({ sourceId: source.id, id: sha256(Buffer.from(bytes)), text: decode(Buffer.from(bytes)), bytes: Object.freeze(bytes), rawToNormalized: Object.freeze(rawToNormalized), normalizedToRaw: Object.freeze(normalizedToRaw) });
}
export function restoreCRLF(source: Source, normalized: NormalizedSource): readonly number[] {
  const actual = normalizeCRLF(source);
  if (normalized.sourceId !== source.id || normalized.id !== actual.id || normalized.text !== actual.text || JSON.stringify(normalized.bytes) !== JSON.stringify(actual.bytes) || JSON.stringify(normalized.rawToNormalized) !== JSON.stringify(actual.rawToNormalized) || JSON.stringify(normalized.normalizedToRaw) !== JSON.stringify(actual.normalizedToRaw)) throw new Error('Normalized source preimage mismatch');
  return Object.freeze([...source.bytes]);
}
function bounds(input: Source, maxBytes: number): Source {
  // Copy before validation; bulk builders never retain caller-owned bytes.
  const source = Object.freeze({ id: input.id, encoding: input.encoding, text: input.text, bytes: Object.freeze([...input.bytes]) });
  assertSource(source);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be a positive integer');
  for (const character of source.text) if (Buffer.byteLength(character) > maxBytes) throw new Error('UTF-8 code point exceeds byte bound');
  return source;
}
function windowEnd(source: Source, start: number, maxBytes: number): number {
  let end = Math.min(start + maxBytes, source.bytes.length);
  while (!boundary(source, end)) end--;
  return end;
}
export function partitionSource(source: Source, maxBytes: number): readonly Anchor[] {
  source = bounds(source, maxBytes);
  const ledger: Anchor[] = [];
  let start = 0;
  while (start < source.bytes.length) {
    const end = windowEnd(source, start, maxBytes);
    ledger.push(anchorValidated(source, start, end));
    start = end;
  }
  return Object.freeze(ledger);
}
export function sourceWindows(source: Source, maxBytes: number, overlapBytes: number): readonly Anchor[] {
  source = bounds(source, maxBytes);
  if (!Number.isInteger(overlapBytes) || overlapBytes < 0 || overlapBytes >= maxBytes) throw new Error('Invalid overlap');
  const windows: Anchor[] = [];
  let start = 0;
  while (start < source.bytes.length) {
    const end = windowEnd(source, start, maxBytes);
    windows.push(anchorValidated(source, start, end));
    if (end === source.bytes.length) break;
    if (!overlapBytes) { start = end; continue; }
    let next = Math.max(start + 1, end - overlapBytes);
    while (next < end && !boundary(source, next)) next++;
    // Some byte budgets cannot overlap a whole UTF-8 code point while progressing.
    if (next === end) throw new Error('UTF-8 overlap cannot progress within bounds');
    start = next;
  }
  return Object.freeze(windows);
}
