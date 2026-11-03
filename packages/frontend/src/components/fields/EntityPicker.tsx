import { useEffect, useState } from 'react';
import { ComboBox, Input, Label, ListBox } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import type { SearchResult } from '@erp/shared/api-responses';
import { searchQueries } from '../../api/queries/search';
import { ru } from '../../i18n/ru';

export type PickerKind = 'owners' | 'artists' | 'tracks' | 'documents' | 'labels';

/** One match of a picker: the key, the text, and for documents / labels / owners their kind and status. */
export type PickerItem = { id: string; label: string; kind?: string; status?: string };

/** Never more than this many matches are shown for a typed query (SS7): the list is searched, not browsed. */
export const PICKER_LIMIT = 10;
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/** A typed search restricted to one kind (`GET /search?kinds=`); at most `PICKER_LIMIT` matches are shown. */
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
  const all = pickItems(props.kind, result.data);
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

function pickItems(kind: PickerKind, data: SearchResult | undefined): PickerItem[] {
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
