import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { createInitialState, matchReducer } from '@/lib/volleyball-stats';
import type { MatchAction } from '@/lib/volleyball-stats';
import { SessionRepository, SessionStorageError } from '@/lib/session-storage';

type PersistenceStatus =
  | Readonly<{ phase: 'loading' }>
  | Readonly<{ phase: 'saved' }>
  | Readonly<{ phase: 'saving' }>
  | Readonly<{ phase: 'load-error'; message: string }>
  | Readonly<{ phase: 'save-error'; message: string }>;

const repository = new SessionRepository(AsyncStorage);

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof SessionStorageError ? error.message : fallback;

export function usePersistentMatch() {
  const [state, dispatch] = useReducer(matchReducer, undefined, createInitialState);
  const [status, setStatus] = useState<PersistenceStatus>({ phase: 'loading' });
  const hydratedRef = useRef(false);
  const saveRequestRef = useRef(0);

  const load = useCallback(async () => {
    hydratedRef.current = false;
    setStatus({ phase: 'loading' });
    try {
      const history = await repository.load();
      dispatch({ type: 'restore', history: history ?? [] });
      hydratedRef.current = true;
      setStatus({ phase: 'saved' });
    } catch (error) {
      setStatus({
        phase: 'load-error',
        message: errorMessage(error, '端末内の記録を復元できませんでした。'),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!hydratedRef.current) {
      return;
    }

    const requestId = ++saveRequestRef.current;
    setStatus({ phase: 'saving' });
    try {
      await repository.save(state.history);
      if (requestId === saveRequestRef.current) {
        setStatus({ phase: 'saved' });
      }
    } catch (error) {
      if (requestId === saveRequestRef.current) {
        setStatus({
          phase: 'save-error',
          message: errorMessage(error, '端末内への保存に失敗しました。'),
        });
      }
    }
  }, [state.history]);

  useEffect(() => {
    void save();
  }, [save]);

  const apply = useCallback((action: MatchAction) => {
    if (hydratedRef.current) {
      dispatch(action);
    }
  }, []);

  return {
    state,
    status,
    canInput: status.phase !== 'loading' && status.phase !== 'load-error',
    apply,
    retry: status.phase === 'load-error' ? load : save,
  };
}
