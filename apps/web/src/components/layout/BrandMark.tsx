import { Link } from 'react-router-dom';
import { env } from '../../config/env';

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold text-black">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded bg-black text-xs text-white"
      >
        S
      </span>
      <span>{env.appName}</span>
    </Link>
  );
}
