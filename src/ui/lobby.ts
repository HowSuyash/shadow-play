import { makeRoomCode, ROOM_CODE_LENGTH, type CoopRole } from '../net/coop.js';

export interface LobbyHandlers {
  /** Create the co-op connection as soon as a room is chosen (it connects while the player puts the headset on). */
  onCoop(role: CoopRole, code: string): void;
  /** Enter the immersive session. */
  onEnter(): void;
}

/**
 * The 2D landing page: Play (solo) or Play together → Host / Join.
 * Big buttons work with a hand pinch in the Quest Browser, so even the
 * lobby needs no controller. A `?room=1234` link pre-fills Join.
 */
export class Lobby {
  private readonly el = document.getElementById('lobby') as HTMLDivElement;
  private readonly status = document.getElementById('lobby-status') as HTMLDivElement;
  private code = '';
  private coopChosen = false;

  constructor(private readonly h: LobbyHandlers) {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    const show = (id: string) => {
      for (const p of ['lobby-main', 'lobby-coop', 'lobby-host', 'lobby-join']) $(p).hidden = p !== id;
    };

    $('play-solo').onclick = () => {
      this.setStatus('Starting VR…');
      h.onEnter();
    };
    $('play-coop').onclick = () => show('lobby-coop');
    $('coop-back').onclick = () => show('lobby-main');

    $('coop-host').onclick = () => {
      const code = makeRoomCode();
      $('host-code').textContent = code;
      show('lobby-host');
      this.startCoop('host', code);
      this.setStatus('waiting for your partner… you can enter VR now');
    };
    $('host-copy').onclick = () => {
      const link = `${location.origin}${location.pathname}?room=${$('host-code').textContent}`;
      const done = () => this.setStatus(`invite link copied: ${link}`);
      navigator.clipboard?.writeText(link).then(done, () => this.setStatus(`share this link: ${link}`)) ?? this.setStatus(`share this link: ${link}`);
    };
    $('host-enter').onclick = () => h.onEnter();

    // Join: an on-screen keypad, since there's no keyboard in a headset.
    const keypad = $('keypad');
    const joinBtn = $('join-enter') as HTMLButtonElement;
    const render = () => {
      $('join-code').textContent = this.code.padEnd(ROOM_CODE_LENGTH, '·');
      joinBtn.disabled = this.code.length !== ROOM_CODE_LENGTH;
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']) {
      const b = document.createElement('button');
      b.className = k === '✓' ? 'btn' : 'btn ghost';
      b.textContent = k;
      b.onclick = () => {
        if (k === '⌫') this.code = this.code.slice(0, -1);
        else if (k === '✓') joinBtn.click();
        else if (this.code.length < ROOM_CODE_LENGTH) this.code += k;
        render();
      };
      keypad.appendChild(b);
    }
    $('coop-join').onclick = () => {
      show('lobby-join');
      render();
    };
    joinBtn.onclick = () => {
      if (this.code.length !== ROOM_CODE_LENGTH) return;
      this.startCoop('guest', this.code);
      h.onEnter();
    };

    const fromLink = new URLSearchParams(location.search).get('room');
    if (fromLink && fromLink.length === ROOM_CODE_LENGTH && /^\d+$/.test(fromLink)) {
      this.code = fromLink;
      show('lobby-join');
      render();
    }
  }

  private startCoop(role: CoopRole, code: string): void {
    if (this.coopChosen) return;
    this.coopChosen = true;
    this.role = role;
    this.h.onCoop(role, code);
    this.setPartner(false);
  }

  private role: CoopRole = 'host';

  /** Player slots: who's in the room (shown once a room is chosen). */
  setPartner(connected: boolean): void {
    const slots = document.getElementById('lobby-slots') as HTMLElement;
    const me = this.role === 'host' ? 'Player 1 · host · you' : 'Player 2 · you';
    const them = this.role === 'host' ? 'Player 2' : 'Player 1 · host';
    slots.innerHTML = `<span class="slot on">● ${me}</span><span class="slot${connected ? ' on' : ''}">${connected ? '●' : '○'} ${them}${connected ? ' · connected' : ' · waiting…'}</span>`;
    slots.hidden = false;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setVisible(v: boolean): void {
    this.el.hidden = !v;
  }

  /**
   * No VR headset in this browser: "Play" starts a keyboard demo instead of
   * silently failing, and the page says where the real game is played.
   */
  setDesktopMode(onPlayHere: () => void): void {
    const play = document.getElementById('play-solo') as HTMLButtonElement;
    play.textContent = 'Try it here';
    play.onclick = onPlayHere;
    (document.getElementById('play-coop') as HTMLElement).hidden = true;
    this.setStatus('Open this page in the Meta Quest Browser to play with your hands.');
  }

  /** VR didn't start: say so, keep Play for a retry, and offer the on-screen game. */
  showScreenFallback(onPlayHere: () => void, reason: string): void {
    for (const p of ['lobby-coop', 'lobby-host', 'lobby-join']) (document.getElementById(p) as HTMLElement).hidden = true;
    (document.getElementById('lobby-main') as HTMLElement).hidden = false;
    const screen = document.getElementById('play-screen') as HTMLButtonElement;
    screen.hidden = false;
    screen.onclick = onPlayHere;
    this.setStatus(reason);
  }
}
