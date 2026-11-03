import { TextField } from './TextField';

/**
 * A date as `YYYY-MM-DD` (or `YYYY-MM` with `month`). HeroUI's DatePicker works on @internationalized/date objects;
 * the API wants plain strings, so a native date input in the HeroUI field styles is the simpler fit.
 */
export function DateField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  month?: boolean;
  error?: string;
  isRequired?: boolean;
}) {
  return <TextField {...props} type={props.month ? 'month' : 'date'} />;
}
