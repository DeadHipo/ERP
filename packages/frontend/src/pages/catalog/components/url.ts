import { useSearchParams } from 'react-router-dom';

/** One query-string parameter as state: an empty value removes it; the history entry is replaced. */
export function useUrlParam(name: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? '';
  const set = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(name, v);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  return [value, set];
}
