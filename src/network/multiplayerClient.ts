import { ChatMessage, RemotePlayer, VehicleCategory } from '../types';

export interface MultiplayerCallbacks {
  onInit?: (yourId: string, players: RemotePlayer[], destructibles: Record<string, { destroyed: boolean }>, spawn?: RemotePlayer, assignedName?: string) => void;
  onNameAssigned?: (name: string) => void;
  onPlayerJoined?: (player: RemotePlayer) => void;
  onPlayerLeft?: (playerId: string) => void;
  onObjectDestroyed?: (objectId: string) => void;
  onObjectRespawned?: (objectId: string) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected') => void;
}

/** One received state for a remote player, stamped with local arrival time. */
interface Sample {
  t: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  steering: number;
}

/**
 * Remote players are drawn this far in the past so there are always two
 * samples to interpolate between. The server ticks at 20Hz, and WebSocket runs
 * over TCP so there is no packet loss to absorb — one tick plus a little jitter
 * headroom is enough. Without this the cars visibly jump: a 20Hz stream holds
 * each position for three frames of a 60fps display.
 */
const INTERPOLATION_DELAY_MS = 100;
/** Samples older than this are dropped from the buffer. */
const SAMPLE_HISTORY_MS = 1000;
/** Matches the server tick; sending faster than the server broadcasts is waste. */
const SEND_INTERVAL_MS = 50;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/** Interpolate an angle along the shortest arc, so 359 deg -> 1 deg does not spin backwards. */
const lerpAngle = (from: number, to: number, amount: number) => {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference * amount;
};

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  public playerId: string = '';
  public playerName: string = 'Дальнобойщик';
  public currentRoomId: string = 'default';
  public status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  /** Latest known state per remote player, including the fields that rarely change. */
  public remotePlayers: Map<string, RemotePlayer> = new Map();
  public callbacks: MultiplayerCallbacks = {};

  private buffers: Map<string, Sample[]> = new Map();
  private updateThrottleTimer: number = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private lastJoinPayload: Record<string, unknown> | null = null;

  constructor(playerName: string = 'Дальнобойщик', callbacks: MultiplayerCallbacks = {}) {
    this.playerName = playerName;
    this.callbacks = callbacks;
  }

  public connect(roomId: string = 'default') {
    this.currentRoomId = roomId;
    this.intentionallyClosed = false;
    this.openSocket();
  }

  private setStatus(status: 'disconnected' | 'connecting' | 'connected') {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private openSocket() {
    this.setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host || 'localhost:3000'}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');

        // The server assigns the player id, so a rejoin after a reconnect
        // simply asks for a new identity rather than claiming the old one.
        this.lastJoinPayload = {
          type: 'join',
          name: this.playerName,
          roomId: this.currentRoomId,
          x: 1200,
          y: 1200,
          vehicleType: 'kamaz_dump',
          vehicleColor: '#f97316',
        };
        this.send(this.lastJoinPayload);
      };

      this.ws.onmessage = (event) => {
        try {
          this.handleServerMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.remotePlayers.clear();
        this.buffers.clear();
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // 'close' always follows, and that is where the retry is scheduled.
        console.warn('WebSocket error; will retry unless disconnected on purpose.');
      };
    } catch (e) {
      console.warn('Could not initialize WebSocket:', e);
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  /**
   * Reconnect with exponential backoff. A free host that sleeps on idle drops
   * the socket, and without this the player stays offline until they reload.
   */
  private scheduleReconnect() {
    if (this.intentionallyClosed || this.reconnectTimer) return;

    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    const jittered = delay * (0.7 + Math.random() * 0.6);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed) this.openSocket();
    }, jittered);
  }

  private recordSample(playerId: string, sample: Sample) {
    let buffer = this.buffers.get(playerId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(playerId, buffer);
    }
    buffer.push(sample);

    const cutoff = sample.t - SAMPLE_HISTORY_MS;
    while (buffer.length > 2 && buffer[0].t < cutoff) buffer.shift();
  }

  private handleServerMessage(msg: {
    type: string;
    yourId?: string;
    players?: RemotePlayer[] | Array<Partial<RemotePlayer> & { id: string }>;
    player?: RemotePlayer;
    playerId?: string;
    objectId?: string;
    destructibles?: Record<string, { destroyed: boolean }>;
    name?: string;
    assignedName?: string;
    text?: string;
    timestamp?: number;
    vehicleType?: VehicleCategory;
    vehicleColor?: string;
  }) {
    switch (msg.type) {
      case 'init': {
        if (msg.yourId) this.playerId = msg.yourId;
        this.remotePlayers.clear();
        this.buffers.clear();
        const initialPlayers = (msg.players as RemotePlayer[] | undefined) || [];
        const spawn = initialPlayers.find((p) => p.id === this.playerId);
        initialPlayers.forEach((p) => {
          if (p.id !== this.playerId) this.remotePlayers.set(p.id, p);
        });
        this.callbacks.onInit?.(
          this.playerId,
          Array.from(this.remotePlayers.values()),
          msg.destructibles || {},
          spawn,
          msg.assignedName
        );
        break;
      }

      case 'player_joined': {
        if (msg.player && msg.player.id !== this.playerId) {
          this.remotePlayers.set(msg.player.id, msg.player);
          this.callbacks.onPlayerJoined?.(msg.player);
        }
        break;
      }

      // The 20Hz stream: only the fields that change while driving.
      case 'snapshot': {
        const now = performance.now();
        (msg.players as Array<Partial<RemotePlayer> & { id: string }> | undefined)?.forEach((update) => {
          if (update.id === this.playerId) return;
          const existing = this.remotePlayers.get(update.id);
          if (!existing) return; // join has not arrived yet; the next tick will land

          Object.assign(existing, update);
          this.recordSample(update.id, {
            t: now,
            x: update.x ?? existing.x,
            y: update.y ?? existing.y,
            angle: update.angle ?? existing.angle,
            speed: update.speed ?? existing.speed,
            steering: update.steering ?? existing.steering,
          });
        });
        break;
      }

      // Rare changes that are not worth a slot in every snapshot.
      case 'player_meta': {
        const player = msg.playerId ? this.remotePlayers.get(msg.playerId) : undefined;
        if (player) {
          if (msg.vehicleType) player.vehicleType = msg.vehicleType;
          if (msg.vehicleColor) player.vehicleColor = msg.vehicleColor;
          if (msg.name) player.name = msg.name;
        }
        break;
      }

      case 'name_assigned': {
        if (msg.name) {
          this.playerName = msg.name;
          this.callbacks.onNameAssigned?.(msg.name);
        }
        break;
      }

      case 'speech': {
        const player = msg.playerId ? this.remotePlayers.get(msg.playerId) : undefined;
        if (player && msg.text) {
          player.speechText = msg.text;
          player.speechTime = Date.now();
        }
        break;
      }

      case 'player_left': {
        if (msg.playerId) {
          this.remotePlayers.delete(msg.playerId);
          this.buffers.delete(msg.playerId);
          this.callbacks.onPlayerLeft?.(msg.playerId);
        }
        break;
      }

      case 'object_destroyed': {
        if (msg.objectId) this.callbacks.onObjectDestroyed?.(msg.objectId);
        break;
      }

      case 'object_respawned': {
        if (msg.objectId) this.callbacks.onObjectRespawned?.(msg.objectId);
        break;
      }

      case 'chat': {
        if (msg.playerId && msg.text && msg.name) {
          this.callbacks.onChatMessage?.({
            id: `chat_${Date.now()}_${Math.random()}`,
            playerId: msg.playerId,
            name: msg.name,
            text: msg.text,
            timestamp: msg.timestamp || Date.now(),
          });
        }
        break;
      }
    }
  }

  /**
   * Remote players positioned for the current frame. Call this every frame from
   * the render loop: it reads the sample buffer directly and never touches React
   * state, so a 20Hz network stream does not drive the component tree.
   */
  public getInterpolatedPlayers(): RemotePlayer[] {
    const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
    const result: RemotePlayer[] = [];

    this.remotePlayers.forEach((player) => {
      const buffer = this.buffers.get(player.id);
      if (!buffer || buffer.length === 0) {
        result.push(player);
        return;
      }

      let before: Sample | null = null;
      let after: Sample | null = null;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].t <= renderTime) {
          before = buffer[i];
          after = buffer[i + 1] ?? null;
          break;
        }
      }

      if (!before) {
        // Render time is older than anything buffered (the player just
        // appeared): show the oldest sample rather than snapping to the newest.
        const oldest = buffer[0];
        result.push({ ...player, x: oldest.x, y: oldest.y, angle: oldest.angle });
        return;
      }

      if (!after) {
        // Nothing newer yet — hold the last known state instead of
        // extrapolating into a wall.
        result.push({ ...player, x: before.x, y: before.y, angle: before.angle });
        return;
      }

      const span = after.t - before.t;
      const amount = span > 0 ? Math.min(1, Math.max(0, (renderTime - before.t) / span)) : 1;
      result.push({
        ...player,
        x: before.x + (after.x - before.x) * amount,
        y: before.y + (after.y - before.y) * amount,
        angle: lerpAngle(before.angle, after.angle, amount),
        speed: before.speed + (after.speed - before.speed) * amount,
        steering: before.steering + (after.steering - before.steering) * amount,
      });
    });

    return result;
  }

  public sendUpdate(state: {
    x: number;
    y: number;
    angle: number;
    speed: number;
    steering: number;
    inVehicle: boolean;
    vehicleType: VehicleCategory;
    vehicleColor: string;
    condition: number;
    headlights: number;
    turnSignal: string;
    isHonking: boolean;
    isSiren: boolean;
    speechText?: string;
  }) {
    if (this.status !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const now = Date.now();
    if (now - this.updateThrottleTimer < SEND_INTERVAL_MS) return;
    this.updateThrottleTimer = now;

    this.send({ type: 'update', ...state });
  }

  public sendObjectDestroyed(objectId: string) {
    this.send({ type: 'object_destroyed', objectId });
  }

  public sendChat(text: string) {
    this.send({ type: 'chat', text });
  }

  public rename(name: string) {
    this.send({ type: 'rename', name });
  }

  private send(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public disconnect() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.remotePlayers.clear();
    this.buffers.clear();
    this.setStatus('disconnected');
  }
}
