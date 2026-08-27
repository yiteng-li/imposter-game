export type Player = { id: string; name: string; score: number };

export type WordPack = { id: string; name: string; words: string[] };

export type RoundSetup = {
  word: string;
  imposterIds: string[];
  order: string[];
};

export type Phase = 'setup' | 'reveal' | 'clueRound' | 'voting' | 'results';

export type Room = {
  id: string;
  code: string;
  hostId: string;
  phase: Phase;
  packId: string | null;
  imposterCount: number;
  roundNumber: number;
  roundScored: boolean;
  turnOrder: string[];
  turnIndex: number;
};

export type Assignment = {
  roomId: string;
  roundNumber: number;
  playerId: string;
  isImposter: boolean;
  word: string | null;
  ready: boolean;
};

export type Vote = {
  roomId: string;
  roundNumber: number;
  voterId: string;
  targetId: string;
};
