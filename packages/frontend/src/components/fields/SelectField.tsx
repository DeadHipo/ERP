import { Label, ListBox, Select } from '@heroui/react';

/** A select over a short fixed list. More than 50 options is a design error: use EntityPicker (typed search). */
export const MAX_SELECT_OPTIONS = 50;

export function SelectField(props: {
  name: string;
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  options: readonly { id: string; label: string }[];
  placeholder?: string;
  isRequired?: boolean;
}) {
  if (props.options.length > MAX_SELECT_OPTIONS)
    throw new Error(`SelectField "${props.name}": ${props.options.length} options; use EntityPicker`);
  return (
    <Select
      name={props.name}
      className="w-full"
      placeholder={props.placeholder}
      isRequired={props.isRequired}
      selectedKey={props.value}
      onSelectionChange={(key) => {
        if (key !== null) props.onChange(String(key));
      }}
    >
      <Label>{props.label}</Label>
      <Select.Trigger data-testid={`field-${props.name}`}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {props.options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
