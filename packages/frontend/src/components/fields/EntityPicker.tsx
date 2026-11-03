import { useEffect, useState } from 'react';
import { ComboBox, Input, Label, ListBox } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { ApiError } from '../../api/client';
import type { searchResponseSchema } from '../../api/search-schema';
import { searchQueries } from '../../api/queries/search';
import { ownerQueries } from '../../api/queries/owners';
import { artistQueries } from '../../api/queries/artists';
import { documentQueries } from '../../api/queries/documents';
import { labelQueries } from '../../api/queries/labels';
import { trackQueries } from '../../api/queries/tracks';
import { ru } from '../../i18n/ru';

export type PickerKind = 'owners' | 'artists' | 'tracks' | 'documents' | 'labels';

/** One match of a picker: the key, the text, and for documents / labels / owners their kind and status. */
export type PickerItem = { id: string; label: string; kind?: string; status?: string };

/** Never more than this many matches are shown for a typed query (SS7): the list is searched, not browsed. */
export const PICKER_LIMIT = 10;
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/**
 * A typed search restricted to one kind. It asks `GET /search`; while that endpoint does not exist (404 until step
 * 3.3b) it searches the reference list of the kind (`GET /owners`, `/artists`, `/documents`, `/labels`, `/tracks`)
 * by the typed text instead. Either way at most `PICKER_LIMIT` matches are shown.
 */
export function EntityPicker(props: {
  name: string;
  label: string;
  kind: PickerKind;
  /** The key of the chosen entity (owner id, artist id, ISRC, document id, label id) or null. */
  value: string | null;
  onChange: (key: string | null, label: string) => void;
  /** Keeps only some matches (e.g. approved documents of a kind). */
  accept?: (item: PickerItem) => boolean;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = debounced.length >= MIN_CHARS;
  const result = useQuery({ ...searchQueries.query(debounced, [props.kind]), enabled });
  const fallback = result.error instanceof ApiError && result.error.status === 404;
  const list = useFallbackList(props.kind, enabled && fallback);
  const all = fallback ? filterByText(list, debounced) : pickItems(props.kind, result.data);
  const items = enabled ? all.filter((i) => props.accept?.(i) ?? true).slice(0, PICKER_LIMIT) : [];

  return (
    <ComboBox
      name={props.name}
      className="w-full"
      allowsEmptyCollection
      items={items}
      inputValue={text}
      onInputChange={setText}
      selectedKey={props.value}
      onSelectionChange={(key) => {
        if (key === null) return props.onChange(null, '');
        const item = items.find((i) => i.id === String(key));
        props.onChange(String(key), item?.label ?? '');
      }}
      menuTrigger="input"
    >
      <Label>{props.label}</Label>
      <ComboBox.InputGroup>
        <Input data-testid={`field-${props.name}`} placeholder={ru.search.pickerPlaceholder} />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox
          data-testid={`picker-list-${props.name}`}
          renderEmptyState={() => (
            <div className="p-3 text-sm text-muted">{enabled ? ru.search.pickerEmpty : ru.search.hint}</div>
          )}
        >
          {items.map((i) => (
            <ListBox.Item key={i.id} id={i.id} textValue={i.label}>
              {i.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}

/** The reference list of a kind, loaded only while `GET /search` is missing. */
function useFallbackList(kind: PickerKind, enabled: boolean): PickerItem[] {
  const owners = useQuery({ ...ownerQueries.list(), enabled: enabled && kind === 'owners' });
  const artists = useQuery({ ...artistQueries.list(), enabled: enabled && kind === 'artists' });
  const documents = useQuery({ ...documentQueries.list(), enabled: enabled && kind === 'documents' });
  const labels = useQuery({ ...labelQueries.list(), enabled: enabled && kind === 'labels' });
  const tracks = useQuery({ ...trackQueries.list(), enabled: enabled && kind === 'tracks' });
  switch (kind) {
    case 'owners':
      return (owners.data ?? []).map((o) => ({ id: o.id, label: o.name, kind: o.kind, status: o.status }));
    case 'artists':
      return (artists.data ?? []).map((a) => ({ id: a.id, label: a.pseudonym, status: a.status }));
    case 'documents':
      return (documents.data ?? []).map((d) => ({ id: d.id, label: d.title, kind: d.kind, status: d.status }));
    case 'labels':
      return (labels.data ?? []).map((l) => ({ id: l.id, label: l.name, kind: l.kind }));
    case 'tracks':
      return (tracks.data ?? []).flatMap((t) => (t.isrc ? [{ id: t.isrc, label: `${t.isrc} · ${t.title}` }] : []));
  }
}

function filterByText(items: PickerItem[], text: string): PickerItem[] {
  const needle = text.toLocaleLowerCase('ru');
  return items.filter((i) => i.label.toLocaleLowerCase('ru').includes(needle));
}

function pickItems(kind: PickerKind, data: z.output<typeof searchResponseSchema> | undefined): PickerItem[] {
  if (!data) return [];
  switch (kind) {
    case 'owners':
      return data.owners.map((o) => ({ id: o.id, label: o.name, status: o.status }));
    case 'artists':
      return data.artists.map((a) => ({ id: a.id, label: a.pseudonym }));
    case 'tracks':
      return data.tracks.flatMap((t) => (t.isrc ? [{ id: t.isrc, label: `${t.isrc} · ${t.title}` }] : []));
    case 'documents':
      return data.documents.map((d) => ({ id: d.id, label: d.title, kind: d.kind, status: d.status }));
    case 'labels':
      return data.labels.map((l) => ({ id: l.id, label: l.name, kind: l.kind }));
  }
}
