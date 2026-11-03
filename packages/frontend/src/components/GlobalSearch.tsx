import { useEffect, useMemo, useState } from 'react';
import { Modal, SearchField, Button } from '@heroui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { SearchResult } from '@erp/shared/api-responses';
import { searchQueries } from '../api/queries/search';
import { entityPath } from './EntityLink';
import { HiddenRacDialogAnchor } from './HiddenRacDialogAnchor';
import { ru } from '../i18n/ru';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

type Hit = { kind: keyof typeof ru.search.kinds; key: string; label: string; to: string };

/** The result groups of `GET /search` (17 N10) as one flat, ordered list of links. */
function toHits(data: SearchResult): Hit[] {
  return [
    ...data.owners.map((o): Hit => ({ kind: 'owners', key: o.id, label: o.name, to: entityPath('owner', o.id) })),
    ...data.artists.map((a): Hit => ({ kind: 'artists', key: a.id, label: a.pseudonym, to: entityPath('artist', a.id) })),
    ...data.tracks.flatMap((t): Hit[] =>
      t.isrc
        ? [{ kind: 'tracks', key: t.isrc, label: `${t.isrc} · ${t.title}`, to: entityPath('isrc', t.isrc) }]
        : t.upc
          ? [{ kind: 'tracks', key: t.upc, label: `${t.upc} · ${t.title}`, to: entityPath('upc', t.upc) }]
          : [],
    ),
    ...data.documents.map((d): Hit => ({ kind: 'documents', key: d.id, label: d.title, to: entityPath('document', d.id) })),
    ...data.labels.map((l): Hit => ({ kind: 'labels', key: l.id, label: l.name, to: entityPath('label', l.id) })),
  ];
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = open && debounced.length >= MIN_CHARS;
  const query = useQuery({ ...searchQueries.query(debounced), enabled });
  const hits = useMemo(() => (query.data ? toHits(query.data) : []), [query.data]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setText('');
    void navigate(hit.to);
  };

  const groups = (Object.keys(ru.search.kinds) as (keyof typeof ru.search.kinds)[]).map((kind) => ({
    kind,
    hits: hits.filter((h) => h.kind === kind),
  }));

  return (
    <>
      <Button variant="secondary" size="sm" data-testid="global-search" onPress={() => setOpen(true)}>
        <MagnifyingGlassIcon className="size-4" />
        {ru.shell.searchButton}
        <kbd className="ml-1 rounded bg-default px-1 text-xs text-muted">{ru.shell.searchShortcut}</kbd>
      </Button>
      <Modal isOpen={open} onOpenChange={setOpen}>
        <HiddenRacDialogAnchor />
        <Modal.Backdrop>
          <Modal.Container placement="top">
            <Modal.Dialog data-testid="global-search-dialog" aria-label={ru.search.title} className="max-w-xl">
              <Modal.Body>
                <div
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActive((i) => (i + 1 < hits.length ? i + 1 : i));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActive((i) => (i > 0 ? i - 1 : 0));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      go(hits[active] ?? hits[0]);
                    }
                  }}
                >
                  <SearchField
                    autoFocus
                    aria-label={ru.search.title}
                    value={text}
                    onChange={(v) => {
                      setText(v);
                      setActive(0);
                    }}
                    fullWidth
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input data-testid="global-search-input" placeholder={ru.search.placeholder} />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                </div>
                <div className="mt-3 max-h-96 overflow-y-auto text-sm" data-testid="global-search-results">
                  {debounced.length < MIN_CHARS ? (
                    <p className="text-muted">{ru.search.hint}</p>
                  ) : query.isPending ? null : query.isError ? (
                    <p className="text-danger">
                      {query.error instanceof ApiError ? `${query.error.code}: ${query.error.message}` : query.error.message}
                    </p>
                  ) : hits.length === 0 ? (
                    <p className="text-muted">{ru.search.empty}</p>
                  ) : (
                    groups
                      .filter((g) => g.hits.length > 0)
                      .map((g) => (
                        <div key={g.kind} data-testid={`search-group-${g.kind}`} className="mb-2">
                          <div className="px-2 pb-1 text-xs font-medium uppercase text-muted">{ru.search.kinds[g.kind]}</div>
                          <ul>
                            {g.hits.map((h) => (
                              <li key={`${h.kind}:${h.key}`}>
                                <button
                                  type="button"
                                  onClick={() => go(h)}
                                  className={`w-full rounded-md px-2 py-1.5 text-left hover:bg-default ${
                                    hits[active] === h ? 'bg-default' : ''
                                  }`}
                                >
                                  {h.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
