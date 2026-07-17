import { describe, expect, test } from "bun:test";
import {
  isDemoModeEnabled,
  resolveDemoPasswordHash,
  shouldUpsertDemoSeedRecord,
} from "../apps/api/src/demo-mode";

describe("demo mode policy", () => {
  test("only enables demo policy for an explicit true value", () => {
    expect(isDemoModeEnabled("true")).toBe(true);
    expect(isDemoModeEnabled(" TRUE ")).toBe(true);
    expect(isDemoModeEnabled("false")).toBe(false);
    expect(isDemoModeEnabled(undefined)).toBe(false);
  });

  test("keeps the configured legacy hash authoritative", async () => {
    const hashPassword = async () => "generated-hash";
    expect(await resolveDemoPasswordHash("plaintext", " legacy-hash ", hashPassword)).toBe("legacy-hash");
  });

  test("hashes a configured plaintext password for scheduled resets", async () => {
    const hashPassword = async (password: string) => `hashed:${password}`;
    expect(await resolveDemoPasswordHash("demo-password", undefined, hashPassword)).toBe("hashed:demo-password");
    expect(await resolveDemoPasswordHash(undefined, undefined, hashPassword)).toBeNull();
  });

  test("does not overwrite existing seed records during ordinary demo reads", () => {
    const existingIds = new Set(["memo_welcome"]);

    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_welcome", false)).toBe(false);
    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_missing", false)).toBe(true);
    expect(shouldUpsertDemoSeedRecord(existingIds, "memo_welcome", true)).toBe(true);
  });
});
