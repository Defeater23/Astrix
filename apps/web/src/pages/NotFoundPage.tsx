import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-content px-4 py-16 sm:px-6">
      <PageHeader title="Page not found" description="This address does not match any page." />
      <Link to="/" className="text-sm underline">
        Go to the landing page
      </Link>
    </div>
  );
}
