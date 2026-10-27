export interface WebCredentials {
  version: 1;
  kdf: { N: 32768; r: 8; p: 1 };
  salt: string;
  verifier: string;
  key: string;
}
export function authDirectory(env?: NodeJS.ProcessEnv): string;
export function readCredentials(env?: NodeJS.ProcessEnv): WebCredentials | null;
export function verifyPassword(password: string, record: WebCredentials): Promise<boolean>;
export function setupCredentials(password: string, options?: { replace?: boolean; env?: NodeJS.ProcessEnv }): Promise<void>;
