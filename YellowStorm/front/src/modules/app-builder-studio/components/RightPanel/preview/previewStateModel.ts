import {
  DownloadIcon,
  KeyRoundIcon,
  PackageIcon,
  PlayIcon,
  ServerIcon,
  TriangleIcon,
  type LucideIcon,
} from 'lucide-react';
import type { RuntimeHostStatus } from '../../../runtime/runtime.types';

/**
 * Single source of truth for how the NodePod boot is *presented*.
 *
 * `useNodepodPreview` collapses the nine `RuntimeHostStatus` values down to six
 * coarse states, which hides the two slowest phases (`registering` and
 * `hydrating`, the latter being the Ceph download of the whole template) behind
 * one spinner. This model keeps the fine-grained status so the UI can name the
 * phase the runtime is actually in.
 *
 * Pure and framework-free so it can be unit-tested without rendering.
 */

export type PreviewPhaseKind = 'connecting' | 'registering' | 'hydrating' | 'installing' | 'starting' | 'error' | 'idle';

export interface PreviewPhase {
  kind: PreviewPhaseKind;
  /** Translation key for the centred headline. */
  labelKey: string;
  /** Translation key for the supporting line, when the phase warrants one. */
  hintKey: string | null;
  icon: LucideIcon;
  /** Drives the colour of the orb. `busy` phases animate, `idle`/`error` do not. */
  tone: 'busy' | 'idle' | 'error';
  /** Whether the animated orb should be shown (error/idle get a static treatment). */
  animated: boolean;
  /** Whether the phase can be retried from the centre card. */
  showRetry: boolean;
}

const PHASES: Record<Exclude<PreviewPhaseKind, 'idle'>, PreviewPhase> = {
  connecting: {
    kind: 'connecting',
    labelKey: 'nodepod.phase.connecting',
    hintKey: 'nodepod.hint.connecting',
    icon: ServerIcon,
    tone: 'busy',
    animated: true,
    showRetry: false,
  },
  registering: {
    kind: 'registering',
    labelKey: 'nodepod.phase.registering',
    hintKey: 'nodepod.hint.registering',
    icon: KeyRoundIcon,
    tone: 'busy',
    animated: true,
    showRetry: false,
  },
  hydrating: {
    kind: 'hydrating',
    labelKey: 'nodepod.phase.hydrating',
    hintKey: 'nodepod.hint.hydrating',
    icon: DownloadIcon,
    tone: 'busy',
    animated: true,
    showRetry: false,
  },
  installing: {
    kind: 'installing',
    labelKey: 'nodepod.phase.installing',
    hintKey: 'nodepod.hint.installing',
    icon: PackageIcon,
    tone: 'busy',
    animated: true,
    showRetry: false,
  },
  starting: {
    kind: 'starting',
    labelKey: 'nodepod.phase.starting',
    hintKey: 'nodepod.hint.starting',
    icon: PlayIcon,
    tone: 'busy',
    animated: true,
    showRetry: false,
  },
  error: {
    kind: 'error',
    labelKey: 'nodepod.statusError',
    hintKey: null,
    icon: TriangleIcon,
    tone: 'error',
    animated: false,
    showRetry: true,
  },
};

const IDLE_PHASE: PreviewPhase = {
  kind: 'idle',
  labelKey: 'nodepod.statusWaiting',
  hintKey: 'nodepod.waitingHint',
  icon: PlayIcon,
  tone: 'idle',
  animated: false,
  showRetry: true,
};

/**
 * Maps a runtime host status onto its presentation phase.
 *
 * `ready` intentionally resolves to `idle`: the real iframe owns the surface at
 * that point, so no centred status is rendered at all.
 */
export function resolvePreviewPhase(status: RuntimeHostStatus): PreviewPhase {
  switch (status) {
    case 'connecting':
      return PHASES.connecting;
    case 'registering':
      return PHASES.registering;
    case 'hydrating':
      return PHASES.hydrating;
    case 'installing':
      return PHASES.installing;
    case 'starting':
      return PHASES.starting;
    case 'error':
    case 'disconnected':
      return PHASES.error;
    case 'ready':
    case 'idle':
    default:
      return IDLE_PHASE;
  }
}

/** True while the runtime is doing work that will end in a live preview. */
export function isPreviewBusy(status: RuntimeHostStatus): boolean {
  const phase = resolvePreviewPhase(status);
  return phase.animated;
}
