import { configureStore } from "@reduxjs/toolkit";
import crmReducer from "./crm-slice";

export const makeStore = () =>
  configureStore({
    reducer: { crm: crmReducer },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
