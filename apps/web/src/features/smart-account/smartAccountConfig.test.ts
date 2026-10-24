import { describe, expect, it } from 'vitest';
import { ENTRYPOINT_V07_ADDRESS } from './entryPoint';
import { parseSmartAccountConfig } from './smartAccountConfig';

describe('parseSmartAccountConfig', () => {
  it('leaves addresses undefined when nothing is set', () => {
    const config = parseSmartAccountConfig({});
    expect(config.addresses[11155111]).toBeUndefined();
    expect(config.addresses[31337]).toBeUndefined();
  });

  it('treats empty strings as not configured', () => {
    const config = parseSmartAccountConfig({ VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA: '' });
    expect(config.addresses[11155111]).toBeUndefined();
  });

  it('normalizes a lowercase address to checksum casing and keeps chains separate', () => {
    const config = parseSmartAccountConfig({
      VITE_SMART_ACCOUNT_ADDRESS_ANVIL: ` ${ENTRYPOINT_V07_ADDRESS.toLowerCase()} `,
    });
    expect(config.addresses[31337]).toBe(ENTRYPOINT_V07_ADDRESS);
    expect(config.addresses[11155111]).toBeUndefined();
  });

  it('rejects a malformed address', () => {
    expect(() => parseSmartAccountConfig({ VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA: '0x123' })).toThrow(
      /valid EVM address/,
    );
  });

  it('rejects a mixed-case address with a wrong checksum', () => {
    const bad = ENTRYPOINT_V07_ADDRESS.replace('De22', 'dE22');
    expect(() => parseSmartAccountConfig({ VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA: bad })).toThrow(
      /valid EVM address/,
    );
  });

  it('rejects the zero address', () => {
    expect(() =>
      parseSmartAccountConfig({
        VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000000',
      }),
    ).toThrow(/zero address/);
  });
});
