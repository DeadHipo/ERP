import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ru } from '../i18n/ru';

export function NotFoundPage() {
  return (
    <div data-testid="not-found">
      <PageHeader title={ru.common.notFound} />
      <Link to="/" className="text-accent hover:underline">
        {ru.common.backHome}
      </Link>
    </div>
  );
}
