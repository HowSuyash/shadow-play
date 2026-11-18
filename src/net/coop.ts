import { defaultRelayUrls, joinRoom, type Room } from 'trystero';
import { JOINT_COUNT, type HandData } from '../hands/handData.js';
import { POSES, type PoseId } from '../hands/poseDetector.js';

/**
 * Online two-player co-op without a game server.
 *
 * Trystero finds the other player through public Nostr relays (only to
 * exchange connection details), then everything flows over a direct WebRTC
 * data channel. The host's game is authoritative: the guest streams its
 * hands and *requests* actions; the host decides and broadcasts events that
 * both games then play out identically.
 */

export type CoopRole = 'host' | 'guest';

/** Game events broadcast by the host (and requests sent by the guest). */
export type CoopEvent =
  | { t: 'start' }
  | { t: 'summon'; pose: PoseId; x: number; y: number; duet: boolean }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'restart' }
  | { t: 'level'; i: number };

const APP_ID = 'shadow-play-quest-coop-v1';
/** Public relays used only for matchmaking; skip ones known to be down. */
const RELAYS = defaultRelayUrls.filter((u) => !u.includes('robosats'));
/** Hand packets per second. Remote hands are interpolated in between. */
const SEND_HZ = 20;
/** Packet: [flags, 75 left, 75 right, chargingPose, progress] */
const PACKET_LEN = 1 + JOINT_COUNT * 3 * 2 + 2;

/** A 4-digit room code that is easy to read out loud. */
export function makeRoomCode(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export class Coop {
  connected = false;
  /** Partner's latest pose charge (for the duet rule and the shared ring). */
  partnerCharging: PoseId | null = null;
  partnerProgress = 0;
  /** Called on the host for guest requests, and on the guest for host events. */
  onEvent: ((e: CoopEvent) => void) | undefined;
  /** Called whenever the connection status text should change. */
  onStatus: ((status: string) => void) | undefined;

  private readonly room: Room;
  private readonly sendHand: (data: Float32Array) => Promise<void>;
  private readonly sendEvt: (data: CoopEvent) => Promise<void>;
  private partnerId: string | undefined;
  private readonly out = new Float32Array(PACKET_LEN);
  /** Latest received joint targets; remote HandData eases toward these. */
  private readonly target = new Float32Array(JOINT_COUNT * 3 * 2);
  private targetFlags = 0;
  private sendAcc = 0;

  constructor(
    readonly role: CoopRole,
    readonly code: string,
    private readonly remoteLeft: HandData,
    private readonly remoteRight: HandData,
  ) {
    this.room = joinRoom({ appId: APP_ID, relayConfig: { urls: RELAYS } }, `room-${code}`, {
      onJoinError: (d) => this.onStatus?.(`could not join room ${code}: ${d.error}`),
    });

    const hand = this.room.makeAction<Float32Array>('hand');
    this.sendHand = (d) => hand.send(d, this.partnerId ? { target: this.partnerId } : undefined);
    hand.onMessage = (data, ctx) => {
      if (ctx.peerId !== this.partnerId) return;
      const arr = data instanceof Float32Array ? data : new Float32Array((data as ArrayBufferView).buffer);
      if (arr.length !== PACKET_LEN) return;
      this.targetFlags = arr[0];
      this.target.set(arr.subarray(1, 1 + this.target.length));
      const p = arr[PACKET_LEN - 2];
      this.partnerCharging = p >= 0 ? POSES[p] : null;
      this.partnerProgress = arr[PACKET_LEN - 1];
    };

    const evt = this.room.makeAction<CoopEvent>('evt');
    this.sendEvt = (d) => evt.send(d, this.partnerId ? { target: this.partnerId } : undefined);
    evt.onMessage = (data, ctx) => {
      if (ctx.peerId === this.partnerId) this.onEvent?.(data);
    };

    this.room.onPeerJoin = (peerId) => {
      if (this.partnerId) return; // two players per room
      this.partnerId = peerId;
      this.connected = true;
      this.onStatus?.('partner connected');
    };
    this.room.onPeerLeave = (peerId) => {
      if (peerId !== this.partnerId) return;
      this.partnerId = undefined;
      this.connected = false;
      this.partnerCharging = null;
      this.partnerProgress = 0;
      this.remoteLeft.lost();
      this.remoteRight.lost();
      this.onStatus?.('partner left · playing on');
    };
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Host: broadcast an event. Guest: ask the host to do something. */
  send(e: CoopEvent): void {
    if (this.connected) void this.sendEvt(e);
  }

  /**
   * Stream our hands (throttled) and ease the partner's hands toward their
   * latest packet. Call once per frame.
   */
  update(dt: number, left: HandData, right: HandData, charging: PoseId | null, progress: number): void {
    if (!this.connected) return;
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_HZ) {
      this.sendAcc = 0;
      const o = this.out;
      o[0] = (left.tracked ? 1 : 0) | (right.tracked ? 2 : 0);
      for (let j = 0; j < JOINT_COUNT; j++) {
        const l = left.joints[j];
        const r = right.joints[j];
        const a = 1 + j * 3;
        const b = a + JOINT_COUNT * 3;
        o[a] = l.x;
        o[a + 1] = l.y;
        o[a + 2] = l.z;
        o[b] = r.x;
        o[b + 1] = r.y;
        o[b + 2] = r.z;
      }
      o[PACKET_LEN - 2] = charging ? POSES.indexOf(charging) : -1;
      o[PACKET_LEN - 1] = progress;
      void this.sendHand(o);
    }
    // Smoothly follow the 20 Hz stream at render rate.
    const k = Math.min(1, dt * 14);
    this.follow(this.remoteLeft, 0, (this.targetFlags & 1) !== 0, k);
    this.follow(this.remoteRight, JOINT_COUNT * 3, (this.targetFlags & 2) !== 0, k);
  }

  private follow(hand: HandData, offset: number, tracked: boolean, k: number): void {
    if (!tracked) {
      hand.tracked = false;
      return;
    }
    const snap = !hand.tracked;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const t = this.target;
      const o = offset + j * 3;
      const p = hand.joints[j];
      if (snap) p.set(t[o], t[o + 1], t[o + 2]);
      else p.set(p.x + (t[o] - p.x) * k, p.y + (t[o + 1] - p.y) * k, p.z + (t[o + 2] - p.z) * k);
    }
    hand.tracked = true;
  }

  leave(): void {
    void this.room.leave();
  }
}
