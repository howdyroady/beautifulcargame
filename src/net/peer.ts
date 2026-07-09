import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function randomCode(len = 4): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

const ROOM_PREFIX = 'roadragederby-';

export type NetRole = 'host' | 'client';

export interface NetSessionCallbacks {
  onStatus?: (text: string) => void;
  onConnected?: () => void;
  onData?: (data: unknown) => void;
  onDisconnected?: () => void;
}

export class NetSession {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  role: NetRole | null = null;
  private callbacks: NetSessionCallbacks;

  constructor(callbacks: NetSessionCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async host(): Promise<string> {
    this.role = 'host';
    const code = randomCode();
    this.callbacks.onStatus?.('Verbinde mit Signaling-Server...');
    const { default: Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = new Peer(ROOM_PREFIX + code);
      this.peer = peer;
      peer.on('open', () => {
        this.callbacks.onStatus?.('Warte auf Mitspieler...');
        resolve(code);
      });
      peer.on('connection', (conn) => {
        this.conn = conn;
        this.wireConnection(conn);
      });
      peer.on('error', (err) => {
        this.callbacks.onStatus?.(`Verbindungsfehler: ${err.type}`);
        reject(err);
      });
    });
  }

  async join(code: string): Promise<void> {
    this.role = 'client';
    this.callbacks.onStatus?.('Verbinde mit Signaling-Server...');
    const { default: Peer } = await import('peerjs');
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      peer.on('open', () => {
        this.callbacks.onStatus?.('Verbinde mit Host...');
        const conn = peer.connect(ROOM_PREFIX + code.toUpperCase(), { reliable: false });
        this.conn = conn;
        conn.on('open', () => {
          this.wireConnection(conn);
          resolve();
        });
        conn.on('error', (err) => {
          this.callbacks.onStatus?.('Host nicht gefunden.');
          reject(err);
        });
      });
      peer.on('error', (err) => {
        this.callbacks.onStatus?.(`Verbindungsfehler: ${err.type}`);
        reject(err);
      });
    });
  }

  private wireConnection(conn: DataConnection) {
    conn.on('data', (data) => this.callbacks.onData?.(data));
    conn.on('close', () => this.callbacks.onDisconnected?.());
    conn.on('open', () => this.callbacks.onConnected?.());
    if (conn.open) this.callbacks.onConnected?.();
  }

  send(data: unknown) {
    if (this.conn?.open) this.conn.send(data);
  }

  close() {
    this.conn?.close();
    this.peer?.destroy();
  }
}
