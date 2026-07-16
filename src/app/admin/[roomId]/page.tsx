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
  type BingoCell,
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

function getMissionTypeLabel(type: BingoCell["type"]) {
  if (type === "normal") {
    return "通常";
  }

  if (type === "center") {
    return "中央";
  }

  return "緊急";
}

function getMissionTypeClass(type: BingoCell["type"]) {
  if (type === "normal") {
    return "normal";
  }

  if (type === "center") {
    return "center";
  }

  return "emergency";
}

export default function AdminRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  const [room, setRoom] = useState<RoomDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [showProgressMenu, setShowProgressMenu] = useState(false);
  const [showMissionManager, setShowMissionManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingCellId, setEditingCellId] = useState<number | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(180);
  const [centerRevealAfterSeconds, setCenterRevealAfterSeconds] =
    useState(30);
  const [revealEveryMinutes, setRevealEveryMinutes] = useState(60);
  const [revealPerStepClear, setRevealPerStepClear] = useState(1);
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

  useEffect(() => {
    if (
      !room ||
      room.status !== "playing" ||
      !room.startedAt ||
      room.emergencySettings.revealEveryMinutes < 1
    ) {
      return;
    }

    const elapsedMilliseconds = now - room.startedAt;
    const intervalMilliseconds =
      room.emergencySettings.revealEveryMinutes * 60 * 1000;

    const shouldRevealCount = Math.floor(
      elapsedMilliseconds / intervalMilliseconds,
    );

    if (shouldRevealCount < 1) {
      return;
    }

    const revealedEmergencyCount = room.cells.filter(
      (cell) => cell.type === "emergency" && cell.revealed,
    ).length;

    if (revealedEmergencyCount >= shouldRevealCount) {
      return;
    }

    runTransaction(db, async (transaction) => {
      const latestSnapshot = await transaction.get(roomReference);

      if (!latestSnapshot.exists()) {
        return;
      }

      const latestRoom = latestSnapshot.data();

      if (latestRoom.status !== "playing" || !latestRoom.startedAt) {
        return;
      }

      const latestElapsedMilliseconds = Date.now() - latestRoom.startedAt;
      const latestIntervalMilliseconds =
        latestRoom.emergencySettings.revealEveryMinutes * 60 * 1000;

      const latestShouldRevealCount = Math.floor(
        latestElapsedMilliseconds / latestIntervalMilliseconds,
      );

      let alreadyRevealedCount = latestRoom.cells.filter(
        (cell) => cell.type === "emergency" && cell.revealed,
      ).length;

      const cells = latestRoom.cells.map((cell) => {
        if (
          cell.type === "emergency" &&
          !cell.revealed &&
          alreadyRevealedCount < latestShouldRevealCount
        ) {
          alreadyRevealedCount += 1;

          return {
            ...cell,
            revealed: true,
          };
        }

        return cell;
      });

      transaction.update(roomReference, { cells });
    }).catch(() => {
      setNotice("自動の緊急ミッション発表に失敗しました。");
    });
  }, [now, room, roomReference]);

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

      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "更新に失敗しました。もう一度試してください。";

      setNotice(message);
      return false;
    }
  }

  async function copyParticipantUrl() {
    try {
      await navigator.clipboard.writeText(participantUrl);
      setNotice("参加者用URLをコピーしました。LINEなどへ貼り付けて共有してください。");
    } catch {
      setNotice(
        "コピーに失敗しました。表示されているURLを選択してコピーしてください。",
      );
    }
  }

  function openSettings() {
    if (!room) {
      return;
    }

    setTimeLimitMinutes(room.timeLimitMinutes);
    setCenterRevealAfterSeconds(
      room.emergencySettings.centerRevealAfterSeconds,
    );
    setRevealEveryMinutes(room.emergencySettings.revealEveryMinutes);
    setRevealPerStepClear(room.emergencySettings.revealPerStepClear);
    setShowSettings(true);
  }

  async function saveSettings() {
    if (
      timeLimitMinutes < 1 ||
      centerRevealAfterSeconds < 0 ||
      revealEveryMinutes < 1 ||
      revealPerStepClear < 1
    ) {
      setNotice(
        "設定値を確認してください。制限時間・発表間隔・発表数は1以上必要です。",
      );
      return;
    }

    const accepted = window.confirm("このゲーム設定を保存しますか？");

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => ({
      ...latestRoom,
      timeLimitMinutes,
      emergencySettings: {
        centerRevealAfterSeconds,
        revealEveryMinutes,
        revealPerStepClear,
      },
    }));

    if (updated) {
      setShowSettings(false);
      setNotice("ゲーム設定を保存しました。");
    }
  }

  async function startGame() {
    const accepted = window.confirm("スタートしていいですか？");

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => {
      if (latestRoom.status !== "waiting") {
        return latestRoom;
      }

      return {
        ...latestRoom,
        status: "playing",
        startedAt: Date.now(),
      };
    });

    if (updated) {
      setNotice("ゲームを開始しました。中央ミッションは30秒後に発表されます。");
    }
  }

  async function pauseGame() {
    const accepted = window.confirm(
      "ゲームを一時停止しますか？ 参加者はマスを操作できなくなります。",
    );

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => {
      if (latestRoom.status !== "playing") {
        return latestRoom;
      }

      return {
        ...latestRoom,
        status: "paused" as GameStatus,
      };
    });

    if (updated) {
      setNotice("ゲームを一時停止しました。");
    }
  }

  async function resumeGame() {
    const accepted = window.confirm("ゲームを再開しますか？");

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => {
      if (latestRoom.status !== "paused") {
        return latestRoom;
      }

      return {
        ...latestRoom,
        status: "playing" as GameStatus,
      };
    });

    if (updated) {
      setNotice("ゲームを再開しました。");
    }
  }

  async function revealEmergency(count: number) {
    let revealedCount = 0;

    const updated = await updateRoom((latestRoom) => {
      if (latestRoom.status !== "playing") {
        return latestRoom;
      }

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

    if (!updated) {
      return;
    }

    setNotice(
      count >= 99
        ? "ラストステップ：残りの緊急ミッションをすべて発表しました。"
        : `緊急ミッションを${revealedCount}件発表しました。`,
    );
  }

  async function finishGame() {
    const accepted = window.confirm(
      "ゲームを終了しますか？ 終了後は参加者もマスを変更できません。",
    );

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => ({
      ...latestRoom,
      status: "finished" as GameStatus,
      finishedAt: Date.now(),
    }));

    setShowProgressMenu(false);

    if (updated) {
      setNotice(
        "ゲームを終了しました。最終結果は参加者画面にも保存されています。",
      );
    }
  }

  function startEditingMission(cell: BingoCell) {
    setEditingCellId(cell.id);
    setDraftContent(cell.content);
  }

  function cancelEditingMission() {
    setEditingCellId(null);
    setDraftContent("");
  }

  async function saveMissionContent(cell: BingoCell) {
    const nextContent = draftContent.trim();

    if (!nextContent) {
      setNotice("ミッション内容を入力してください。");
      return;
    }

    if (nextContent === cell.content) {
      cancelEditingMission();
      return;
    }

    const accepted = window.confirm(
      `次の内容に変更しますか？\n\n${nextContent}`,
    );

    if (!accepted) {
      return;
    }

    const updated = await updateRoom((latestRoom) => ({
      ...latestRoom,
      cells: latestRoom.cells.map((latestCell) =>
        latestCell.id === cell.id
          ? {
              ...latestCell,
              content: nextContent,
            }
          : latestCell,
      ),
      centerMission:
        cell.type === "center" ? nextContent : latestRoom.centerMission,
    }));

    if (updated) {
      setNotice(`マス ${cell.id + 1} のミッション内容を変更しました。`);
      cancelEditingMission();
    }
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

  const revealedEmergencyCount = room.cells.filter(
    (cell) => cell.type === "emergency" && cell.revealed,
  ).length;

  const completedCount = room.cells.filter((cell) => cell.completed).length;

  return (
    <main className="app-shell">
      <section className="game-card admin-card">
        <header className="game-header">
          <div>
            <p className="eyebrow">運営者用・管理画面</p>
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
            このURLだけをチームへ共有してください。管理画面のURLは共有不要です。
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
            {room.gridSize}×{room.gridSize}／達成マス：{completedCount} /
            {room.gridSize * room.gridSize}
          </p>
          <p>緊急ミッション発表済み：{revealedEmergencyCount}件</p>
        </section>

        <div className="admin-action-grid">
          {room.status === "waiting" && (
            <button className="main-button" onClick={startGame}>
              スタート
            </button>
          )}

          {room.status === "playing" && (
            <>
              <button
                className="main-button"
                onClick={() => setShowProgressMenu(true)}
              >
                クリア状況・進行操作
              </button>

              <button className="pause-button" onClick={pauseGame}>
                一時停止
              </button>
            </>
          )}

          {room.status === "paused" && (
            <button className="resume-button" onClick={resumeGame}>
              ゲームを再開する
            </button>
          )}

          {room.status === "finished" && (
            <button className="main-button disabled" disabled>
              ゲーム終了
            </button>
          )}

          <button className="settings-button" onClick={openSettings}>
            ゲーム設定を開く
          </button>
        </div>

        <a
          className="participant-preview-link"
          href={participantUrl}
          rel="noreferrer"
          target="_blank"
        >
          参加者画面を別タブで確認する →
        </a>

        <section className="mission-manager">
          <button
            aria-expanded={showMissionManager}
            className="mission-manager-toggle"
            onClick={() => setShowMissionManager(!showMissionManager)}
          >
            <span>ミッション管理</span>
            <span>{showMissionManager ? "閉じる ▲" : "一覧を開く ▼"}</span>
          </button>

          {showMissionManager && (
            <div className="mission-manager-content">
              <p className="mission-manager-help">
                内容を変更して保存すると、参加者画面にもリアルタイムで反映されます。
                達成状況と発表状況は変更されません。
              </p>

              <div className="mission-list">
                {room.cells.map((cell) => {
                  const isEditing = editingCellId === cell.id;

                  return (
                    <article
                      className={`mission-admin-item ${
                        cell.completed ? "is-completed" : ""
                      }`}
                      key={cell.id}
                    >
                      <div className="mission-admin-heading">
                        <strong>マス {cell.id + 1}</strong>

                        <span
                          className={`mission-kind ${getMissionTypeClass(
                            cell.type,
                          )}`}
                        >
                          {getMissionTypeLabel(cell.type)}
                        </span>

                        <span
                          className={`mission-state ${
                            cell.revealed ? "revealed" : "hidden"
                          }`}
                        >
                          {cell.revealed ? "発表済み" : "未発表"}
                        </span>

                        <span
                          className={`mission-state ${
                            cell.completed ? "completed" : "incomplete"
                          }`}
                        >
                          {cell.completed ? "達成済み" : "未達成"}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="mission-edit-form">
                          <textarea
                            aria-label={`マス ${cell.id + 1} のミッション内容`}
                            autoFocus
                            onChange={(event) =>
                              setDraftContent(event.target.value)
                            }
                            value={draftContent}
                          />

                          <div className="mission-edit-actions">
                            <button
                              className="mission-save-button"
                              onClick={() => saveMissionContent(cell)}
                            >
                              保存
                            </button>

                            <button
                              className="mission-cancel-button"
                              onClick={cancelEditingMission}
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mission-read-form">
                          <p>{cell.content}</p>

                          <button
                            className="mission-edit-button"
                            onClick={() => startEditingMission(cell)}
                          >
                            内容を変更
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {showSettings && (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="settings-dialog-title"
              aria-modal="true"
              className="progress-modal settings-modal"
              role="dialog"
            >
              <h2 id="settings-dialog-title">ゲーム設定</h2>

              <label className="settings-label">
                制限時間（分）
                <input
                  min="1"
                  onChange={(event) =>
                    setTimeLimitMinutes(Number(event.target.value))
                  }
                  type="number"
                  value={timeLimitMinutes}
                />
              </label>

              <label className="settings-label">
                中央ミッション発表まで（秒）
                <input
                  min="0"
                  onChange={(event) =>
                    setCenterRevealAfterSeconds(Number(event.target.value))
                  }
                  type="number"
                  value={centerRevealAfterSeconds}
                />
              </label>

              <label className="settings-label">
                自動で緊急ミッションを発表する間隔（分）
                <input
                  min="1"
                  onChange={(event) =>
                    setRevealEveryMinutes(Number(event.target.value))
                  }
                  type="number"
                  value={revealEveryMinutes}
                />
              </label>

              <label className="settings-label">
                ステップクリアごとの緊急ミッション発表数
                <input
                  min="1"
                  onChange={(event) =>
                    setRevealPerStepClear(Number(event.target.value))
                  }
                  type="number"
                  value={revealPerStepClear}
                />
              </label>

              <p className="settings-help">
                自動発表はゲーム開始から指定間隔ごとに行われます。一時停止中は参加者の操作を止めます。
              </p>

              <div className="settings-actions">
                <button className="settings-save-button" onClick={saveSettings}>
                  設定を保存
                </button>

                <button
                  className="settings-cancel-button"
                  onClick={() => setShowSettings(false)}
                >
                  キャンセル
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
              <h2>クリア状況・進行操作</h2>
              <p>謎解き周遊の進行に合わせて選んでください。</p>

              <button
                onClick={() =>
                  revealEmergency(room.emergencySettings.revealPerStepClear)
                }
              >
                現在のステップをクリアした（
                {room.emergencySettings.revealPerStepClear}件発表）
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