import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useBreadcrumbLabel } from '../components/breadcrumb-label';
import { ru } from '../i18n/ru';

/** A route whose page is built in a later step: its title and the sentence "Страница в разработке (шаг 3.x)". */
export function PlaceholderPage(props: { title: string; step: string }) {
  const params = useParams();
  const key = params.isrc ?? params.upc ?? params.id ?? params.reason ?? params.name;
  // A detail page sets the entity label of the last breadcrumb like this; here the key stands in for it.
  useBreadcrumbLabel(key);
  return (
    <div data-testid="placeholder-page">
      <PageHeader title={props.title} />
      {key ? (
        <p className="mb-2 text-sm text-muted">
          Ключ: <span data-testid="placeholder-key">{key}</span>
        </p>
      ) : null}
      <p data-testid="placeholder-text">{ru.shell.pageInProgress(props.step)}</p>
    </div>
  );
}
