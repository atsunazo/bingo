"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  doc,
  onSnapshot,
  runTransaction,
  type DocumentReference,
} from "firebase/firestore";
import {
  getCompletedBingoLines,
  getMaximumScore,
  getScore,
  type BingoCell,
  type BingoRoom,
  type GameStatus,
} from "@/lib/bingo";
import { db } from "@/lib/firebase";

type RoomDocument = BingoRoom & {
  createdBy: string | null;
};

function getMissionLabel(type: BingoCell["type"]) {
  if (type === "normal") {
    return "通常ミッション";
  }

  if (type === "center") {
    return "中央ミッション";
  }

  return "緊急ミッション";
}

function formatRemainingTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  const [room, setRoom] = useState<RoomDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCell, setSelectedCell] = useState<BingoCell | null>(null);
  const [showProgressMenu, setShowProgressMenu] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");

  const roomReference = useMemo(
    () => doc(db, "rooms", roomId) as DocumentReference<RoomDocument>,
    [roomId],
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      roomReference,
      (snapshot) => {
        if (!snapshot.exists()) {
          setErrorMessage("このビンゴルームは見つかりません。");
          setRoom(null);
          setLoading(false);
          return;
        }

        setRoom(snapshot.data());
        setLoading(false);
      },
      () => {
        setErrorMessage(
          "ビンゴルームを読み込めませんでした。通信状態を確認してください。",
        );
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [roomReference]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room || room.status !== "playing" || !room.startedAt) {
      return;
    }

    const centerDelay =
      room.emergencySettings.centerRevealAfterSeconds * 1000;

    if (now < room.startedAt + centerDelay) {
      return;
    }

    const centerCell = room.cells.find((cell) => cell.type === "center");

    if (!centerCell || centerCell.revealed) {
      return;
    }

    runTransaction(db, async (transaction) => {
      const latestSnapshot = await transaction.get(roomReference);

      if (!latestSnapshot.exists()) {
        return;
      }

      const latestRoom = latestSnapshot.data();
      const latestCenterCell = latestRoom.cells.find(
        (cell) => cell.type === "center",
      );

      if (!latestCenterCell || latestCenterCell.revealed) {
        return;
      }

      transaction.update(roomReference, {
        cells: latestRoom.cells.map((cell) =>
          cell.type === "center" ? { ...cell, revealed: true } : cell,
        ),
      });
    }).catch(() => {
      setNotice("中央ミッションの発表に失敗しました。");
    });
  }, [now, room, roomReference]);

  useEffect(() => {
    if (!room || room.status !== "playing" || !room.startedAt) {
      return;
    }

    const endAt = room.startedAt + room.timeLimitMinutes * 60 * 1000;

    if (now < endAt) {
      return;
    }

    runTransaction(db, async (transaction) => {
      const latestSnapshot = await transaction.get(roomReference);

      if (!latestSnapshot.exists()) {
        return;
      }

      const latestRoom = latestSnapshot.data();

      if (latestRoom.status !== "playing") {
        return;
      }

      transaction.update(roomReference, {
        status: "finished" satisfies GameStatus,
        finishedAt: Date.now(),
      });
    }).catch(() => {
      setNotice("制限時間終了の処理に失敗しました。");
    });
  }, [now, room, roomReference]);

  const bingoLines = useMemo(
    () => (room ? getCompletedBingoLines(room.cells) : []),
    [room],
  );

  const score = useMemo(() => (room ? getScore(room.cells) : 0), [room]);

  const bingoCellIds = useMemo(
    () => new Set(bingoLines.flat()),
    [bingoLines],
  );

  const remainingMilliseconds =
    room?.status === "playing" && room.startedAt
      ? room.startedAt + room.timeLimitMinutes * 60 * 1000 - now
      : 0;

  async function updateRoom(action: (latestRoom: RoomDocument) => RoomDocument) {
    try {
      await runTransaction(db, async (transaction) => {
        const latestSnapshot = await transaction.get(roomReference);

        if (!latestSnapshot.exists()) {
          throw new Error("このビンゴルームは見つかりません。");
        }

        const latestRoom = latestSnapshot.data();

        transaction.set(roomReference, action(latestRoom));
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "更新に失敗しました。もう一度試してください。";

      setNotice(message);
    }
  }

  function openMissionConfirmation(cell: BingoCell) {
    if (!room || room.status !== "playing" || !cell.revealed) {
      return;
    }

    setSelectedCell(cell);
  }

  async function confirmCellCompletion() {
    if (!selectedCell) {
      return;
    }

    const cellId = selectedCell.id;
    const wasCompleted = selectedCell.completed;

    await updateRoom((latestRoom) => ({
      ...latestRoom,
      cells: latestRoom.cells.map((cell) => {
        if (cell.id !== cellId || !cell.revealed) {
          return cell;
        }

        return {
          ...cell,
          completed: !cell.completed,
          completedAt: !cell.completed ? Date.now() : null,
        };
      }),
    }));

    setSelectedCell(null);
    setNotice(
      wasCompleted
        ? "ミッションの達成を取り消しました"
        : "ミッションを達成にしました！",
    );
  }

  async function startGame() {
    const accepted = window.confirm("スタートしていいですか？");

    if (!accepted) {
      return;
    }

    await updateRoom((latestRoom) => {
      if (latestRoom.status !== "waiting") {
        return latestRoom;
      }

      return {
        ...latestRoom,
        status: "playing",
        startedAt: Date.now(),
      };
    });

    setNotice("ゲームスタート！ 中央ミッションは30秒後に発表されます");
  }

  async function revealEmergency(count: number) {
    await updateRoom((latestRoom) => {
      if (latestRoom.status !== "playing") {
        return latestRoom;
      }

      let revealedCount = 0;

      const cells = latestRoom.cells.map((cell) => {
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
      });

      return {
        ...latestRoom,
        cells,
      };
    });

    setShowProgressMenu(false);

    setNotice(
      count >= 99
        ? "ラストステップ！ 残りの緊急ミッションをすべて発表しました！"
        : "緊急ミッションを1件発表しました！",
    );
  }

  async function finishGame() {
    const accepted = window.confirm(
      "ゲームを終了しますか？ 終了後はマスを変更できません。",
    );

    if (!accepted) {
      return;
    }

    await updateRoom((latestRoom) => ({
      ...latestRoom,
      status: "finished",
      finishedAt: Date.now(),
    }));

    setShowProgressMenu(false);
    setSelectedCell(null);
    setNotice("ゲーム終了！ おつかれさまでした");
  }

  if (loading) {
    return <main className="loading">ビンゴを読み込んでいます…</main>;
  }

  if (errorMessage || !room) {
    return (
      <main className="app-shell">
        <section className="game-card">
          <h1>読み込みエラー</h1>
          <p className="notice">
            {errorMessage || "ビンゴルームを読み込めませんでした。"}
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
            <p className="eyebrow">{room.title}</p>
            <h1>TOUR BINGO</h1>
          </div>

          <span className={`status-badge ${room.status}`}>
            {room.status === "waiting" && "開始前"}
            {room.status === "playing" && "プレイ中"}
            {room.status === "paused" && "一時停止"}
            {room.status === "finished" && "終了"}
          </span>
        </header>

        <section className="score-board" aria-label="現在の成績">
          <div>
            <span>現在の得点</span>
            <strong>
              {score}
              <small>/{getMaximumScore(room.gridSize)}点</small>
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
            <span>残り時間</span>
            <strong className="time-value">
              {room.status === "playing"
                ? formatRemainingTime(remainingMilliseconds)
                : room.status === "finished"
                  ? "終了"
                  : `${room.timeLimitMinutes}分`}
            </strong>
          </div>
        </section>

        {notice && <p className="notice">{notice}</p>}

        <section
          className="bingo-grid"
          style={{
            gridTemplateColumns: `repeat(${room.gridSize}, minmax(0, 1fr))`,
          }}
          aria-label="ビンゴ盤"
        >
          {room.cells.map((cell) => {
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
                disabled={room.status !== "playing" || isHidden}
                key={cell.id}
                onClick={() => openMissionConfirmation(cell)}
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
          ルームID：{roomId}　同じURLを共有すると、全員で同じ盤面を見られます。
        </p>

        {room.status === "waiting" ? (
          <button className="main-button" onClick={startGame}>
            スタート
          </button>
        ) : room.status === "playing" ? (
          <button
            className="main-button"
            onClick={() => setShowProgressMenu(true)}
          >
            クリア状況
          </button>
        ) : (
          <button className="main-button disabled" disabled>
            {room.status === "finished" ? "ゲーム終了" : "一時停止中"}
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