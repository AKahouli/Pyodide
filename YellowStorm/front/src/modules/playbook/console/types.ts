import type { PlaybookVM } from '../utils/playbookVM';

/** Action bundle passed to every console view; views stay presentational. */
export interface PlaybookActions {
  onOpen: (vm: PlaybookVM) => void;
  onRun: (vm: PlaybookVM) => void;
  onEditCanvas: (vm: PlaybookVM) => void;
  onEditDetails: (vm: PlaybookVM) => void;
  onClone: (vm: PlaybookVM) => void;
  onDelete: (vm: PlaybookVM) => void;
  onToggleFavorite: (vm: PlaybookVM) => void;
  onOpenTriggers: (vm: PlaybookVM) => void;
  onIntegration: (vm: PlaybookVM) => void;
  onWatchRun: (vm: PlaybookVM) => void;
}
