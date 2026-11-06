import { useState, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { claudeCodeCommand, claudeDesktopConfig } from '@erp/shared/mcp-connection';
import { PageHeader } from '../../components/PageHeader';
import { ru } from '../../i18n/ru';

const t = ru.claude;

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="mb-2 text-lg font-semibold">{props.title}</h2>
      <div className="flex flex-col gap-2 text-sm">{props.children}</div>
    </section>
  );
}

function List(props: { items: readonly string[] }) {
  return (
    <ul className="list-disc pl-5">
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** A text to copy. The clipboard exists only on https and localhost: elsewhere the text is selected by hand. */
function CodeBlock(props: { id: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => {
    const write = navigator.clipboard?.writeText(props.text) ?? Promise.reject(new Error('no clipboard'));
    write.then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <pre data-testid={props.id} className="w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface-secondary p-3 font-mono text-xs">
        {props.text}
      </pre>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" data-testid={`${props.id}-copy`} onPress={copy}>
          {state === 'copied' ? t.copied : t.copy}
        </Button>
        {state === 'failed' ? <span className="text-xs text-muted">{t.copyFailed}</span> : null}
      </div>
    </div>
  );
}

/** P31: the connection of Claude (D-179). The address is the one the page is open on; the token is never shown here. */
export function ClaudePage() {
  const { origin, protocol, hostname } = window.location;
  const insecure = protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1';
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      {insecure ? (
        <p data-testid="claude-insecure" className="rounded-md border border-warning p-3 text-sm">
          {t.insecure}
        </p>
      ) : null}
      <Section title={t.about.title}>
        <p>{t.about.text}</p>
      </Section>
      <Section title={t.need.title}>
        <List items={t.need.items} />
      </Section>
      <Section title={t.code.title}>
        <p>{t.code.text}</p>
        <CodeBlock id="claude-code-command" text={claudeCodeCommand(origin, t.tokenPlaceholder)} />
        <p>{t.code.check}</p>
        <CodeBlock id="claude-code-check" text="claude mcp list" />
      </Section>
      <Section title={t.desktop.title}>
        <p>{t.desktop.text}</p>
        <List items={[t.desktop.mac, t.desktop.windows]} />
        <CodeBlock id="claude-desktop-config" text={claudeDesktopConfig(origin, t.tokenPlaceholder)} />
      </Section>
      <Section title={t.try.title}>
        <List items={t.try.items} />
      </Section>
      <Section title={t.mind.title}>
        <List items={t.mind.items} />
      </Section>
    </div>
  );
}
