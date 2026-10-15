import { create } from "zustand";
interface PlannerUI {
  selectedId: string | null;
  select: (id: string | null) => void;
}
export const usePlannerUI = create<PlannerUI>((set) => ({
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
}));
