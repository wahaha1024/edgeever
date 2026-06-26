import { pbkdf2Sync, randomBytes } from "node:crypto";

const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

const password = process.argv.slice(2).join(" ") || process.env.EDGE_EVER_PASSWORD;

if (!password) {
  console.error("Usage: bun run auth:hash -- <password>");
  console.error("Or: EDGE_EVER_PASSWORD=<password> bun run auth:hash");
  process.exit(1);
}

const base64UrlEncode = (buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const salt = randomBytes(PASSWORD_SALT_BYTES);
const hash = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, PASSWORD_HASH_BYTES, "sha256");

console.log(
  [PASSWORD_HASH_ALGORITHM, PASSWORD_HASH_ITERATIONS, base64UrlEncode(salt), base64UrlEncode(hash)].join("$")
);
