import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '../../config/navigation';
import { cn } from '../../lib/cn';

export interface SidebarNavProps {
  /** Called after a link is chosen (used to close the mobile drawer). */
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center justify-between rounded px-3 py-2 text-sm',
              isActive ? 'bg-black font-medium text-white' : 'text-charcoal hover:bg-gray-200',
            )
          }
        >
          <span>{item.label}</span>
          <span className="text-xs opacity-70" aria-hidden="true">
            M{item.module}
          </span>
        </NavLink>
      ))}
      <NavLink
        to="/design-system"
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'mt-3 rounded border border-dashed px-3 py-2 text-sm',
            isActive
              ? 'border-black bg-black text-white'
              : 'border-gray-400 text-gray-600 hover:bg-gray-200',
          )
        }
      >
        Design system
      </NavLink>
    </nav>
  );
}
