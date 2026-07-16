type PasswordHasher = (password: string) => Promise<string>;

export const isDemoModeEnabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export const resolveDemoPasswordHash = async (
  configuredPassword: string | undefined,
  configuredPasswordHash: string | undefined,
  hashPassword: PasswordHasher,
) => {
  const passwordHash = configuredPasswordHash?.trim();
  if (passwordHash) {
    return passwordHash;
  }

  return configuredPassword ? hashPassword(configuredPassword) : null;
};
