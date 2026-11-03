import { Pressable } from 'react-aria-components';

/**
 * A controlled HeroUI Modal / AlertDialog has no trigger, but React Aria's DialogTrigger expects a focusable
 * Pressable child and warns otherwise. This disabled, invisible anchor satisfies it (idea from the zero-erp app).
 */
export function HiddenRacDialogAnchor() {
  return (
    <Pressable isDisabled>
      <div role="button" tabIndex={-1} className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden" />
    </Pressable>
  );
}
