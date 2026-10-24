import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button, Card, EmptyState, Notice, StatusLabel } from '../components/ui';
import { CURRENT_MODULE, findNavItem } from '../config/navigation';

export interface ModulePlaceholderPageProps {
  /** Route path from NAV_ITEMS, for example "/agents". */
  path: string;
}

/**
 * Navigable placeholder for a feature delivered in a later module. It shows the planned
 * scope from the development plan and never displays balances, transactions or statuses.
 */
export function ModulePlaceholderPage({ path }: ModulePlaceholderPageProps) {
  const item = findNavItem(path);

  if (!item) {
    return (
      <Notice tone="error" title="Unknown page">
        No navigation entry exists for {path}.
      </Notice>
    );
  }

  return (
    <>
      <PageHeader
        title={item.label}
        description={item.summary}
        actions={<StatusLabel tone="dashed">Planned: Module {item.module}</StatusLabel>}
      />

      <Notice title={`Placeholder page (built through Module ${CURRENT_MODULE})`}>
        This feature is delivered in Module {item.module}: {item.moduleTitle}. Nothing on this page
        is real data, and no blockchain functionality is active.
      </Notice>

      {item.metrics ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Metrics">
          {item.metrics.map((metric) => (
            <li key={metric.label}>
              <Card className="h-full">
                <p className="text-sm text-gray-600">{metric.label}</p>
                <p className="mt-1 text-xl font-semibold text-black">Unavailable</p>
                <p className="mt-2 text-xs text-gray-600">{metric.reason}</p>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Planned scope" description="From the 12-module development plan.">
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal">
            {item.scope.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </Card>

        <EmptyState
          title="No data to show"
          description="Verified data appears here once the underlying feature exists. Nothing is simulated in this module."
          action={
            <Button disabledReason={`Available after Module ${item.module} is delivered.`}>
              Open feature
            </Button>
          }
        />
      </div>

      <p className="mt-6 text-sm">
        <Link to="/design-system" className="underline">
          View the design system
        </Link>
      </p>
    </>
  );
}
