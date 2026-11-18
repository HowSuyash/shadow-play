import { makeRoomCode, type CoopRole } from '../net/coop.js';

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

    $('play-solo').onclick = () => h.onEnter();
    $('play-coop').onclick = () => show('lobby-coop');
    $('coop-back').onclick = () => show('lobby-main');

    $('coop-host').onclick = () => {
      const code = makeRoomCode();
      $('host-code').textContent = code;
      show('lobby-host');
      this.startCoop('host', code);
      this.setStatus('waiting for your partner… you can enter VR now');
    };
    $('host-enter').onclick = () => h.onEnter();

    // Join: an on-screen keypad, since there's no keyboard in a headset.
    const keypad = $('keypad');
    const joinBtn = $('join-enter') as HTMLButtonElement;
    const render = () => {
      $('join-code').textContent = this.code.padEnd(4, '·');
      joinBtn.disabled = this.code.length !== 4;
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']) {
      const b = document.createElement('button');
      b.className = k === '✓' ? 'btn' : 'btn ghost';
      b.textContent = k;
      b.onclick = () => {
        if (k === '⌫') this.code = this.code.slice(0, -1);
        else if (k === '✓') joinBtn.click();
        else if (this.code.length < 4) this.code += k;
        render();
      };
      keypad.appendChild(b);
    }
    $('coop-join').onclick = () => {
      show('lobby-join');
      render();
    };
    joinBtn.onclick = () => {
      if (this.code.length !== 4) return;
      this.startCoop('guest', this.code);
      h.onEnter();
    };

    const fromLink = new URLSearchParams(location.search).get('room');
    if (fromLink && /^\d{4}$/.test(fromLink)) {
      this.code = fromLink;
      show('lobby-join');
      render();
    }
  }

  private startCoop(role: CoopRole, code: string): void {
    if (this.coopChosen) return;
    this.coopChosen = true;
    this.h.onCoop(role, code);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setVisible(v: boolean): void {
    this.el.hidden = !v;
  }
}
