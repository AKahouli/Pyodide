import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type GovernanceWizardStep =
  | 'program'
  | 'scopes'
  | 'sources'
  | 'access'
  | 'deployment'
  | 'dry_run'
  | 'publish'
  | 'monitor';

interface GovernanceUiState {
  selectedProgramId: string | null;
  selectedScopeId: string | null;
  selectedDeploymentId: string | null;
  currentStep: GovernanceWizardStep;
  setSelectedProgramId: (id: string | null) => void;
  setSelectedScopeId: (id: string | null) => void;
  setSelectedDeploymentId: (id: string | null) => void;
  setCurrentStep: (step: GovernanceWizardStep) => void;
}

export const initialGovernanceUiState = {
  selectedProgramId: null,
  selectedScopeId: null,
  selectedDeploymentId: null,
  currentStep: 'program' as GovernanceWizardStep,
};

export const useGovernanceUiStore = create<GovernanceUiState>()(
  devtools(
    (set) => ({
      ...initialGovernanceUiState,
      setSelectedProgramId: (selectedProgramId) => set({ selectedProgramId }),
      setSelectedScopeId: (selectedScopeId) => set({ selectedScopeId }),
      setSelectedDeploymentId: (selectedDeploymentId) => set({ selectedDeploymentId }),
      setCurrentStep: (currentStep) => set({ currentStep }),
    }),
    { name: 'governance-ui-store' },
  ),
);
