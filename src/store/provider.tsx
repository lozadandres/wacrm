"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from ".";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<AppStore>(makeStore);
  return <Provider store={store}>{children}</Provider>;
}
