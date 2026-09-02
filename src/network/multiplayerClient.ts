import { ChatMessage, DestructibleObject, RemotePlayer, VehicleCategory } from '../types';

export interface MultiplayerCallbacks {
  onInit?: (yourId: string, players: RemotePlayer[], destructibles: Record<string, { destroyed: boolean }>) => void;
  onPlayerJoined?: (player: RemotePlayer) => void;
  onPlayerUpdated?: (player: RemotePlayer) => void;
  onPlayerLeft?: (playerId: string) => void;
  onObjectDestroyed?: (objectId: string) => void;
  onObjectRespawned?: (objectId: string) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected') => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  public playerId: string = '';
  public playerName: string = 'Дальнобойщик';
  public currentRoomId: string = 'default';
  public status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  public remotePlayers: Map<string, RemotePlayer> = new Map();
  public callbacks: MultiplayerCallbacks = {};

  private updateThrottleTimer: number = 0;

  constructor(playerName: string = 'Дальнобойщик', callbacks: MultiplayerCallbacks = {}) {
    this.playerName = playerName;
    this.callbacks = callbacks;
    this.playerId = `player_${Math.random().toString(36).substring(2, 8)}`;
  }

  public connect(roomId: string = 'default') {
    this.currentRoomId = roomId;
    this.status = 'connecting';
    this.callbacks.onStatusChange?.(this.status);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
     const wsUrl = `${protocol}//${window.location.host || 'localhost:3000'}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.status = 'connected';
        this.callbacks.onStatusChange?.(this.status);

        // Send Join payload
        this.send({
          type: 'join',
          playerId: this.playerId,
          name: this.playerName,
          roomId: this.currentRoomId,
          x: 1200,
          y: 1200,
          vehicleType: 'kamaz_dump',
          vehicleColor: '#f97316',
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.status = 'disconnected';
        this.callbacks.onStatusChange?.(this.status);
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error, running in local solo mode:', err);
        this.status = 'disconnected';
        this.callbacks.onStatusChange?.(this.status);
      };
    } catch (e) {
      console.warn('Could not initialize WebSocket:', e);
      this.status = 'disconnected';
      this.callbacks.onStatusChange?.(this.status);
    }
  }

  private handleServerMessage(msg: {
    type: string;
    yourId?: string;
    players?: RemotePlayer[];
    player?: RemotePlayer;
    playerId?: string;
    objectId?: string;
    destructibles?: Record<string, { destroyed: boolean }>;
    name?: string;
    text?: string;
    timestamp?: number;
  }) {
    switch (msg.type) {
      case 'init': {
        if (msg.yourId) this.playerId = msg.yourId;
        if (msg.players) {
          this.remotePlayers.clear();
          msg.players.forEach((p) => {
            if (p.id !== this.playerId) {
              this.remotePlayers.set(p.id, p);
            }
          });
        }
        this.callbacks.onInit?.(this.playerId, Array.from(this.remotePlayers.values()), msg.destructibles || {});
        break;
      }

      case 'player_joined': {
        if (msg.player && msg.player.id !== this.playerId) {
          this.remotePlayers.set(msg.player.id, msg.player);
          this.callbacks.onPlayerJoined?.(msg.player);
        }
        break;
      }

      case 'player_updated': {
        if (msg.player && msg.player.id !== this.playerId) {
          this.remotePlayers.set(msg.player.id, msg.player);
          this.callbacks.onPlayerUpdated?.(msg.player);
        }
        break;
      }

      case 'player_left': {
        if (msg.playerId) {
          this.remotePlayers.delete(msg.playerId);
          this.callbacks.onPlayerLeft?.(msg.playerId);
        }
        break;
      }

      case 'object_destroyed': {
        if (msg.objectId) {
          this.callbacks.onObjectDestroyed?.(msg.objectId);
        }
        break;
      }

      case 'object_respawned': {
        if (msg.objectId) {
          this.callbacks.onObjectRespawned?.(msg.objectId);
        }
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
    if (now - this.updateThrottleTimer < 45) return; // ~22 updates/sec max
    this.updateThrottleTimer = now;

    this.send({
      type: 'update',
      ...state,
    });
  }

  public sendObjectDestroyed(objectId: string) {
    this.send({
      type: 'object_destroyed',
      objectId,
    });
  }

  public sendChat(text: string) {
    this.send({
      type: 'chat',
      name: this.playerName,
      text,
    });
  }

  private send(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    this.remotePlayers.clear();
  }
}
