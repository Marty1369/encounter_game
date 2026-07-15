// Mock data for the Encounter-style city game prototype.
// Replace these with data fetched from Google Apps Script later.

export type BlockType = "text" | "image" | "audio" | "video" | "link";

export interface ContentBlock {
  type: BlockType;
  text?: string;
  url?: string;
  caption?: string;
}

export interface Player {
  nickname: string;
  status: "online" | "offline";
}

export interface Team {
  teamId: string;
  teamName: string;
  players: Player[];
  currentTask: number;
  score: number;
}

export interface Hint {
  hintId: string;
  title: string;
  status: "available" | "locked" | "used";
  penalty: number;
  unlockText?: string;
  blocks: ContentBlock[];
}

export interface Task {
  taskId: string;
  title: string;
  taskNumber: number;
  totalTasks: number;
  requiresLocation: boolean;
  blocks: ContentBlock[];
  hints: Hint[];
}

export interface LeaderboardRow {
  rank: number;
  teamName: string;
  completedTasks: number;
  score: number;
  lastTaskTime: string;
}

export interface GameState {
  gameName: string;
  gameStatus: "draft" | "lobby" | "active" | "paused" | "finished";
  currentPlayer: Player;
  currentTeam: Team;
  currentTask: Task;
  leaderboard: LeaderboardRow[];
  otherTeamsCount: number;
}

export const mockTask: Task = {
  taskId: "t-2",
  title: "The Clockwork Courtyard",
  taskNumber: 2,
  totalTasks: 8,
  requiresLocation: true,
  blocks: [
    {
      type: "text",
      text: "Find the courtyard where four bronze gears once turned the city's first public clock. Look up — the answer is carved into the keystone above the eastern arch.",
    },
    {
      type: "image",
      url: "https://images.unsplash.com/photo-1519121785383-3229633bb75b?w=1200&q=80",
      caption: "Reference photo of the eastern arch.",
    },
    {
      type: "audio",
      url: "https://www.soundjay.com/buttons/sounds/beep-07a.mp3",
    },
    {
      type: "link",
      text: "Open in maps",
      url: "https://maps.google.com",
    },
  ],
  hints: [
    {
      hintId: "h1",
      title: "Hint 1 — The Neighborhood",
      status: "used",
      penalty: 10,
      blocks: [
        { type: "text", text: "The courtyard is in the old town quarter, near the river bend." },
      ],
    },
    {
      hintId: "h2",
      title: "Hint 2 — The Arch",
      status: "available",
      penalty: 25,
      blocks: [
        { type: "text", text: "Look for an arch flanked by two stone lions." },
        {
          type: "image",
          url: "https://images.unsplash.com/photo-1473177104440-ffee2f376098?w=800&q=80",
          caption: "Stone lion detail",
        },
      ],
    },
    {
      hintId: "h3",
      title: "Hint 3 — The Answer Shape",
      status: "locked",
      penalty: 50,
      unlockText: "Available in 8 min",
      blocks: [{ type: "text", text: "(Locked) The answer is a four-digit year." }],
    },
  ],
};

export const mockTeam: Team = {
  teamId: "team-azure",
  teamName: "Azure Foxes",
  players: [
    { nickname: "Mira", status: "online" },
    { nickname: "Jonas", status: "online" },
    { nickname: "Pavel", status: "online" },
    { nickname: "Lin", status: "offline" },
  ],
  currentTask: 2,
  score: 240,
};

export const mockLeaderboard: LeaderboardRow[] = [
  { rank: 1, teamName: "Night Owls", completedTasks: 4, score: 410, lastTaskTime: "12 min ago" },
  { rank: 2, teamName: "Azure Foxes", completedTasks: 3, score: 340, lastTaskTime: "4 min ago" },
  { rank: 3, teamName: "Iron Wolves", completedTasks: 3, score: 305, lastTaskTime: "9 min ago" },
  { rank: 4, teamName: "Crimson Hawks", completedTasks: 2, score: 220, lastTaskTime: "21 min ago" },
  { rank: 5, teamName: "Silver Hares", completedTasks: 2, score: 180, lastTaskTime: "30 min ago" },
];

export const mockGameState: GameState = {
  gameName: "Night Quest: Riverside",
  gameStatus: "active",
  currentPlayer: { nickname: "Mira", status: "online" },
  currentTeam: mockTeam,
  currentTask: mockTask,
  leaderboard: mockLeaderboard,
  otherTeamsCount: 6,
};

export const mockAdminTeams: Team[] = [
  { ...mockTeam },
  {
    teamId: "team-owls",
    teamName: "Night Owls",
    players: [
      { nickname: "Eli", status: "online" },
      { nickname: "Sasha", status: "online" },
      { nickname: "Tomi", status: "online" },
    ],
    currentTask: 5,
    score: 410,
  },
  {
    teamId: "team-wolves",
    teamName: "Iron Wolves",
    players: [
      { nickname: "Rex", status: "online" },
      { nickname: "Nora", status: "offline" },
    ],
    currentTask: 4,
    score: 305,
  },
  {
    teamId: "team-hawks",
    teamName: "Crimson Hawks",
    players: [
      { nickname: "Ana", status: "online" },
      { nickname: "Yuki", status: "online" },
    ],
    currentTask: 3,
    score: 220,
  },
];
