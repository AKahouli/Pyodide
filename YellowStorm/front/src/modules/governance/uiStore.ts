import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface GovernanceUiState {
  selectedProgramId: string | null;
  selectedScopeId: string | null;
  selectedDeploymentId: string | null;
  setSelectedProgramId: (id: string | null) => void;
  setSelectedScopeId: (id: string | null) => void;
  setSelectedDeploymentId: (id: string | null) => void;
}

export const initialGovernanceUiState = {
  selectedProgramId: null,
  selectedScopeId: null,
  selectedDeploymentId: null,
};

export const useGovernanceUiStore = create<GovernanceUiState>()(
  devtools(
    (set) => ({
      ...initialGovernanceUiState,
      setSelectedProgramId: (selectedProgramId) => set({ selectedProgramId }),
      setSelectedScopeId: (selectedScopeId) => set({ selectedScopeId }),
      setSelectedDeploymentId: (selectedDeploymentId) => set({ selectedDeploymentId }),
    }),
    { name: 'governance-ui-store' },
  ),
);
