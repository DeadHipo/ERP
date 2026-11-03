import { Link, useLocation } from 'react-router-dom';
import { crumbsFor } from '../nav';
import { ru } from '../i18n/ru';
import { useBreadcrumbEntityLabel } from './breadcrumb-label';

export function Breadcrumbs() {
  const { pathname, search } = useLocation();
  const entityLabel = useBreadcrumbEntityLabel();
  const crumbs = crumbsFor(pathname, search);
  return (
    <nav aria-label={ru.nav.breadcrumbs} data-testid="breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const text = c.entity && entityLabel ? entityLabel : c.label;
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 ? <span aria-hidden>/</span> : null}
              {c.to && !last ? (
                <Link to={c.to} className="hover:underline">
                  {text}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-foreground' : undefined} aria-current={last ? 'page' : undefined}>
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
