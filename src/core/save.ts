import type { Character } from './character';

const SAVE_KEY = 'hns-web:save:v1';
const RECORD_KEY = 'hns-web:record:v1';
const SETTINGS_KEY = 'hns-web:settings:v1';

export interface SaveData {
  version: 1;
  character: Character;
  /** Graine de l'étage courant, pour pouvoir le rejouer à l'identique. */
  floorSeed: number;
  savedAt: number;
}

export interface Records {
  bestFloor: number;
  bestLevel: number;
  totalKills: number;
}

export interface Settings {
  volume: number;
  muted: boolean;
  showDamageNumbers: boolean;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée…) : on ignore */
  }
}

export function loadSave(): SaveData | null {
  const s = read<SaveData>(SAVE_KEY);
  if (!s || s.version !== 1 || !s.character) return null;
  return s;
}

export function writeSave(character: Character, floorSeed: number): void {
  const data: SaveData = { version: 1, character: structuredClone(character), floorSeed, savedAt: Date.now() };
  write(SAVE_KEY, data);
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadRecords(): Records {
  return { bestFloor: 0, bestLevel: 0, totalKills: 0, ...(read<Records>(RECORD_KEY) ?? {}) };
}

export function updateRecords(c: Character, extraKills: number): Records {
  const r = loadRecords();
  r.bestFloor = Math.max(r.bestFloor, c.floor);
  r.bestLevel = Math.max(r.bestLevel, c.level);
  r.totalKills += extraKills;
  write(RECORD_KEY, r);
  return r;
}

export function loadSettings(): Settings {
  return { volume: 0.6, muted: false, showDamageNumbers: true, ...(read<Settings>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}
