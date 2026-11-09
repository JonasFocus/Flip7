import assert from "node:assert/strict";
import { test } from "node:test";
import { getClientId } from "../lib/client/identity.ts";

test("HTTP LAN identities use cryptographic randomness and survive unavailable storage", () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const platformCrypto = globalThis.crypto;
  const values = new Map<string, string>();
  let randomCalls = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        randomCalls++;
        return platformCrypto.getRandomValues(bytes);
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const id = getClientId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(values.get("flip7:clientId"), id);
    assert.equal(getClientId(), id);
    assert.equal(randomCalls, 1);

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("Storage blocked"); },
    });
    assert.equal(getClientId(), id);
    assert.equal(getClientId(), id);
    assert.equal(randomCalls, 1);
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
    else Reflect.deleteProperty(globalThis, "crypto");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
