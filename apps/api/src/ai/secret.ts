import { inspect } from 'node:util';

/**
 * Wraps a secret so that logging, JSON serialization, string conversion and `util.inspect` can never
 * print it. The only way to read the value is the explicit `reveal()` call, used by an adapter when
 * it builds a request header.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  [inspect.custom](): string {
    return '[redacted]';
  }
}

/** Removes every occurrence of the secret from a message (defence in depth for error text). */
export function redact(text: string, secret: Secret | undefined): string {
  if (!secret) return text;
  const value = secret.reveal();
  return value.length === 0 ? text : text.split(value).join('[redacted]');
}
