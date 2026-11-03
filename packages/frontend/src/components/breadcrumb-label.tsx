import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface BreadcrumbLabelState {
  label: string | undefined;
  setLabel: (label: string | undefined) => void;
}

const BreadcrumbLabelContext = createContext<BreadcrumbLabelState>({ label: undefined, setLabel: () => undefined });

export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbLabelContext value={value}>{children}</BreadcrumbLabelContext>;
}

export function useBreadcrumbEntityLabel(): string | undefined {
  return useContext(BreadcrumbLabelContext).label;
}

/** A detail page calls this with the entity's name; the last breadcrumb shows it instead of the raw key. */
export function useBreadcrumbLabel(label: string | undefined): void {
  const { setLabel } = useContext(BreadcrumbLabelContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(undefined);
  }, [label, setLabel]);
}
