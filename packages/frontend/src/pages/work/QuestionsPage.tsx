import { Link } from 'react-router-dom';
import { OPEN_QUESTIONS } from '@erp/shared/open-questions';
import { PageHeader } from '../../components/PageHeader';
import { ru } from '../../i18n/ru';

const t = ru.questions;

/** P3: the open items of 15 §3 with their decision ids and the place that holds their money (a static list). */
export function QuestionsPage() {
  return (
    <div data-testid="questions-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-default/50 text-left text-xs text-muted">
            <tr>
              {[t.cols.id, t.cols.title, t.cols.decisions, t.cols.place, t.cols.note, t.cols.link].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OPEN_QUESTIONS.map((q) => (
              <tr key={q.id} data-testid={`question-${q.id}`} className="border-t border-border align-top">
                <td className="px-3 py-2 whitespace-nowrap">{q.id}</td>
                <td className="px-3 py-2 font-medium">{q.title}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {q.decisionIds.map((d) => (
                      <span key={d} data-testid={`decision-${d}`} className="rounded-full bg-warning/15 px-2 text-xs text-warning">
                        ⚠ {d}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2">{t.place[q.place]}</td>
                <td className="px-3 py-2 text-muted">{q.note}</td>
                <td className="px-3 py-2">
                  <Link to={q.link} className="text-accent hover:underline" data-testid="question-link">
                    {t.open}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
