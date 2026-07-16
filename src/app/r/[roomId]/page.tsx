type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return (
    <main>
      <h1>TOUR BINGO</h1>
      <p>ルームを準備しています。</p>
      <p>ルームID: {roomId}</p>
    </main>
  );
}