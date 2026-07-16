export type GridSize = 3 | 5 | 7;

export type MissionType = "normal" | "emergency" | "center";

export type GameStatus = "waiting" | "playing" | "paused" | "finished";

export type CsvMission = {
  type: "normal" | "emergency";
  content: string;
};

export type BingoCell = {
  id: number;
  row: number;
  col: number;
  type: MissionType;
  content: string;
  revealed: boolean;
  completed: boolean;
  completedAt: number | null;
};

export type EmergencySettings = {
  centerRevealAfterSeconds: number;
  revealEveryMinutes: number;
  revealPerStepClear: number;
};

export type BingoRoom = {
  title: string;
  gridSize: GridSize;
  status: GameStatus;
  createdAt: number;
  startedAt: number | null;
  pausedAt: number | null;
  totalPausedMilliseconds: number;
  finishedAt: number | null;
  timeLimitMinutes: number;
  normalCount: number;
  emergencyCount: number;
  centerMission: string;
  emergencySettings: EmergencySettings;
  cells: BingoCell[];
};

export const DEFAULT_EMERGENCY_SETTINGS: EmergencySettings = {
  centerRevealAfterSeconds: 30,
  revealEveryMinutes: 60,
  revealPerStepClear: 1,
};

export const DEFAULT_COUNTS: Record<
  GridSize,
  { normal: number; emergency: number }
> = {
  3: { normal: 5, emergency: 4 },
  5: { normal: 15, emergency: 10 },
  7: { normal: 29, emergency: 20 },
};

export function shuffle<T>(items: T[]): T[] {
  return [...items]
    .map((item) => ({ item, random: Math.random() }))
    .sort((a, b) => a.random - b.random)
    .map(({ item }) => item);
}

export function removeDuplicateMissions(
  missions: CsvMission[],
): CsvMission[] {
  const seen = new Set<string>();

  return missions.filter((mission) => {
    const normalizedContent = mission.content
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();

    const key = `${mission.type}:${normalizedContent}`;

    if (!normalizedContent || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function parseMissionCsv(csv: string): CsvMission[] {
  const rows = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [type, ...contentParts] = line.split(",");

      return {
        type: type?.trim() as "normal" | "emergency",
        content: contentParts.join(",").trim(),
      };
    })
    .filter(
      (mission): mission is CsvMission =>
        (mission.type === "normal" || mission.type === "emergency") &&
        mission.content.length > 0,
    );

  return removeDuplicateMissions(rows);
}

export function getCenterIndex(gridSize: GridSize): number {
  const center = Math.floor(gridSize / 2);
  return center * gridSize + center;
}

export function getBingoLineIndexes(gridSize: GridSize): number[][] {
  const lines: number[][] = [];

  for (let row = 0; row < gridSize; row += 1) {
    lines.push(
      Array.from(
        { length: gridSize },
        (_, col) => row * gridSize + col,
      ),
    );
  }

  for (let col = 0; col < gridSize; col += 1) {
    lines.push(
      Array.from(
        { length: gridSize },
        (_, row) => row * gridSize + col,
      ),
    );
  }

  lines.push(
    Array.from(
      { length: gridSize },
      (_, index) => index * (gridSize + 1),
    ),
  );

  lines.push(
    Array.from(
      { length: gridSize },
      (_, index) => (index + 1) * (gridSize - 1),
    ),
  );

  return lines;
}

export function getCompletedBingoLines(cells: BingoCell[]): number[][] {
  const gridSize = Math.sqrt(cells.length) as GridSize;

  if (![3, 5, 7].includes(gridSize)) {
    return [];
  }

  return getBingoLineIndexes(gridSize).filter((line) =>
    line.every((id) => cells[id]?.completed === true),
  );
}

export function getScore(cells: BingoCell[]): number {
  const completedCellScore = cells.reduce((total, cell) => {
    if (!cell.completed) {
      return total;
    }

    return total + (cell.type === "center" ? 4 : 2);
  }, 0);

  return completedCellScore + getCompletedBingoLines(cells).length * 4;
}

export function getMaximumScore(gridSize: GridSize): number {
  const totalCells = gridSize * gridSize;
  const totalBingoLines = gridSize * 2 + 2;

  return (totalCells - 1) * 2 + 4 + totalBingoLines * 4;
}

export function createBingoCells({
  gridSize,
  missions,
  normalCount,
  emergencyCount,
  centerMission,
}: {
  gridSize: GridSize;
  missions: CsvMission[];
  normalCount: number;
  emergencyCount: number;
  centerMission: string;
}): BingoCell[] {
  const totalCells = gridSize * gridSize;

  if (normalCount + emergencyCount !== totalCells) {
    throw new Error(
      `通常${normalCount}件 + 緊急${emergencyCount}件 = ${normalCount + emergencyCount}件です。${gridSize}×${gridSize}では合計${totalCells}件にしてください。`,
    );
  }

  if (emergencyCount < 1) {
    throw new Error("緊急ミッションは中央マスを含むため、1件以上必要です。");
  }

  const uniqueMissions = removeDuplicateMissions(missions);

  const normalCandidates = uniqueMissions.filter(
    (mission) => mission.type === "normal",
  );

  const emergencyCandidates = uniqueMissions.filter(
    (mission) => mission.type === "emergency",
  );

  const neededEmergencyOutsideCenter = emergencyCount - 1;

  if (normalCandidates.length < normalCount) {
    throw new Error(
      `通常ミッションが不足しています。${normalCount}件必要ですが、重複を除くと${normalCandidates.length}件です。`,
    );
  }

  if (emergencyCandidates.length < neededEmergencyOutsideCenter) {
    throw new Error(
      `緊急ミッションが不足しています。中央以外に${neededEmergencyOutsideCenter}件必要ですが、重複を除くと${emergencyCandidates.length}件です。`,
    );
  }

  const selectedNormal = shuffle(normalCandidates).slice(0, normalCount);
  const selectedEmergency = shuffle(emergencyCandidates).slice(
    0,
    neededEmergencyOutsideCenter,
  );

  const nonCenterMissions = shuffle([
    ...selectedNormal,
    ...selectedEmergency,
  ]);

  const centerIndex = getCenterIndex(gridSize);
  let missionIndex = 0;

  return Array.from({ length: totalCells }, (_, id): BingoCell => {
    const row = Math.floor(id / gridSize);
    const col = id % gridSize;

    if (id === centerIndex) {
      return {
        id,
        row,
        col,
        type: "center",
        content: centerMission.trim() || "全員で写真を撮る",
        revealed: false,
        completed: false,
        completedAt: null,
      };
    }

    const mission = nonCenterMissions[missionIndex];

    if (!mission) {
      throw new Error(`マス ${id + 1} のミッションを作成できませんでした。`);
    }

    missionIndex += 1;

    return {
      id,
      row,
      col,
      type: mission.type,
      content: mission.content,
      revealed: mission.type === "normal",
      completed: false,
      completedAt: null,
    };
  });
}

export function createNewRoom({
  title,
  gridSize,
  missions,
  normalCount,
  emergencyCount,
  centerMission,
  timeLimitMinutes,
}: {
  title: string;
  gridSize: GridSize;
  missions: CsvMission[];
  normalCount: number;
  emergencyCount: number;
  centerMission: string;
  timeLimitMinutes: number;
}): BingoRoom {
  return {
    title: title.trim() || "みんなで謎解きビンゴ",
    gridSize,
    status: "waiting",
    createdAt: Date.now(),
    startedAt: null,
    pausedAt: null,
    totalPausedMilliseconds: 0,
    finishedAt: null,
    timeLimitMinutes,
    normalCount,
    emergencyCount,
    centerMission: centerMission.trim() || "全員で写真を撮る",
    emergencySettings: DEFAULT_EMERGENCY_SETTINGS,
    cells: createBingoCells({
      gridSize,
      missions,
      normalCount,
      emergencyCount,
      centerMission,
    }),
  };
}

export function getElapsedPlayingMilliseconds(
  room: Pick<
    BingoRoom,
    "startedAt" | "status" | "pausedAt" | "totalPausedMilliseconds"
  >,
  now = Date.now(),
): number {
  if (!room.startedAt) {
    return 0;
  }

  const currentPauseMilliseconds =
    room.status === "paused" && room.pausedAt
      ? now - room.pausedAt
      : 0;

  return Math.max(
    0,
    now -
      room.startedAt -
      room.totalPausedMilliseconds -
      currentPauseMilliseconds,
  );
}