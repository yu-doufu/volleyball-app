import { isLegacyPlayInput, isPlayInputV3 } from './volleyball-stats.ts';
import { createMigratedDatabase, isSetOperation } from './match-domain.ts';
import type { MatchDatabase, VolleyballMatch, VolleyballSet } from './match-domain.ts';
import {
  parseSession,
  SESSION_STORAGE_KEY,
  SessionStorageError,
} from './session-storage.ts';
import type { KeyValueStorage } from './session-storage.ts';

export const MATCH_DATABASE_KEY = 'volleyball-app.match-database.v4';
export const V3_MATCH_DATABASE_KEY = 'volleyball-app.match-database.v3';
export const LEGACY_MATCH_DATABASE_KEY = 'volleyball-app.match-database.v2';

const isNullableScore = (value: unknown) =>
  value === null || (Number.isInteger(value) && Number(value) >= 0);

function isSet(value: unknown): value is VolleyballSet {
  if (typeof value !== 'object' || value === null) return false;
  const set = value as Partial<VolleyballSet>;
  return (
    typeof set.id === 'string' &&
    Number.isInteger(set.number) &&
    (set.status === 'in-progress' || set.status === 'completed') &&
    Array.isArray(set.operations) &&
    set.operations.every(isSetOperation) &&
    isNullableScore(set.finalHomeScore) &&
    isNullableScore(set.finalAwayScore)
  );
}

function isMatch(value: unknown): value is VolleyballMatch {
  if (typeof value !== 'object' || value === null) return false;
  const match = value as Partial<VolleyballMatch>;
  return (
    typeof match.id === 'string' &&
    (match.date === null || typeof match.date === 'string') &&
    (match.homeTeam === null || typeof match.homeTeam === 'string') &&
    (match.awayTeam === null || typeof match.awayTeam === 'string') &&
    (match.status === 'in-progress' || match.status === 'completed') &&
    typeof match.migratedFromV1 === 'boolean' &&
    typeof match.createdAt === 'string' &&
    (match.completedAt === null || typeof match.completedAt === 'string') &&
    Array.isArray(match.sets) &&
    match.sets.every(isSet)
  );
}

export function parseMatchDatabase(raw: string, expectedVersion: 2 | 3 | 4 = 4): MatchDatabase {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SessionStorageError('invalid-data', '試合保存データを読み取れません。', { cause: error });
  }
  if (typeof value !== 'object' || value === null) {
    throw new SessionStorageError('invalid-data', '試合保存データの形式が不正です。');
  }
  const database = value as Partial<Omit<MatchDatabase, 'version'>> & { version?: unknown };
  if (database.version !== expectedVersion) {
    throw new SessionStorageError('unsupported-version', '未対応の試合保存形式です。');
  }
  if (
    typeof database.defaultHomeTeam !== 'string' ||
    !(database.activeMatchId === null || typeof database.activeMatchId === 'string') ||
    !Array.isArray(database.matches) ||
    !database.matches.every(isMatch) ||
    (database.activeMatchId !== null &&
      !database.matches.some(
        (match) => match.id === database.activeMatchId && match.status === 'in-progress',
      ))
  ) {
    throw new SessionStorageError('invalid-data', '試合保存データの内容が不正です。');
  }
  if (expectedVersion === 2 && !database.matches.every((match) =>
    match.sets.every((set) => set.operations.every((operation) =>
      operation.type !== 'stat' || isLegacyPlayInput(operation.input))))) {
    throw new SessionStorageError('invalid-data', '旧保存形式に新方式のイベントがあります。');
  }
  if (expectedVersion === 3 && !database.matches.every((match) =>
    match.sets.every((set) => set.operations.every((operation) =>
      operation.type !== 'stat' || isPlayInputV3(operation.input))))) {
    throw new SessionStorageError('invalid-data', '旧保存形式に新レセプションのイベントがあります。');
  }
  return { ...value as MatchDatabase, version: 4 };
}

export class MatchRepository {
  private writeTail: Promise<void> = Promise.resolve();
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  async load(): Promise<{ database: MatchDatabase | null; migrated: boolean }> {
    let current: string | null;
    try {
      current = await this.storage.getItem(MATCH_DATABASE_KEY);
    } catch (error) {
      throw new SessionStorageError('read', '試合記録を読み込めませんでした。', { cause: error });
    }
    if (current !== null) return { database: parseMatchDatabase(current), migrated: false };

    for (const [key, version] of [[V3_MATCH_DATABASE_KEY, 3], [LEGACY_MATCH_DATABASE_KEY, 2]] as const) {
      let previous: string | null;
      try {
        previous = await this.storage.getItem(key);
      } catch (error) {
        throw new SessionStorageError('read', '旧試合記録を読み込めませんでした。', { cause: error });
      }
      if (previous !== null) {
        const migrated = parseMatchDatabase(previous, version);
        await this.save(migrated);
        return { database: migrated, migrated: true };
      }
    }

    let legacy: string | null;
    try {
      legacy = await this.storage.getItem(SESSION_STORAGE_KEY);
    } catch (error) {
      throw new SessionStorageError('read', '旧形式の記録を読み込めませんでした。', { cause: error });
    }
    if (legacy === null) return { database: null, migrated: false };

    const parsed = parseSession(legacy);
    const migrated = createMigratedDatabase(
      parsed.activeSession.history,
      parsed.activeSession.updatedAt,
    );
    await this.save(migrated);
    return { database: migrated, migrated: true };
  }

  save(database: MatchDatabase): Promise<void> {
    const snapshot = JSON.stringify(database);
    parseMatchDatabase(snapshot);
    const write = this.writeTail.then(async () => {
      try {
        await this.storage.setItem(MATCH_DATABASE_KEY, snapshot);
      } catch (error) {
        throw new SessionStorageError('write', '試合記録を端末内へ保存できませんでした。', {
          cause: error,
        });
      }
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }
}
