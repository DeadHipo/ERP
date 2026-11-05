import { useState } from 'react';
import { useLabel } from '../../lib/label';
import { useOwnLabels } from '../LabelSwitch';
import { SelectField } from './SelectField';

/** The id of the «any label» option; the field reports it as '' (no label). */
const ANY = '__any__';

/**
 * The own label of a write (D-168, D-169): the state of a dialog's label field, its default the switch of the header.
 * `labelName` is the name of the chosen label ('' when none) for the confirmation lines and the toast.
 */
export function useLabelChoice(): { labelId: string; setLabelId: (id: string) => void; labelName: string } {
  const own = useOwnLabels();
  const { labelId: switchLabel } = useLabel();
  const [labelId, setLabelId] = useState(switchLabel);
  return { labelId, setLabelId, labelName: own.find((l) => l.id === labelId)?.name ?? '' };
}

/**
 * The one select of an own label (`field-<name>`): the options are the own labels of `GET /labels`. With `anyLabel`
 * (its caption) a first option «any» stands for no label and is reported as ''.
 */
export function LabelField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (labelId: string) => void;
  isRequired?: boolean;
  anyLabel?: string;
}) {
  const own = useOwnLabels();
  const options = [
    ...(props.anyLabel !== undefined ? [{ id: ANY, label: props.anyLabel }] : []),
    ...own.map((l) => ({ id: l.id, label: l.name })),
  ];
  const value = props.value !== '' ? props.value : props.anyLabel !== undefined ? ANY : null;
  return (
    <SelectField
      name={props.name}
      label={props.label}
      value={value}
      onChange={(v) => props.onChange(v === ANY ? '' : v)}
      isRequired={props.isRequired}
      options={options}
    />
  );
}
