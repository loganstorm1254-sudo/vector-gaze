export class Sessions {
  setSession(...args: unknown[]): void;
  getSession(remoteKey: unknown): unknown;
  setKeys(publicKey: unknown, privateKey: unknown): void;
  getKeys(): unknown;
  deleteSession(remoteKey: unknown): void;
  save(): void;
  clearSessions(): void;
}
