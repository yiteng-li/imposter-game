export type Player = { id: string; name: string; score: number };

export type WordPack = { id: string; name: string; words: string[] };

export type RoundSetup = {
  word: string;
  imposterIds: string[];
  order: string[];
};

export type Phase = 'setup' | 'reveal' | 'clueRound' | 'voting' | 'results';
