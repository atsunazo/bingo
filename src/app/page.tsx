"use client";

import { useEffect, useMemo, useState } from "react";

type MissionType = "normal" | "emergency" | "center";
type GameStatus = "waiting" | "playing" | "finished";

type Cell = {
  id: number;
  row: number;
  col: number;
  type: MissionType;
  content: string;
  revealed: boolean;
  completed: boolean;
};

type CsvMission = {
  type: "normal" | "emergency";
  content: string;
};

const GRID_SIZE = 5;
const CENTER_INDEX = 12;
const CENTER_MISSION = "全員で写真を撮る";

function shuffle<T>(items: T[]): T[] {
  return [...items]
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function createCells(missions: CsvMission[]): Cell[] {
  const normalCandidates = missions.filter(
    (mission) => mission.type === "normal",
  );

  const emergencyCandidates = missions.filter(
    (mission) => mission.type === "emergency",
  );

  if (normalCandidates.length < 15) {
    throw new Error(
      `通常ミッションが不足しています。15件必要ですが、${normalCandidates.length}件です。`,
    );
  }

  if (emergencyCandidates.length < 9) {
    throw new Error(
      `緊急ミッションが不足しています。9件必要ですが、${emergencyCandidates.length}件です。`,
    );
  }

  const selectedNormal = shuffle(normalCandidates).slice(0, 15);
  const selectedEmergency = shuffle(emergencyCandidates).slice(0, 9);

  const nonCenterMissions = shuffle([
    ...selectedNormal,
    ...selectedEmergency,
  ]);

  if (nonCenterMissions.length !== 24) {
    throw new Error(
      `盤面に必要なミッション数が不正です。24件必要ですが、${nonCenterMissions.length}件です。`,
    );
  }

  let missionIndex = 0;

  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, id): Cell => {
    const row = Math.floor(id / GRID_SIZE);
    const col = id % GRID_SIZE;

    if (id === CENTER_INDEX) {
      return {
        id,
        row,
        col,
        type: "center",
        content: CENTER_MISSION,
        revealed: false,
        completed: false,
      };
    }

    const mission = nonCenterMissions[missionIndex];

    if (!mission) {
      throw new Error(
        `マス ${id + 1} に配置するミッションがありません。`,
      );
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
    };
  });
}

function getBingoLines(cells: Cell[]): number[][] {
  if (cells.length !== GRID_SIZE * GRID_SIZE) {
    return [];
  }

  const lines: number[][] = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    lines.push(
      Array.from({ length: GRID_SIZE }, (_, col) => row * GRID_SIZE + col),
    );
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    lines.push(
      Array.from({ length: GRID_SIZE }, (_, row) => row * GRID_SIZE + col),
    );
  }

  lines.push(Array.from({ length: GRID_SIZE }, (_, index) => index * 6));

  lines.push(
    Array.from({ length: GRID_SIZE }, (_, index) => (index + 1) * 4),
  );

  return lines.filter((line) =>
    line.every((id) => cells[id]?.completed === true),
  );
}

function getMissionLabel(type: MissionType) {
  if (type === "normal") {
    return "通常ミッション";
  }

  if (type === "center") {
    return "中央ミッション";
  }

  return "緊急ミッション";
}

export default function Home() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [status, setStatus] = useState<GameStatus>("waiting");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [showProgressMenu, setShowProgressMenu] = useState(false);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    async function loadMissions() {
      try {
        const response = await fetch("/mission.csv");

        if (!response.ok) {
          throw new Error(
            `mission.csv を読み込めませんでした（${response.status}）`,
          );
        }

        const csv = await response.text();

        const missions = csv
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
              (mission.type === "normal" ||
                mission.type === "emergency") &&
              mission.content.length > 0,
          );

        setCells(createCells(missions));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "ミッションの読み込み中に予期しないエラーが起きました。";

        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    }

    loadMissions();
  }, []);

  useEffect(() => {
    if (status !== "playing") {
      return;
    }

    const timer = window.setTimeout(() => {
      setCells((currentCells) =>
        currentCells.map((cell) =>
          cell.type === "center" ? { ...cell, revealed: true } : cell,
        ),
      );

      setNotice("緊急ミッション発表！ 中央マスが開放されました");
    }, 30000);

    return () => window.clearTimeout(timer);
  }, [status]);

  const bingoLines = useMemo(() => getBingoLines(cells), [cells]);

  const score = useMemo(() => {
    const cellScore = cells.reduce((total, cell) => {
      if (!cell.completed) {
        return total;
      }

      return total + (cell.type === "center" ? 4 : 2);
    }, 0);

    return cellScore + bingoLines.length * 4;
  }, [cells, bingoLines]);

  const bingoCellIds = useMemo(
    () => new Set(bingoLines.flat()),
    [bingoLines],
  );

  function openMissionConfirmation(id: number) {
    if (status !== "playing") {
      return;
    }

    const targetCell = cells.find((cell) => cell.id === id);

    if (!targetCell || !targetCell.revealed) {
      return;
    }

    setSelectedCell(targetCell);
  }

  function confirmCellCompletion() {
    if (!selectedCell) {
      return;
    }

    const wasCompleted = selectedCell.completed;

    setCells((currentCells) =>
      currentCells.map((cell) => {
        if (cell.id !== selectedCell.id) {
          return cell;
        }

        return {
          ...cell,
          completed: !cell.completed,
        };
      }),
    );

    setNotice(
      wasCompleted
        ? "ミッションの達成を取り消しました"
        : "ミッションを達成にしました！",
    );

    setSelectedCell(null);
  }

  function startGame() {
    const accepted = window.confirm("スタートしていいですか？");

    if (!accepted) {
      return;
    }

    setStatus("playing");
    setNotice("ゲームスタート！ 中央ミッションは30秒後に発表されます");
  }

  function revealEmergency(count: number) {
    let revealedCount = 0;

    setCells((currentCells) =>
      currentCells.map((cell) => {
        if (
          cell.type === "emergency" &&
          !cell.revealed &&
          revealedCount < count
        ) {
          revealedCount += 1;

          return {
            ...cell,
            revealed: true,
          };
        }

        return cell;
      }),
    );

    if (count >= 99) {
      setNotice("ラストステップ！ 残りの緊急ミッションをすべて発表しました！");
    } else {
      setNotice(`緊急ミッションを${revealedCount}件発表しました！`);
    }

    setShowProgressMenu(false);
  }

  function finishGame() {
    const accepted = window.confirm(
      "ゲームを終了しますか？ 終了後はマスを変更できません。",
    );

    if (!accepted) {
      return;
    }

    setStatus("finished");
    setShowProgressMenu(false);
    setSelectedCell(null);
    setNotice("ゲーム終了！ おつかれさまでした");
  }

  if (loading) {
    return <main className="loading">ビンゴを準備しています…</main>;
  }

  if (errorMessage) {
    return (
      <main className="app-shell">
        <section className="game-card">
          <h1>読み込みエラー</h1>

          <p className="notice">{errorMessage}</p>

          <p className="help-text">
            <code>public/mission.csv</code> の場所、1行目の見出し、
            通常15件以上・緊急9件以上あるかを確認してください。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="game-card">
        <header className="game-header">
          <div>
            <p className="eyebrow">みんなで協力する謎解き周遊</p>
            <h1>TOUR BINGO</h1>
          </div>

          <span className={`status-badge ${status}`}>
            {status === "waiting" && "開始前"}
            {status === "playing" && "プレイ中"}
            {status === "finished" && "終了"}
          </span>
        </header>

        <section className="score-board" aria-label="現在の成績">
          <div>
            <span>現在の得点</span>
            <strong>
              {score}
              <small>点</small>
            </strong>
          </div>

          <div>
            <span>ビンゴ</span>
            <strong>
              {bingoLines.length}
              <small>列</small>
            </strong>
          </div>

          <div>
            <span>達成マス</span>
            <strong>
              {cells.filter((cell) => cell.completed).length}
              <small>/25</small>
            </strong>
          </div>
        </section>

        {notice && <p className="notice">{notice}</p>}

        <section className="bingo-grid" aria-label="ビンゴ盤">
          {cells.map((cell) => {
            const isBingoCell = bingoCellIds.has(cell.id);
            const isHidden = !cell.revealed;

            return (
              <button
                className={[
                  "bingo-cell",
                  cell.type,
                  cell.completed ? "completed" : "",
                  isHidden ? "hidden" : "",
                  isBingoCell ? "bingo-cell-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={status !== "playing" || isHidden}
                key={cell.id}
                onClick={() => openMissionConfirmation(cell.id)}
              >
                {isHidden ? (
                  <span className="question-mark">?</span>
                ) : (
                  <>
                    <span className="cell-label">
                      {cell.type === "normal"
                        ? "通常"
                        : cell.type === "center"
                          ? "中央"
                          : "緊急"}
                    </span>

                    <span className="cell-content">{cell.content}</span>

                    {cell.completed && <span className="check">✓</span>}
                  </>
                )}
              </button>
            );
          })}
        </section>

        <p className="help-text">
          通常ミッションは最初から挑戦できます。黒いマスは緊急ミッションです。
        </p>

        {status === "waiting" ? (
          <button className="main-button" onClick={startGame}>
            スタート
          </button>
        ) : status === "playing" ? (
          <button
            className="main-button"
            onClick={() => setShowProgressMenu(true)}
          >
            クリア状況
          </button>
        ) : (
          <button className="main-button disabled" disabled>
            ゲーム終了
          </button>
        )}

        {selectedCell && (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="mission-dialog-title"
              aria-modal="true"
              className="progress-modal mission-modal"
              role="dialog"
            >
              <p className="mission-type">{getMissionLabel(selectedCell.type)}</p>

              <h2 id="mission-dialog-title">ミッション確認</h2>

              <p className="mission-content-large">{selectedCell.content}</p>

              <p className="mission-confirm-text">
                {selectedCell.completed
                  ? "このミッションの達成を取り消しますか？"
                  : "このミッションを達成しましたか？"}
              </p>

              <div className="confirm-actions">
                <button className="confirm-yes" onClick={confirmCellCompletion}>
                  はい
                </button>

                <button
                  className="confirm-no"
                  onClick={() => setSelectedCell(null)}
                >
                  いいえ
                </button>
              </div>
            </section>
          </div>
        )}

        {showProgressMenu && (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-modal="true"
              className="progress-modal"
              role="dialog"
            >
              <h2>クリア状況</h2>

              <p>進行状況を選んでください。</p>

              <button onClick={() => revealEmergency(1)}>
                現在のステップをクリアした
              </button>

              <button onClick={() => revealEmergency(99)}>
                ラストステップに入った
              </button>

              <button className="finish-button" onClick={finishGame}>
                ゲームをクリアした
              </button>

              <button
                className="cancel-button"
                onClick={() => setShowProgressMenu(false)}
              >
                キャンセル
              </button>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}