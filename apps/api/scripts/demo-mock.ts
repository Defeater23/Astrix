/**
 * Deterministic demo of Module 8A. Uses the MOCK adapter, a fixed clock and fixed ids, so the output
 * is identical on every run. No network, no key, no chain access. Run: npm run demo
 */
import { MockAiProvider } from '../src/ai/adapters/mock.js';
import { CONTEXT, FIXED_NOW, LIMITS, RECIPIENT } from '../src/ai/fixtures.js';
import { generateProposal } from '../src/ai/proposal.js';

const requests = [
  `send 0.5 ETH to ${RECIPIENT} because Invoice 42`,
  `transfer 25 USDC to ${RECIPIENT}`,
  `approve 100 USDC for ${RECIPIENT}`,
  'swap my ETH for a pizza',
  `send 1 DOGE to ${RECIPIENT}`,
];

let counter = 0;
const deps = {
  provider: new MockAiProvider(),
  limits: LIMITS,
  newId: () => `prop-demo-${++counter}`,
  nowSeconds: () => FIXED_NOW,
};

for (const request of requests) {
  const proposal = await generateProposal(deps, { request, context: CONTEXT });
  console.log(JSON.stringify(proposal, null, 2));
}
