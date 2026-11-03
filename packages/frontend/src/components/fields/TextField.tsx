import { FieldError, Input, Label, TextField as HeroTextField } from '@heroui/react';

/** A text input with a label; `data-testid="field-<name>"` sits on the input. `error` is a message mapped from `details.issues`. */
export function TextField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'month' | 'number' | 'search';
  placeholder?: string;
  error?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
}) {
  return (
    <HeroTextField
      name={props.name}
      value={props.value}
      onChange={props.onChange}
      isInvalid={props.error !== undefined}
      isRequired={props.isRequired}
      isDisabled={props.isDisabled}
      type={props.type === 'date' || props.type === 'month' || props.type === 'number' ? undefined : props.type}
      className="w-full"
    >
      <Label>{props.label}</Label>
      <Input
        data-testid={`field-${props.name}`}
        placeholder={props.placeholder}
        {...(props.type === 'date' || props.type === 'month' || props.type === 'number' ? { type: props.type } : {})}
      />
      <FieldError>{props.error}</FieldError>
    </HeroTextField>
  );
}
