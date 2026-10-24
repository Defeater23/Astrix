import { formatUnitsExact } from './format';
import type { ApprovalRequest } from './types';

const SELECTOR_TRANSFER = '0xa9059cbb';
const SELECTOR_APPROVE = '0x095ea8b0';
/** selector (4 bytes) + two 32-byte words, as 0x-prefixed hex characters. */
const ERC20_CALL_LENGTH = 2 + 8 + 64 + 64;

export type ActionKind =
  | 'native_transfer'
  | 'erc20_transfer'
  | 'erc20_approve'
  | 'contract_call'
  | 'malformed_call';

export interface DescribeContext {
  connectedChainId: number;
  nativeSymbol: string;
}

export interface OperationDescription {
  kind: ActionKind;
  title: string;
  /** Who receives funds or is granted an allowance, when it can be determined exactly. */
  recipient?: string;
  /** Token contract for ERC-20 calls. */
  token?: string;
  /** Exact amount in base units (wei for native). */
  amountBaseUnits?: string;
  /** Human-readable amount, only when decimals are known. */
  amountDisplay?: string;
  /** Where the decimals came from, so the UI never implies chain verification. */
  amountNote?: string;
  nativeValueWei: string;
  nativeValueDisplay: string;
  selector?: string;
  functionName?: string;
  calldataBytes: number;
  decoded: boolean;
  warnings: string[];
}

function word(args: string, index: number): string {
  return args.slice(index * 64, index * 64 + 64);
}

/**
 * Describes the operation from its exact fields. Only ERC-20 transfer and approve are decoded;
 * everything else is shown as raw calldata and labelled undecoded. Non-canonical encodings
 * (wrong length, dirty address bits) are flagged, never "repaired".
 */
export function describeOperation(
  request: ApprovalRequest,
  ctx: DescribeContext,
): OperationDescription {
  const op = request.operation;
  const value = BigInt(op.value);
  const data = op.data.toLowerCase();
  const calldataBytes = (data.length - 2) / 2;
  const warnings: string[] = [];

  if (op.chainId !== ctx.connectedChainId) {
    warnings.push(
      `This request is for chain ID ${op.chainId} but the wallet is on chain ID ${ctx.connectedChainId}.`,
    );
  }
  if (op.target.toLowerCase() === op.account.toLowerCase()) {
    warnings.push('The target is the smart account itself.');
  }

  const base = {
    nativeValueWei: value.toString(),
    nativeValueDisplay: `${formatUnitsExact(value, 18)} ${ctx.nativeSymbol}`,
    calldataBytes,
  };

  if (data === '0x') {
    if (value === 0n) warnings.push('No value and no calldata: this operation transfers nothing.');
    return {
      ...base,
      kind: 'native_transfer',
      title: `Send ${ctx.nativeSymbol}`,
      recipient: op.target,
      amountBaseUnits: value.toString(),
      amountDisplay: base.nativeValueDisplay,
      amountNote: `Native currency, 18 decimals (${value.toString()} wei).`,
      decoded: true,
      warnings,
    };
  }

  const selector = data.slice(0, 10);
  const isErc20 = selector === SELECTOR_TRANSFER || selector === SELECTOR_APPROVE;

  if (data.length < 10 || (isErc20 && data.length !== ERC20_CALL_LENGTH)) {
    warnings.push(
      isErc20
        ? 'Calldata for a known token function has an unexpected length and was not decoded.'
        : 'Calldata is shorter than a 4-byte function selector.',
    );
    return { ...base, kind: 'malformed_call', title: 'Malformed call', decoded: false, warnings };
  }

  if (isErc20) {
    const args = data.slice(10);
    if (!/^0{24}/.test(word(args, 0))) {
      warnings.push('The address argument has non-zero upper bytes and was not decoded.');
      return {
        ...base,
        kind: 'malformed_call',
        title: 'Malformed call',
        selector,
        decoded: false,
        warnings,
      };
    }
    const recipient = `0x${word(args, 0).slice(24)}`;
    const amount = BigInt(`0x${word(args, 1)}`);
    const approve = selector === SELECTOR_APPROVE;
    const meta = request.tokenMeta;
    if (value > 0n) warnings.push('Native value is attached to a token call. Review carefully.');
    if (approve) {
      warnings.push('This grants a spending allowance; it does not move funds by itself.');
    }
    return {
      ...base,
      kind: approve ? 'erc20_approve' : 'erc20_transfer',
      title: approve ? 'Approve token allowance' : 'Transfer tokens',
      recipient,
      token: op.target,
      amountBaseUnits: amount.toString(),
      ...(meta
        ? {
            amountDisplay: `${formatUnitsExact(amount, meta.decimals)} ${meta.symbol}`,
            amountNote: `Symbol and ${meta.decimals} decimals come from the request and are not verified on-chain.`,
          }
        : { amountNote: 'Token decimals are unknown, so only exact base units are shown.' }),
      selector,
      functionName: approve ? 'approve(address,uint256)' : 'transfer(address,uint256)',
      decoded: true,
      warnings,
    };
  }

  warnings.push('Calldata was not decoded. Review the raw hex below.');
  if (value > 0n) warnings.push('Native value is sent together with calldata.');
  return {
    ...base,
    kind: 'contract_call',
    title: 'Contract call',
    selector,
    decoded: false,
    warnings,
  };
}
