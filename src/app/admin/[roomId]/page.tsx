"use client";

import { useEffect, useMemo, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import {
  doc,
  onSnapshot,
  runTransaction,
  type DocumentReference,
} from "firebase/firestore";
import { useParams } from "next/navigation";
import {
  getCompletedBingoLines,
  getMaximumScore,
  getScore,
  type BingoRoom,
  type GameStatus,
} from "@/lib/bingo";
import { auth, db } from "@/lib/firebase";

type RoomDocument = BingoRoom & {
  createdBy: string | null;
};

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

export default function AdminRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  const [room, setRoom] = useState<RoomDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [showProgressMenu, setShowProgressMenu] = useState(false);
  const [now, setNow] = useState(Date.now());

  const roomReference = useMemo(
    () => doc(db, "rooms", roomId) as DocumentReference<RoomDocument>,
    [roomId],
  );

  const participantUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/r/${roomId}`;

  useEffect(() => {
    if (auth.currentUser) {
      return;
    }

    signInAnonymously(auth).catch(() => {
      setErrorMessage(
        "管理画面を開く準備に失敗しました。ページを再読み込みしてください。",
      );
      setLoading(false);
    });
  }, []);

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

  async function updateRoom(
    action: (latestRoom: RoomDocument) => RoomDocument,
  ) {
    try {
      await runTransaction(db, async (transaction) => {
        const latestSnapshot = await transaction.get(roomReference);

        if (!latestSnapshot.exists()) {
          throw new Error("このビンゴルームは見つかりません。");
        }

        transaction.set(roomReference, action(latestSnapshot.data()));
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "更新に失敗しました。もう一度試してください。";

      setNotice(message);
    }
  }

  async function copyParticipantUrl() {
    try {
      await navigator.clipboard.writeText(participantUrl);
      setNotice("参加者用URLをコピーしました。LINEなどへ貼り付けて共有してください。");
    } catch {
      setNotice("コピーに失敗しました。URLを長押しまたは選択してコピーしてください。");
    }
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

    setNotice("ゲームを開始しました。中央ミッションは30秒後に発表されます。");
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
        ? "ラストステップ：残りの緊急ミッションをすべて発表しました。"
        : "緊急ミッションを1件発表しました。",
    );
  }

  async function finishGame() {
    const accepted = window.confirm(
      "ゲームを終了しますか？ 終了後は参加者もマスを変更できません。",
    );

    if (!accepted) {
      return;
    }

    await updateRoom((latestRoom) => ({
      ...latestRoom,
      status: "finished" as GameStatus,
      finishedAt: Date.now(),
    }));

    setShowProgressMenu(false);
    setNotice("ゲームを終了しました。最終結果は参加者画面にも保存されています。");
  }

  if (loading) {
    return <main className="loading">管理画面を読み込んでいます…</main>;
  }

  if (errorMessage || !room) {
    return (
      <main className="app-shell">
        <section className="game-card">
          <h1>読み込みエラー</h1>
          <p className="notice">
            {errorMessage || "管理画面を読み込めませんでした。"}
          </p>
        </section>
      </main>
    );
  }

  const bingoLines = getCompletedBingoLines(room.cells);
  const score = getScore(room.cells);
  const remainingMilliseconds =
    room.status === "playing" && room.startedAt
      ? room.startedAt + room.timeLimitMinutes * 60 * 1000 - now
      : 0;

  return (
    <main className="app-shell">
      <section className="game-card admin-card">
        <header className="game-header">
          <div>
            <p className="eyebrow">運営者専用</p>
            <h1>TOUR BINGO 管理</h1>
          </div>

          <span className={`status-badge ${room.status}`}>
            {room.status === "waiting" && "開始前"}
            {room.status === "playing" && "プレイ中"}
            {room.status === "paused" && "一時停止"}
            {room.status === "finished" && "終了"}
          </span>
        </header>

        <section className="admin-share-box">
          <p className="admin-section-label">参加者へ送るURL</p>
          <p className="participant-url">{participantUrl}</p>

          <button className="copy-button" onClick={copyParticipantUrl}>
            参加URLをコピー
          </button>

          <p className="admin-share-help">
            このURLだけを参加者へ共有してください。現在開いている管理URLは共有しません。
          </p>
        </section>

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

        <section className="admin-summary">
          <p>
            <strong>{room.title}</strong>
          </p>
          <p>
            {room.gridSize}×{room.gridSize}／達成マス：
            {room.cells.filter((cell) => cell.completed).length} /
            {room.gridSize * room.gridSize}
          </p>
          <p>
            緊急ミッション発表済み：
            {
              room.cells.filter(
                (cell) => cell.type === "emergency" && cell.revealed,
              ).length
            }
            件
          </p>
        </section>

        {room.status === "waiting" ? (
          <button className="main-button" onClick={startGame}>
            スタート
          </button>
        ) : room.status === "playing" ? (
          <button
            className="main-button"
            onClick={() => setShowProgressMenu(true)}
          >
            クリア状況・進行操作
          </button>
        ) : (
          <button className="main-button disabled" disabled>
            {room.status === "finished" ? "ゲーム終了" : "一時停止中"}
          </button>
        )}

        <a className="participant-preview-link" href={participantUrl}>
          参加者画面を別タブで確認する →
        </a>

        {showProgressMenu && (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-modal="true"
              className="progress-modal"
              role="dialog"
            >
              <h2>クリア状況・進行操作</h2>
              <p>謎解き周遊の進行に合わせて選んでください。</p>

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