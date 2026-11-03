import { Button } from '@heroui/react';
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useTheme } from '../lib/theme';
import { ru } from '../i18n/ru';

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  const label = dark ? ru.shell.theme.toLight : ru.shell.theme.toDark;
  return (
    <Button isIconOnly variant="ghost" size="sm" aria-label={label} data-testid="theme-toggle" onPress={toggle}>
      {dark ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
    </Button>
  );
}
