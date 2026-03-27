import { useEffect } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { setWorkspaceTranslator } from '../store';

export function useWorkspaceStoreTranslator() {
  const { t } = useModuleTranslation('workspace');

  useEffect(() => {
    setWorkspaceTranslator(t);
  }, [t]);
}
