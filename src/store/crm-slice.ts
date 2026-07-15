import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type DealPriorityFilter = "all" | "overdue" | "unassigned";

interface CrmState {
  selectedPipelineId: string;
  search: string;
  priorityFilter: DealPriorityFilter;
}

const initialState: CrmState = {
  selectedPipelineId: "",
  search: "",
  priorityFilter: "all",
};

const crmSlice = createSlice({
  name: "crm",
  initialState,
  reducers: {
    selectPipeline(state, action: PayloadAction<string>) {
      state.selectedPipelineId = action.payload;
    },
    setSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    setPriorityFilter(state, action: PayloadAction<DealPriorityFilter>) {
      state.priorityFilter = action.payload;
    },
    resetBoardFilters(state) {
      state.search = "";
      state.priorityFilter = "all";
    },
  },
});

export const { selectPipeline, setSearch, setPriorityFilter, resetBoardFilters } =
  crmSlice.actions;
export default crmSlice.reducer;
