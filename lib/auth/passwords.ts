import bcrypt from "bcryptjs";

const DUMMY_PASSWORD_HASH =
  "$2b$12$9fk1u7G8TX76QJ9Vf9vBju1XxGQ2mD7M0w9R7bA4mQ2YpQ7v2Gk3K";

export async function hashPassword(value: string) {
  return bcrypt.hash(value, 12);
}

export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string | null
) {
  const hashToCheck = passwordHash || DUMMY_PASSWORD_HASH;
  const matches = await bcrypt.compare(plainTextPassword, hashToCheck);
  return Boolean(passwordHash) && matches;
}
