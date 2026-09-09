import { useEffect } from "react";
import InstallBanner from "./components/InstallBanner";
import { db } from "./db/database";
import DayScreen from "./screens/day/DayScreen";
import { startSyncEngine } from "./sync/engine";
import { FakeTransport } from "./sync/fakeTransport";

export default function App() {
  // Started once, app-wide: every tab on this device shares one
  // FakeTransport database name (see fakeTransport.ts's default), which is
  // what lets two tabs converge on one coherent view of "the server".
  useEffect(() => {
    const handle = startSyncEngine(db, new FakeTransport());
    return () => handle.stop();
  }, []);

  return (
    <>
      <InstallBanner />
      <DayScreen />
    </>
  );
}
