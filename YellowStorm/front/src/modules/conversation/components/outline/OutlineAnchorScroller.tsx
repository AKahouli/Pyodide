import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { useConversationStore, useDisplayMessages } from '../../store';
import { useConversationUiStore } from '../../uiStore';
import { buildOutlineGroups, OUTLINE_LISTED_LEVELS } from './outline-groups';

const HEADING_TOP_OFFSET_PX = 96;
const SCROLL_TOP_PADDING_PX = 12;
const STOP_SCROLL_FALLBACK_MS = 900;

/**
 * Invisible bridge rendered inside `ChatConversation` so it can access the
 * stick-to-bottom context: performs smooth scroll requests from the outline
 * rail (stopping stick-to-bottom so it cannot yank the view back) and tracks
 * the anchor currently in view for the rail's active highlight.
 */
export function OutlineAnchorScroller() {
  const { scrollRef, stopScroll } = useStickToBottomContext();
  const scrollRequest = useConversationUiStore((s) => s.outlineScrollRequest);
  const consumeOutlineScroll = useConversationUiStore((s) => s.consumeOutlineScroll);
  const headingsByMessageId = useConversationUiStore(useShallow((s) => s.outlineHeadingsByMessageId));
  const setActiveOutlineAnchor = useConversationUiStore((s) => s.setActiveOutlineAnchor);
  const messages = useDisplayMessages();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const streamingMessageId = useConversationStore((s) => s.streamingMessageId);
  const settleCleanupRef = useRef<() => void>(() => {});

  // Active tracking follows document order (the outline group order) and only
  // among listed levels, so the highlight always matches a visible rail entry.
  const trackedHeadings = useMemo(
    () => buildOutlineGroups(messages, headingsByMessageId, streamingMessageId, isStreaming)
      .flatMap((group) => group.items)
      .filter((item) => OUTLINE_LISTED_LEVELS.has(item.level) && item.text),
    [messages, headingsByMessageId, streamingMessageId, isStreaming],
  );

  useEffect(() => {
    if (!scrollRequest) return;
    const container = scrollRef.current;
    const { anchorId } = scrollRequest;
    consumeOutlineScroll();
    const element = anchorId ? document.getElementById(anchorId) : null;
    if (!container || !element) return;

    stopScroll();
    const targetTop = Math.max(0, container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - SCROLL_TOP_PADDING_PX);
    container.scrollTo({ top: targetTop, behavior: 'smooth' });

    // Settlement must survive the effect re-run caused by consuming the
    // request, so it lives in a ref rather than this effect's cleanup: the
    // post-scroll stopScroll re-assert keeps a live stream from pulling the
    // view back to the bottom mid-jump. A newer request supersedes the
    // previous settlement by running its cleanup first.
    settleCleanupRef.current();
    const onScrollEnd = () => {
      stopScroll();
      settleCleanupRef.current();
    };
    const fallback = window.setTimeout(onScrollEnd, STOP_SCROLL_FALLBACK_MS);
    const cleanup = () => {
      window.clearTimeout(fallback);
      container.removeEventListener('scrollend', onScrollEnd);
      settleCleanupRef.current = () => {};
    };
    settleCleanupRef.current = cleanup;
    container.addEventListener('scrollend', onScrollEnd, { passive: true });
  }, [scrollRequest, scrollRef, stopScroll, consumeOutlineScroll]);

  useEffect(() => () => settleCleanupRef.current(), []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || trackedHeadings.length === 0) {
      setActiveOutlineAnchor(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerTop = container.getBoundingClientRect().top;
      let active: string | null = null;
      for (const heading of trackedHeadings) {
        const element = document.getElementById(heading.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - containerTop <= HEADING_TOP_OFFSET_PX) active = heading.id;
        else break;
      }
      setActiveOutlineAnchor(active);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [trackedHeadings, scrollRef, setActiveOutlineAnchor]);

  return null;
}
