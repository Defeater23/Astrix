/**
 * Single source of truth for application routes, navigation and the planned scope
 * of each placeholder page. Scope text mirrors the "Agent Wallet - Final 12-Module
 * Development Plan". Nothing here implies that a feature already exists.
 */

export interface NavItem {
  /** Route path, always starting with "/". */
  path: string;
  label: string;
  /** Module number (1-12) in which the real feature is delivered. */
  module: number;
  moduleTitle: string;
  summary: string;
  /** Planned scope bullets shown on the placeholder page. */
  scope: string[];
  /** Metrics shown as "Unavailable" until a verified data source exists. */
  metrics?: Array<{ label: string; reason: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    module: 10,
    moduleTitle: 'Spending Analytics & Monitoring',
    summary: 'Overview of balance, daily spend, remaining allowance and security events.',
    scope: [
      'Verified wallet and smart-account balance',
      'Daily spend and remaining allowance',
      'Success and failure counts, policy denials and approvals',
    ],
    metrics: [
      { label: 'Smart-account balance', reason: 'Needs a connected wallet and smart account.' },
      { label: 'Spent today', reason: 'Needs on-chain policy and indexed transactions.' },
      { label: 'Remaining allowance', reason: 'Needs an enforced on-chain spending policy.' },
      { label: 'Pending approvals', reason: 'Needs the owner approval workflow.' },
    ],
  },
  {
    path: '/wallet',
    label: 'Wallet',
    module: 3,
    moduleTitle: 'Smart Account & Wallet Overview',
    summary: 'Owner EOA and ERC-4337 smart account, shown separately.',
    scope: [
      'Owner EOA address and chain ID (from Module 2)',
      'Smart-account address with deployed / initialized / counterfactual state',
      'Chain-derived balances labeled with network',
      'Documentation of bundler, paymaster and EntryPoint requirements',
    ],
    metrics: [
      { label: 'Owner EOA', reason: 'MetaMask integration arrives in Module 2.' },
      { label: 'Smart account', reason: 'Account integration arrives in Module 3.' },
    ],
  },
  {
    path: '/agents',
    label: 'Agents',
    module: 4,
    moduleTitle: 'Agent Registration & Management',
    summary: 'Register agents and manage their lifecycle.',
    scope: [
      'Register name, description, signer address and optional expiry',
      'Active, paused, expired and revoked states',
      'Pause, resume and revoke with confirmation',
      'Enforcement in the smart-account layer, not by a frontend flag',
    ],
  },
  {
    path: '/policies',
    label: 'Policies',
    module: 5,
    moduleTitle: 'Spending Policy Engine',
    summary: 'Configure limits and allowlists enforced on-chain.',
    scope: [
      'Per-transaction and daily cumulative limits',
      'Recipient, token, contract and function-selector allowlists',
      'Draft, submitted and confirmed on-chain policy state',
      'A form edit alone never means a policy is enforced',
    ],
  },
  {
    path: '/approvals',
    label: 'Approvals',
    module: 7,
    moduleTitle: 'Owner Approval & Authorization Workflow',
    summary: 'Review and approve eligible exceptions for the exact operation.',
    scope: [
      'Pending requests with full operation details',
      'Cryptographic approval bound to the exact payload, nonce and expiry',
      'Forged, expired, altered and replayed approvals are rejected',
    ],
  },
  {
    path: '/ai-agent',
    label: 'AI Agent',
    module: 8,
    moduleTitle: 'AI Agent Integration',
    summary: 'Natural-language tasks become validated, structured proposals.',
    scope: [
      'Natural-language task input with structured proposal output',
      'Schema validation, policy pre-checks and human-readable preview',
      'Prompt-injection defenses: the AI proposes, it never authorizes',
    ],
  },
  {
    path: '/transactions',
    label: 'Transactions',
    module: 9,
    moduleTitle: 'Transaction History & Audit Logs',
    summary: 'Verified history and audit trail from proposal to final outcome.',
    scope: [
      'History built from verified chain events and receipts',
      'Explorer links, search and filters',
      'Application records clearly separated from on-chain proof',
    ],
  },
  {
    path: '/analytics',
    label: 'Analytics',
    module: 10,
    moduleTitle: 'Spending Analytics & Monitoring',
    summary: 'Spending breakdowns and security-event metrics.',
    scope: [
      'Spend by agent, recipient and time period',
      'Restrained grayscale charts with source and staleness labels',
      'Explicit empty, loading, error and stale states',
    ],
  },
  {
    path: '/security',
    label: 'Security',
    module: 11,
    moduleTitle: 'Security Simulator & Attack Testing',
    summary: 'Attack Lab and regression results.',
    scope: [
      'Real contract and local-chain test results',
      'UI-only simulations clearly labeled as illustrative',
      'Every discovered bypass becomes a regression test',
    ],
  },
  {
    path: '/settings',
    label: 'Settings',
    module: 12,
    moduleTitle: 'Production Readiness & Deployment',
    summary: 'Network, service and deployment configuration.',
    scope: [
      'Configured chain ID, RPC and contract addresses',
      'Service health and documented limitations',
      'Emergency pause and recovery documentation',
    ],
  },
];

export const TOTAL_MODULES = 12;
export const CURRENT_MODULE = 5;

export function findNavItem(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === path);
}
