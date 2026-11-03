import { Chip } from '@heroui/react';

/** A yes/no fact as a chip (has a split, has participations): `data-testid="chip-<name>-<yes|no>"`. */
export function FlagChip(props: { name: string; value: boolean; yes: string; no: string; warnOnNo?: boolean }) {
  return (
    <Chip
      data-testid={`chip-${props.name}-${props.value ? 'yes' : 'no'}`}
      size="sm"
      variant="soft"
      color={props.value ? 'success' : props.warnOnNo ? 'warning' : 'default'}
    >
      {props.value ? props.yes : props.no}
    </Chip>
  );
}
