import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseEnv } from './env';

describe('parseEnv', () => {
  it('uses documented defaults when nothing is set', () => {
    expect(parseEnv({})).toEqual(DEFAULTS);
  });

  it('defaults to Ethereum Sepolia', () => {
    expect(parseEnv({}).defaultChainId).toBe(11155111);
  });

  it('accepts valid overrides and strips trailing slashes from URLs', () => {
    const env = parseEnv({
      VITE_APP_NAME: 'Custom',
      VITE_DEFAULT_CHAIN_ID: '31337',
      VITE_EXPLORER_URL: 'https://explorer.example/',
      VITE_API_BASE_URL: 'http://localhost:4100//',
    });
    expect(env).toEqual({
      appName: 'Custom',
      defaultChainId: 31337,
      explorerUrl: 'https://explorer.example',
      apiBaseUrl: 'http://localhost:4100',
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '0x1', '99999999999999999999'])(
    'rejects invalid chain ID %s',
    (value) => {
      expect(() => parseEnv({ VITE_DEFAULT_CHAIN_ID: value })).toThrow(/chain ID/);
    },
  );

  it.each(['not a url', 'ftp://example.com', 'javascript:alert(1)'])(
    'rejects invalid URL %s',
    (value) => {
      expect(() => parseEnv({ VITE_API_BASE_URL: value })).toThrow(/http\(s\) URL/);
    },
  );
});
