import { describe, expect, test } from "bun:test";
import { pbkdf2Sync } from "node:crypto";
import {
  PASSWORD_HASH_BYTES,
  PASSWORD_HASH_ITERATIONS,
  createPasswordHash,
} from "../scripts/password-hash.mjs";
import {
  buildPasswordHashLookupSql,
  buildPasswordResetSql,
  buildUserLookupSql,
  parseD1Rows,
  parseResetPasswordArgs,
} from "../scripts/reset-password.mjs";

const decodeBase64Url = (value: string) => Buffer.from(value, "base64url");

describe("password reset script", () => {
  test("creates hashes compatible with EdgeEver authentication", () => {
    const password = "demo-password";
    const salt = Buffer.alloc(16, 7);
    const encoded = createPasswordHash(password, salt);
    const [algorithm, iterations, encodedSalt, encodedHash] = encoded.split("$");

    expect(algorithm).toBe("pbkdf2-sha256");
    expect(Number(iterations)).toBe(PASSWORD_HASH_ITERATIONS);
    expect(decodeBase64Url(encodedSalt)).toEqual(salt);
    expect(decodeBase64Url(encodedHash)).toEqual(
      pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_BYTES, "sha256"),
    );
  });

  test("requires an explicit target and username", () => {
    expect(parseResetPasswordArgs(["--remote", "--username", "ee-demo"])).toEqual({
      target: "remote",
      username: "ee-demo",
    });
    expect(() => parseResetPasswordArgs(["--username", "ee-demo"])).toThrow("Choose --remote or --local");
    expect(() => parseResetPasswordArgs(["--remote"])).toThrow("Provide --username");
  });

  test("escapes usernames and revokes existing sessions", () => {
    expect(buildUserLookupSql("demo'user")).toContain("username = 'demo''user'");
    expect(buildPasswordHashLookupSql("demo'user")).toContain("username = 'demo''user'");

    const sql = buildPasswordResetSql("demo'user", "pbkdf2$hash");
    expect(sql).toContain("password_hash = 'pbkdf2$hash'");
    expect(sql).toContain("username = 'demo''user'");
    expect(sql).toContain("UPDATE sessions");
    expect(sql).toContain("revoked_at IS NULL");
    expect(sql).not.toContain("BEGIN TRANSACTION");
  });

  test("reads rows from Wrangler JSON output", () => {
    expect(parseD1Rows(JSON.stringify([{ results: [{ id: "usr_demo" }], success: true }]))).toEqual([
      { id: "usr_demo" },
    ]);
  });
});
