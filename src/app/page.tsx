"use client";

import { useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { addDoc, collection } from "firebase/firestore";
import { useRouter } from "next/navigation";
import {
  createNewRoom,
  DEFAULT_COUNTS,
  type GridSize,
  parseMissionCsv,
} from "@/lib/bingo";
import { auth, db } from "@/lib/firebase";

const GRID_SIZES: GridSize[] = [3, 5, 7];

export default function Home() {
  const router = useRouter();

  const [title, setTitle] = useState("みんなで謎解きビンゴ");
  const [gridSize, setGridSize] = useState<GridSize>(5);
  const [normalCount, setNormalCount] = useState(DEFAULT_COUNTS[5].normal);
  const [emergencyCount, setEmergencyCount] = useState(
    DEFAULT_COUNTS[5].emergency,
  );
  const [centerMission, setCenterMission] = useState("全員で写真を撮る");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(180);
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const totalCells = gridSize * gridSize;
  const isCountValid = normalCount + emergencyCount === totalCells;
  const isTimeLimitValid = timeLimitMinutes > 0;

  function changeGridSize(nextGridSize: GridSize) {
    setGridSize(nextGridSize);
    setNormalCount(DEFAULT_COUNTS[nextGridSize].normal);
    setEmergencyCount(DEFAULT_COUNTS[nextGridSize].emergency);
  }

  function changeNormalCount(nextNormalCount: number) {
    const safeNormalCount = Math.min(
      Math.max(0, nextNormalCount),
      totalCells - 1,
    );

    setNormalCount(safeNormalCount);
    setEmergencyCount(totalCells - safeNormalCount);
  }

  function changeEmergencyCount(nextEmergencyCount: number) {
    const safeEmergencyCount = Math.min(
      Math.max(1, nextEmergencyCount),
      totalCells,
    );

    setEmergencyCount(safeEmergencyCount);
    setNormalCount(totalCells - safeEmergencyCount);
  }

  async function createRoom() {
    setCreating(true);
    setErrorMessage("");

    try {
      const response = await fetch("/mission.csv");

      if (!response.ok) {
        throw new Error(
          `mission.csv を読み込めませんでした（${response.status}）`,
        );
      }

      const csv = await response.text();
      const missions = parseMissionCsv(csv);

      const room = createNewRoom({
        title,
        gridSize,
        missions,
        normalCount,
        emergencyCount,
        centerMission,
        timeLimitMinutes,
      });

      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const roomReference = await addDoc(collection(db, "rooms"), {
        ...room,
        createdBy: auth.currentUser?.uid ?? null,
      });

      router.push(`/admin/${roomReference.id}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "ルームの作成中に予期しないエラーが起きました。";

      setErrorMessage(message);
      setCreating(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="game-card create-card">
        <header className="game-header">
          <div>
            <p className="eyebrow">謎解き周遊をもっと楽しく</p>
            <h1>TOUR BINGO</h1>
          </div>

          <span className="status-badge waiting">新規作成</span>
        </header>

        <p className="create-intro">
          チーム全員で一枚のビンゴ盤に挑戦します。作成後に表示されるURLを共有してください。
        </p>

        <div className="create-form">
          <label>
            イベント・チーム名
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例：稲沢謎解きビンゴ"
              value={title}
            />
          </label>

          <label>
            ビンゴのサイズ
            <select
              onChange={(event) =>
                changeGridSize(Number(event.target.value) as GridSize)
              }
              value={gridSize}
            >
              {GRID_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} × {size}
                </option>
              ))}
            </select>
          </label>

          <section className="mission-count-settings">
            <p className="mission-count-help">
              通常と緊急の合計が、盤面の{totalCells}マスになるよう自動で調整されます。
            </p>

            <div className="mission-count-row">
              <div>
                <span className="mission-count-label">通常ミッション</span>
                <strong>{normalCount}件</strong>
              </div>

              <div className="count-stepper">
                <button
                  aria-label="通常ミッションを1件減らす"
                  disabled={normalCount <= 0}
                  onClick={() => changeNormalCount(normalCount - 1)}
                  type="button"
                >
                  −
                </button>

                <output aria-label={`通常ミッション ${normalCount}件`}>
                  {normalCount}
                </output>

                <button
                  aria-label="通常ミッションを1件増やす"
                  disabled={normalCount >= totalCells - 1}
                  onClick={() => changeNormalCount(normalCount + 1)}
                  type="button"
                >
                  ＋
                </button>
              </div>
            </div>

            <div className="mission-count-row">
              <div>
                <span className="mission-count-label">緊急ミッション</span>
                <strong>{emergencyCount}件</strong>
              </div>

              <div className="count-stepper">
                <button
                  aria-label="緊急ミッションを1件減らす"
                  disabled={emergencyCount <= 1}
                  onClick={() => changeEmergencyCount(emergencyCount - 1)}
                  type="button"
                >
                  −
                </button>

                <output aria-label={`緊急ミッション ${emergencyCount}件`}>
                  {emergencyCount}
                </output>

                <button
                  aria-label="緊急ミッションを1件増やす"
                  disabled={emergencyCount >= totalCells}
                  onClick={() => changeEmergencyCount(emergencyCount + 1)}
                  type="button"
                >
                  ＋
                </button>
              </div>
            </div>

            <p className="mission-count-total">
              通常 {normalCount}件 ＋ 緊急 {emergencyCount}件 ＝{" "}
              {totalCells}マス
            </p>
          </section>

          <label>
            中央ミッション（開始30秒後に発表）
            <input
              onChange={(event) => setCenterMission(event.target.value)}
              value={centerMission}
            />
          </label>

          <label>
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
        </div>

        {errorMessage && <p className="form-error">{errorMessage}</p>}

        <button
          className="main-button"
          disabled={creating || !isCountValid || !isTimeLimitValid}
          onClick={createRoom}
        >
          {creating ? "ビンゴを作成中…" : "新しいビンゴURLを発行する"}
        </button>

        <p className="help-text">
          ミッションは作成時にランダム抽選・固定されます。同じURLを開く全員が同じ盤面を共有します。
        </p>
      </section>
    </main>
  );
}