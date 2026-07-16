import { pbkdf2Sync, randomBytes } from "node:crypto";

export const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
export const PASSWORD_HASH_ITERATIONS = 100_000;
export const PASSWORD_HASH_BYTES = 32;
export const PASSWORD_SALT_BYTES = 16;

const base64UrlEncode = (buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const createPasswordHash = (password, salt = randomBytes(PASSWORD_SALT_BYTES)) => {
  const hash = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_BYTES, "sha256");

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(hash),
  ].join("$");
};
