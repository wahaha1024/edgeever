import { describe, expect, test } from "bun:test";
import { hasBootstrapCredential, verifyBootstrapPassword } from "../apps/api/src/auth-bootstrap";

const rejectHash = async () => false;

describe("bootstrap password authentication", () => {
  test("accepts an exact plaintext password Secret", async () => {
    const password = "first-login#$ password";

    expect(hasBootstrapCredential(password, undefined)).toBe(true);
    expect(await verifyBootstrapPassword(password, password, undefined, rejectHash)).toBe(true);
    expect(await verifyBootstrapPassword(`${password}!`, password, undefined, rejectHash)).toBe(false);
  });

  test("keeps the legacy password hash authoritative when both values exist", async () => {
    const calls: Array<[string, string]> = [];
    const verifyHash = async (password: string, passwordHash: string) => {
      calls.push([password, passwordHash]);
      return password === "legacy-password" && passwordHash === "legacy-hash";
    };

    expect(
      await verifyBootstrapPassword("new-password", "new-password", "legacy-hash", verifyHash),
    ).toBe(false);
    expect(
      await verifyBootstrapPassword("legacy-password", "new-password", "legacy-hash", verifyHash),
    ).toBe(true);
    expect(calls).toEqual([
      ["new-password", "legacy-hash"],
      ["legacy-password", "legacy-hash"],
    ]);
  });

  test("rejects login when neither password setting exists", async () => {
    expect(hasBootstrapCredential(undefined, undefined)).toBe(false);
    expect(await verifyBootstrapPassword("password", undefined, undefined, rejectHash)).toBe(false);
  });
});
