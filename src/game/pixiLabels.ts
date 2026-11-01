import { Container, Graphics, Text } from 'pixi.js';
import { PlayerCharacter, RemotePlayer, VehicleInstance } from '../types';
import { VEHICLE_CONFIGS } from './vehicleConfigs';
import { nameColorForId } from './nameGenerator';
import {
  CHAT_BUBBLE_FONT_SIZE, CHAT_BUBBLE_GAP, CHAT_BUBBLE_MAX_WIDTH, CHAT_BUBBLE_PAD_X, CHAT_BUBBLE_PAD_Y,
  CHAT_BUBBLE_TAIL, getChatBubbles, getLocalChatPlayerId,
} from './chatBubbles';
import { Bounds, isVisible } from './pixiUtils';

const PLAYER_CHARACTER_LABEL_ID = 'player-character';

/**
 * Everything drawn as text above entities: remote name tags + health bars, the
 * on-foot player's tag, NPC speech bubbles and player chat bubbles. Owns its
 * two display layers; PixiGameRenderer just adds them to the world.
 */
export class LabelOverlay {
  public readonly nameLabelLayer = new Container();
  public readonly speechLayer = new Container();
  /** Text rasterisation scale; set once the renderer knows the pixel ratio. */
  public spriteResolution = 2;

  private readonly nameLabels = new Map<string, Text>();
  private readonly nameHealthBars = new Map<string, Graphics>();
  private readonly speechBubbles = new Map<string, { bg: Graphics; text: Text }>();
  private readonly chatBubbleViews = new Map<string, { bg: Graphics; text: Text }>();

  public updatePlayerCharacterLabel(playerChar: PlayerCharacter) {
    let label = this.nameLabels.get(PLAYER_CHARACTER_LABEL_ID);
    if (!label) {
      label = new Text({
        text: playerChar.name,
        style: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12,
          fontWeight: 'bold',
          fill: 0x38bdf8,
          stroke: { color: 0x0f172a, width: 3 },
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.nameLabelLayer.addChild(label);
      this.nameLabels.set(PLAYER_CHARACTER_LABEL_ID, label);
    } else if (label.text !== playerChar.name) {
      label.text = playerChar.name;
    }
    label.visible = true;
    label.position.set(playerChar.x, playerChar.y - 20);
  }

  public hidePlayerCharacterLabel() {
    const label = this.nameLabels.get(PLAYER_CHARACTER_LABEL_ID);
    if (label) label.visible = false;
  }

  public updateNameLabel(remote: RemotePlayer, bounds: Bounds, labelOffsetY: number) {
    if (!isVisible(remote.x, remote.y, 140, 140, bounds)) {
      const existing = this.nameLabels.get(remote.id);
      if (existing) existing.visible = false;
      const existingBar = this.nameHealthBars.get(remote.id);
      if (existingBar) existingBar.visible = false;
      return;
    }
    let label = this.nameLabels.get(remote.id);
    if (!label) {
      label = new Text({
        text: remote.name,
        style: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          fontWeight: 'bold',
          fill: nameColorForId(remote.id),
          stroke: { color: 0x0f172a, width: 3 },
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.nameLabelLayer.addChild(label);
      this.nameLabels.set(remote.id, label);
    } else if (label.text !== remote.name) {
      label.text = remote.name;
    }
    label.visible = true;
    label.position.set(remote.x, remote.y - labelOffsetY);

    // The Canvas renderer draws a health bar above every remote player's
    // name tag; this GPU path only ever drew the name.
    let bar = this.nameHealthBars.get(remote.id);
    if (!bar) {
      bar = new Graphics();
      this.nameLabelLayer.addChild(bar);
      this.nameHealthBars.set(remote.id, bar);
    }
    bar.visible = true;
    bar.position.set(remote.x - 20, remote.y - labelOffsetY + 4);
    bar.clear();
    bar.rect(0, 0, 40, 4).fill(0x334155);
    const health = Math.max(0, remote.condition);
    const healthColor = health > 50 ? 0x22c55e : health > 25 ? 0xeab308 : 0xef4444;
    bar.rect(0, 0, (40 * health) / 100, 4).fill(healthColor);
  }

  public releaseNameLabels(active: Set<string>) {
    for (const [id, label] of this.nameLabels) {
      if (active.has(id)) continue;
      this.nameLabels.delete(id);
      this.nameLabelLayer.removeChild(label);
      label.destroy();
    }
    for (const [id, bar] of this.nameHealthBars) {
      if (active.has(id)) continue;
      this.nameHealthBars.delete(id);
      this.nameLabelLayer.removeChild(bar);
      bar.destroy();
    }
  }

  /**
   * The Canvas renderer shows a speech bubble whenever a pedestrian has
   * reactive dialogue (ped.speechText) — this GPU path never read that
   * field at all, so pedestrian reactions were silently invisible.
   */
  public updateSpeechBubble(id: string, x: number, y: number, text: string) {
    let bubble = this.speechBubbles.get(id);
    if (!bubble) {
      const bg = new Graphics();
      const label = new Text({
        text,
        style: {
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontSize: 11,
          fontWeight: 'bold',
          fill: 0xf8fafc,
        },
        resolution: this.spriteResolution,
      });
      label.anchor.set(0.5, 1);
      this.speechLayer.addChild(bg, label);
      bubble = { bg, text: label };
      this.speechBubbles.set(id, bubble);
    } else if (bubble.text.text !== text) {
      bubble.text.text = text;
    }
    bubble.bg.visible = true;
    bubble.text.visible = true;
    const padX = 6;
    const boxH = 18;
    const boxW = bubble.text.width + padX * 2;
    bubble.text.position.set(x, y - 23);
    bubble.bg.clear();
    bubble.bg
      .roundRect(x - boxW / 2, y - 18 - boxH, boxW, boxH, 6)
      .fill({ color: 0x0f172a, alpha: 0.92 })
      .stroke({ color: 0x64748b, width: 1.5 });
  }

  public releaseSpeechBubbles(active: Set<string>) {
    for (const [id, bubble] of this.speechBubbles) {
      if (active.has(id)) continue;
      bubble.bg.visible = false;
      bubble.text.visible = false;
    }
  }

  public renderChatBubbles(
    playerVehicle: VehicleInstance | null,
    playerChar: PlayerCharacter,
    inVehicle: boolean,
    remotePlayers: RemotePlayer[],
    bounds: Bounds
  ) {
    const used = new Set<string>();
    const localId = getLocalChatPlayerId();
    if (localId) {
      if (inVehicle && playerVehicle) {
        const half = VEHICLE_CONFIGS[playerVehicle.type].width / 2;
        this.drawChatBubbleStack(localId, playerVehicle.x, playerVehicle.y - half - 10, used);
      } else {
        this.drawChatBubbleStack(localId, playerChar.x, playerChar.y - 28, used);
      }
    }
    for (const rp of remotePlayers) {
      if (!isVisible(rp.x, rp.y, 100, 100, bounds)) continue;
      const offset = rp.inVehicle ? (VEHICLE_CONFIGS[rp.vehicleType] || VEHICLE_CONFIGS.sedan).width / 2 + 22 : 28;
      this.drawChatBubbleStack(rp.id, rp.x, rp.y - offset, used);
    }
    for (const [key, view] of this.chatBubbleViews) {
      if (used.has(key)) continue;
      this.speechLayer.removeChild(view.bg, view.text);
      view.bg.destroy();
      view.text.destroy();
      this.chatBubbleViews.delete(key);
    }
  }

  /** Roblox-style white rounded bubbles stacked upward from (x, baseY). */
  public drawChatBubbleStack(id: string, x: number, baseY: number, used: Set<string>) {
    const list = getChatBubbles(id);
    let bottom = baseY - CHAT_BUBBLE_TAIL;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const key = `${id}|${b.key}`;
      used.add(key);
      let view = this.chatBubbleViews.get(key);
      if (!view) {
        const text = new Text({
          text: b.text,
          style: {
            fontFamily: '"Plus Jakarta Sans", sans-serif',
            fontSize: CHAT_BUBBLE_FONT_SIZE,
            fontWeight: 'bold',
            fill: 0x0f172a,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: CHAT_BUBBLE_MAX_WIDTH,
            breakWords: true,
          },
          resolution: this.spriteResolution,
        });
        text.anchor.set(0.5, 0);
        const bg = new Graphics();
        this.speechLayer.addChild(bg, text);
        view = { bg, text };
        this.chatBubbleViews.set(key, view);
      }
      const w = view.text.width + CHAT_BUBBLE_PAD_X * 2;
      const h = view.text.height + CHAT_BUBBLE_PAD_Y * 2;
      const top = bottom - h;
      view.bg.clear();
      view.bg.roundRect(x - w / 2, top, w, h, 9).fill({ color: 0xffffff, alpha: 0.96 }).stroke({ color: 0x0f172a, alpha: 0.35, width: 1 });
      if (i === list.length - 1) {
        view.bg.poly([x - 5, bottom - 0.5, x + 5, bottom - 0.5, x, bottom + CHAT_BUBBLE_TAIL]).fill({ color: 0xffffff, alpha: 0.96 });
      }
      view.text.position.set(x, top + CHAT_BUBBLE_PAD_Y);
      view.bg.alpha = b.alpha;
      view.text.alpha = b.alpha;
      bottom = top - CHAT_BUBBLE_GAP;
    }
  }

  public destroy() {
    for (const label of this.nameLabels.values()) label.destroy();
    this.nameLabels.clear();
  }
}
