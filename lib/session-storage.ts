import { isLegacyPlayInput } from './volleyball-stats.ts';
import type { PlayInput } from './volleyball-stats.ts';

export const SESSION_STORAGE_KEY = 'volleyball-app.active-session.v1';
export const SESSION_FORMAT_VERSION = 1;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type StoredSessionV1 = Readonly<{
  version: 1;
  activeSession: Readonly<{
    history: readonly PlayInput[];
    updatedAt: string;
  }>;
}>;

export class SessionStorageError extends Error {
  readonly kind: 'read' | 'write' | 'invalid-data' | 'unsupported-version';

  constructor(
    kind: 'read' | 'write' | 'invalid-data' | 'unsupported-version',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SessionStorageError';
    this.kind = kind;
  }
}

export function serializeSession(
  history: readonly PlayInput[],
  now: () => Date = () => new Date(),
): string {
  if (!history.every(isLegacyPlayInput)) {
    throw new SessionStorageError('invalid-data', '新方式の記録はversion 1へ保存できません。');
  }
  const data: StoredSessionV1 = {
    version: SESSION_FORMAT_VERSION,
    activeSession: {
      history,
      updatedAt: now().toISOString(),
    },
  };
  return JSON.stringify(data);
}

export function parseSession(raw: string): StoredSessionV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SessionStorageError('invalid-data', '保存データをJSONとして読めません。', {
      cause: error,
    });
  }

  if (typeof value !== 'object' || value === null || !('version' in value)) {
    throw new SessionStorageError('invalid-data', '保存データの形式が不正です。');
  }

  const candidate = value as {
    version?: unknown;
    activeSession?: { history?: unknown; updatedAt?: unknown };
  };
  if (candidate.version !== SESSION_FORMAT_VERSION) {
    throw new SessionStorageError(
      'unsupported-version',
      `未対応の保存形式です（version: ${String(candidate.version)}）。`,
    );
  }

  const session = candidate.activeSession;
  if (
    typeof session !== 'object' ||
    session === null ||
    !Array.isArray(session.history) ||
    !session.history.every(isLegacyPlayInput) ||
    typeof session.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(session.updatedAt))
  ) {
    throw new SessionStorageError('invalid-data', '保存データの内容が不正です。');
  }

  return value as StoredSessionV1;
}

export class SessionRepository {
  private writeTail: Promise<void> = Promise.resolve();
  private readonly storage: KeyValueStorage;
  private readonly now: () => Date;

  constructor(
    storage: KeyValueStorage,
    now: () => Date = () => new Date(),
  ) {
    this.storage = storage;
    this.now = now;
  }

  async load(): Promise<readonly PlayInput[] | null> {
    let raw: string | null;
    try {
      raw = await this.storage.getItem(SESSION_STORAGE_KEY);
    } catch (error) {
      throw new SessionStorageError('read', '端末内の記録を読み込めませんでした。', {
        cause: error,
      });
    }

    if (raw === null) {
      return null;
    }

    return parseSession(raw).activeSession.history;
  }

  save(history: readonly PlayInput[]): Promise<void> {
    const snapshot = history.map((input) => ({ ...input }));
    const write = this.writeTail.then(async () => {
      try {
        await this.storage.setItem(
          SESSION_STORAGE_KEY,
          serializeSession(snapshot, this.now),
        );
      } catch (error) {
        throw new SessionStorageError('write', '端末内へ記録を保存できませんでした。', {
          cause: error,
        });
      }
    });

    // A failed write must not block a later input or an explicit retry.
    this.writeTail = write.catch(() => undefined);
    return write;
  }
}
