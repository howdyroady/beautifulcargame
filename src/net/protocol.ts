import type { CarInput } from '../input/input';
import type { MatchPhase } from '../game/matchState';
import type { HazardType } from '../arena/arena';

export interface InputMessage {
  t: 'input';
  input: CarInput;
}

export interface CarSnapshot {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  hp: number;
  speed: number;
  shielded: boolean;
  ramActive: boolean;
  nitroActive: boolean;
  empActive: boolean;
}

export interface HazardSnapshot {
  type: HazardType;
  x: number;
  z: number;
  radius: number;
}

export interface PowerupSnapshot {
  id: number;
  type: 'nitro' | 'shield' | 'emp' | 'ram';
  x: number;
  z: number;
}

export interface StateMessage {
  t: 'state';
  phase: MatchPhase;
  countdown: number;
  winner?: number;
  score: [number, number];
  arenaRadius: number;
  hazards: HazardSnapshot[];
  powerups: PowerupSnapshot[];
  cars: [CarSnapshot, CarSnapshot];
}

export interface RaceStateMessage {
  t: 'race-state';
  phase: 'countdown' | 'racing' | 'finished';
  countdown: number;
  winner?: number;
  trackId: string;
  time: number;
  laps: [number, number];
  places: [number, number];
  nitro: [number, number];
  cars: [CarSnapshot, CarSnapshot];
}

export type NetMessage = InputMessage | StateMessage | RaceStateMessage;
