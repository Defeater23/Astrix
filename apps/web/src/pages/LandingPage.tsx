import { Link } from 'react-router-dom';
import { BrandMark } from '../components/layout/BrandMark';
import { Card, StatusLabel } from '../components/ui';
import { CURRENT_MODULE, TOTAL_MODULES } from '../config/navigation';

const STEPS = [
  {
    title: 'The agent proposes',
    body: 'An AI agent turns a task into a structured transaction proposal. A proposal is a request, never an authorization.',
  },
  {
    title: 'The account decides',
    body: 'Smart-account authorization and an on-chain spending policy determine whether an operation may execute.',
  },
  {
    title: 'The owner approves exceptions',
    body: 'Only exceptions the policy explicitly allows can be approved, and only for the exact operation the owner reviewed.',
  },
];

const PRINCIPLES = [
  'Owner and agent authority are kept separate.',
  'Amounts use exact base units, never floating point.',
  'Unsupported operations fail closed.',
  'Status is shown only when chain evidence supports it.',
  'Prompt injection cannot change policy or authorize execution.',
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandMark />
          <Link
            to="/dashboard"
            className="inline-flex h-8 items-center rounded border border-gray-300 px-3 text-sm font-medium text-black hover:bg-gray-100"
          >
            Open app
          </Link>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-24">
          <StatusLabel tone="dashed">
            Module {CURRENT_MODULE} of {TOTAL_MODULES}: wallet, smart-account overview, local agent
            registry and policy drafts. Test networks only.
          </StatusLabel>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-black sm:text-5xl">
            Letting AI agents pay safely.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-gray-600">
            Sentinel Wallet is a security-first agent wallet. The AI agent proposes transactions;
            smart-account authorization and on-chain policy decide what may execute.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="inline-flex h-10 items-center rounded border border-black bg-black px-4 text-sm font-medium text-white hover:bg-charcoal"
            >
              Open the app
            </Link>
            <Link
              to="/design-system"
              className="inline-flex h-10 items-center rounded border border-gray-300 bg-white px-4 text-sm font-medium text-black hover:bg-gray-100"
            >
              View design system
            </Link>
            <Link
              to="/wallet"
              className="inline-flex h-10 items-center rounded border border-gray-300 bg-white px-4 text-sm font-medium text-black hover:bg-gray-100"
            >
              Connect wallet
            </Link>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="border-y border-gray-200 bg-offwhite">
          <div className="mx-auto max-w-content px-4 py-14 sm:px-6">
            <h2 id="how-heading" className="text-2xl font-semibold text-black">
              How it is designed to work
            </h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <Card className="h-full">
                    <p className="text-sm text-gray-600">Step {index + 1}</p>
                    <h3 className="mt-1 text-base font-semibold text-black">{step.title}</h3>
                    <p className="mt-2 text-sm text-gray-700">{step.body}</p>
                  </Card>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-gray-600">
              This describes the planned design. As of Module {CURRENT_MODULE} only MetaMask
              connection, read-only account state and a browser-local agent registry and policy
              drafts exist; nothing is enforced on-chain, owner approval review is a UI-only demo, and nothing has
              been security-audited.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="principles-heading"
          className="mx-auto max-w-content px-4 py-14 sm:px-6"
        >
          <h2 id="principles-heading" className="text-2xl font-semibold text-black">
            Design principles
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <li key={principle} className="rounded border border-gray-200 px-4 py-3 text-sm">
                {principle}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-gray-200 px-4 py-6 text-center text-xs text-gray-600">
        Sentinel Wallet uses Ethereum Sepolia and local test chains with test funds only. No
        mainnet. No real funds.
      </footer>
    </div>
  );
}
