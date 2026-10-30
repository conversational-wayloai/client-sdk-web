export const STATS_POLL_MS = 1000;
export const UNSTABLE_AFTER_FLAT_MS = 3000;
export const UNSTABLE_AFTER_ICE_DISCONNECTED_MS = 2000;
export const RECONNECTING_AFTER_FLAT_MS = 8000;
export const RECONNECTING_AFTER_SIGNAL_MS = 2000;
export const RECOVERED_AFTER_FLOW_MS = 1000;
export const MIN_SHOWN_MS = 1000;
// The server closes the room about 40 s after the link drops; rejoining later reaches an empty room.
export const RECONNECTING_LIMIT_MS = 45_000;

type Stat = Record<string, unknown>;

export interface ConnectionHealth {
  readonly isReconnecting: boolean;
  readonly isUnstable: boolean;
}

export interface ConnectionMonitorOptions {
  onChange(health: ConnectionHealth): void;
  onGiveUp(): void;
  readStats(): Promise<readonly ConnectionStats[]>;
}

export interface ConnectionStats {
  readonly bytesReceived: number;
  readonly iceState: string | undefined;
  readonly id: string;
  /** The stats timestamp: hidden tabs throttle timers, so elapsed time comes from here. */
  readonly timestamp: number;
}

/**
 * Warns sooner than LiveKit's reconnect events, without touching LiveKit's own timers: no bytes for
 * a few seconds means the path is dead even when the agent is silent, since RTCP and STUN keep flowing.
 */
export class ConnectionMonitor {
  readonly #options: ConnectionMonitorOptions;
  readonly #bytes = new Map<string, number>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  #signalTimer: ReturnType<typeof setTimeout> | undefined;
  #giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  #isPolling = false;
  #isStopped = false;
  #sampledAt: number | undefined;
  #flowedAt: number | undefined;
  #flowingSince: number | undefined;
  #iceDisconnectedSince: number | undefined;
  #signalReconnectingSince: number | undefined;
  #isAwaitingReconnected = false;
  #hasReconnected = false;
  #unstableSince: number | undefined;
  #reconnectingSince: number | undefined;

  constructor(options: ConnectionMonitorOptions) {
    this.#options = options;
  }

  start(): void {
    globalThis.addEventListener('offline', this.#onOffline);
    this.#timer = setInterval(() => this.#poll().catch(() => undefined), STATS_POLL_MS);
  }

  stop(): void {
    this.#isStopped = true;
    globalThis.removeEventListener('offline', this.#onOffline);
    clearInterval(this.#timer);
    clearTimeout(this.#holdTimer);
    clearTimeout(this.#signalTimer);
    clearTimeout(this.#giveUpTimer);
  }

  signalReconnecting(): void {
    this.#isAwaitingReconnected = true;
    this.#signalReconnectingSince ??= Date.now();
    this.#signalTimer ??= setTimeout(() => {
      this.#signalTimer = undefined;
      this.#evaluate();
    }, RECONNECTING_AFTER_SIGNAL_MS);
  }

  reconnecting(): void {
    this.#isAwaitingReconnected = true;
    this.#showReconnecting();
  }

  reconnected(): void {
    this.#isAwaitingReconnected = false;
    this.#signalReconnectingSince = undefined;
    clearTimeout(this.#signalTimer);
    this.#signalTimer = undefined;
    this.#bytes.clear();
    this.#sampledAt = undefined;
    this.#flowedAt = undefined;
    this.#flowingSince = undefined;
    if (this.#reconnectingSince !== undefined) this.#hasReconnected = true;
    this.#evaluate();
  }

  readonly #onOffline = (): void => {
    this.#flowingSince = undefined;
    this.#showReconnecting();
  };

  async #poll(): Promise<void> {
    if (this.#isPolling) return;
    this.#isPolling = true;
    const stats = await this.#options.readStats().catch(() => []);

    this.#isPolling = false;
    if (this.#isStopped) return;
    this.#record(stats);
    this.#evaluate();
  }

  #record(stats: readonly ConnectionStats[]): void {
    const isIceDisconnected = stats.some(stat => stat.iceState === 'disconnected');

    this.#iceDisconnectedSince = isIceDisconnected
      ? (this.#iceDisconnectedSince ?? Date.now())
      : undefined;
    if (stats.length === 0) return;

    const sampledAt = Math.max(...stats.map(stat => stat.timestamp));
    const hasFlowed = stats.some(
      stat => stat.bytesReceived > (this.#bytes.get(stat.id) ?? Infinity),
    );

    for (const stat of stats) this.#bytes.set(stat.id, stat.bytesReceived);
    this.#sampledAt = sampledAt;

    if (this.#flowedAt === undefined) {
      this.#flowedAt = sampledAt;
      if (this.#unstableSince === undefined) this.#flowingSince = sampledAt;
    } else if (hasFlowed) {
      this.#flowedAt = sampledAt;
      this.#flowingSince ??= sampledAt;
    }

    const flatMs = this.#flatMs();

    if (flatMs >= UNSTABLE_AFTER_FLAT_MS) this.#flowingSince = undefined;
  }

  #flatMs(): number {
    return (this.#sampledAt ?? 0) - (this.#flowedAt ?? this.#sampledAt ?? 0);
  }

  #isFlowing(): boolean {
    return (
      this.#flowingSince !== undefined &&
      (this.#sampledAt ?? 0) - this.#flowingSince >= RECOVERED_AFTER_FLOW_MS
    );
  }

  #evaluate(): void {
    const now = Date.now();
    const flatMs = this.#flatMs();
    const isIceDown =
      this.#iceDisconnectedSince !== undefined &&
      now - this.#iceDisconnectedSince >= UNSTABLE_AFTER_ICE_DISCONNECTED_MS;
    const isSignalDown =
      this.#signalReconnectingSince !== undefined &&
      now - this.#signalReconnectingSince >= RECONNECTING_AFTER_SIGNAL_MS;

    if (this.#unstableSince === undefined) {
      if (flatMs >= UNSTABLE_AFTER_FLAT_MS || isIceDown) this.#setUnstable(true);
    } else if (
      this.#iceDisconnectedSince === undefined &&
      this.#isFlowing() &&
      now - this.#unstableSince >= MIN_SHOWN_MS
    ) {
      this.#setUnstable(false);
    }

    if (this.#reconnectingSince === undefined) {
      if (flatMs >= RECONNECTING_AFTER_FLAT_MS || isSignalDown) this.#showReconnecting();
    } else if (this.#canClearReconnecting()) {
      this.#clearReconnecting(now);
    }
  }

  // Never on `online` alone: the browser reports online on a LAN with no internet.
  #canClearReconnecting(): boolean {
    if (this.#hasReconnected) return true;

    return !this.#isAwaitingReconnected && this.#isFlowing() && globalThis.navigator.onLine;
  }

  #clearReconnecting(now: number): void {
    const shownMs = now - (this.#reconnectingSince ?? now);

    if (shownMs < MIN_SHOWN_MS) {
      this.#holdTimer ??= setTimeout(() => {
        this.#holdTimer = undefined;
        this.#evaluate();
      }, MIN_SHOWN_MS - shownMs);

      return;
    }

    this.#reconnectingSince = undefined;
    this.#hasReconnected = false;
    clearTimeout(this.#giveUpTimer);
    this.#giveUpTimer = undefined;
    this.#emit();
  }

  #showReconnecting(): void {
    clearTimeout(this.#holdTimer);
    this.#holdTimer = undefined;
    this.#hasReconnected = false;
    if (this.#reconnectingSince !== undefined) return;
    this.#reconnectingSince = Date.now();
    this.#giveUpTimer = setTimeout(() => this.#options.onGiveUp(), RECONNECTING_LIMIT_MS);
    this.#emit();
  }

  #setUnstable(isUnstable: boolean): void {
    this.#unstableSince = isUnstable ? Date.now() : undefined;
    this.#emit();
  }

  #emit(): void {
    if (this.#isStopped) return;
    this.#options.onChange({
      isReconnecting: this.#reconnectingSince !== undefined,
      isUnstable: this.#unstableSince !== undefined,
    });
  }
}

export function readConnectionStats(
  report: RTCStatsReport,
  source: string,
): ConnectionStats | null {
  let transport: Stat | undefined;
  const pairs = new Map<unknown, Stat>();

  report.forEach((stat: Stat) => {
    if (stat.type === 'transport') transport ??= stat;
    if (stat.type === 'candidate-pair') pairs.set(stat.id, stat);
  });

  const pair = transport?.selectedCandidatePairId
    ? pairs.get(transport.selectedCandidatePairId)
    : [...pairs.values()].find(
        stat => stat.selected === true || (stat.nominated === true && stat.state === 'succeeded'),
      );
  const bytesReceived = pair?.bytesReceived ?? transport?.bytesReceived;
  const timestamp = pair?.timestamp ?? transport?.timestamp;

  if (typeof bytesReceived !== 'number' || typeof timestamp !== 'number') return null;
  const iceState = transport?.iceState;

  return {
    bytesReceived,
    iceState: typeof iceState === 'string' ? iceState : undefined,
    id: `${source}:${String(transport?.id ?? pair?.id)}`,
    timestamp,
  };
}
