import type { ReactNode } from 'react';
import { Tabs } from '@heroui/react';
import { useSearchParams } from 'react-router-dom';

export interface CardTab {
  id: string;
  label: string;
  content: ReactNode;
}

/** Tabs synced to `?tab=` (a reload and a shared link reproduce the tab); `data-testid="tab-<id>"`. */
export function CardTabs({ tabs, defaultTab }: { tabs: CardTab[]; defaultTab?: string }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const selected = tabs.some((t) => t.id === requested) ? (requested as string) : (defaultTab ?? tabs[0]?.id ?? '');
  return (
    <Tabs
      selectedKey={selected}
      onSelectionChange={(key) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('tab', String(key));
            return next;
          },
          { replace: true },
        )
      }
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label="tabs">
          {tabs.map((t) => (
            <Tabs.Tab key={t.id} id={t.id} data-testid={`tab-${t.id}`}>
              {t.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {tabs.map((t) => (
        <Tabs.Panel key={t.id} id={t.id} className="pt-4">
          {t.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

/** The card of an entity (track, release, owner, artist, label, document): summary header and tabs. */
export function EntityCard(props: {
  title: ReactNode;
  /** The key (ISRC, UPC, id) and other small facts. */
  subtitle?: ReactNode;
  /** Status chips next to the title. */
  chips?: ReactNode;
  /** The money headline. */
  headline?: ReactNode;
  tabs: CardTab[];
  defaultTab?: string;
}) {
  return (
    <section data-testid="entity-card" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {props.title}
            {props.chips}
          </div>
          {props.subtitle ? <div className="text-sm text-muted">{props.subtitle}</div> : null}
        </div>
        {props.headline ? <div className="text-right">{props.headline}</div> : null}
      </header>
      <CardTabs tabs={props.tabs} defaultTab={props.defaultTab} />
    </section>
  );
}
