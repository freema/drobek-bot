import { useEffect, useState } from "react";

import { fetchHealth, formatStatusLine } from "./health";
import type { HealthState } from "./health";

export function App() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>drobek bot</h1>
      <p role="status">{formatStatusLine(state)}</p>
    </main>
  );
}
