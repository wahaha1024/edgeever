type PasswordHashVerifier = (password: string, passwordHash: string) => Promise<boolean>;

export const hasBootstrapCredential = (password: string | undefined, passwordHash: string | undefined) =>
  Boolean(password || passwordHash?.trim());

export const verifyBootstrapPassword = async (
  password: string,
  configuredPassword: string | undefined,
  configuredPasswordHash: string | undefined,
  verifyPasswordHash: PasswordHashVerifier,
) => {
  const passwordHash = configuredPasswordHash?.trim();

  if (passwordHash) {
    return verifyPasswordHash(password, passwordHash);
  }

  if (configuredPassword === undefined || configuredPassword.length === 0) {
    return false;
  }

  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(configuredPassword)),
  ]);

  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }

  return diff === 0;
};
