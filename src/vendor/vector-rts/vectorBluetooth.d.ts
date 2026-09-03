export class VectorBluetooth {
  bleName: string;
  sessions: Record<string, unknown>;
  send(arr: number[]): void;
  onReceive(fnc: { receive: (data: number[]) => void }): void;
  onCancelSelect(fnc: () => void): void;
  onDisconnected(fnc: () => void): void;
  onReceiveUnsubscribe(obj: unknown): void;
  tryConnect(vectorFilter: string | null): void;
  tryDisconnect(): void;
}
