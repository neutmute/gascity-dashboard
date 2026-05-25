import { useEffect, useState } from 'react';
import type { TranscriptResult, TranscriptTurn } from 'gas-city-dashboard-shared';
import { api } from '../api/client';

interface SessionStreamState {
  result: TranscriptResult | null;
  loading: boolean;
  error: string | null;
}

export function useSessionStream(
  sessionId: string | null,
  stream: boolean,
): SessionStreamState {
  const [state, setState] = useState<SessionStreamState>({
    result: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ result: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let source: EventSource | null = null;
    setState({ result: null, loading: true, error: null });

    api.peekSession(sessionId).then(
      (result) => {
        if (cancelled) return;
        setState({ result, loading: false, error: null });
        if (stream && typeof EventSource !== 'undefined') {
          source = new EventSource(api.sessionStreamUrl(sessionId), {
            withCredentials: true,
          });
          const onTurn = (event: MessageEvent<string>) => {
            const turn = parseStreamTurn(event.data);
            if (!turn) return;
            setState((current) => {
              const base = current.result ?? result;
              return {
                result: {
                  ...base,
                  turns: [...base.turns, turn],
                  total_chars: base.total_chars + turn.text.length,
                  captured_at: new Date().toISOString(),
                },
                loading: false,
                error: null,
              };
            });
          };
          source.onmessage = onTurn;
          source.addEventListener('turn', onTurn);
          source.onerror = () => {
            source?.close();
          };
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            result: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load session.',
          });
        }
      },
    );

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [sessionId, stream]);

  return state;
}

function parseStreamTurn(data: string): TranscriptTurn | null {
  try {
    const parsed = JSON.parse(data) as Partial<TranscriptTurn>;
    if (typeof parsed.text !== 'string') return null;
    return {
      role: typeof parsed.role === 'string' ? parsed.role : 'assistant',
      text: parsed.text,
    };
  } catch {
    return { role: 'assistant', text: data };
  }
}
