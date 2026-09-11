import { useEffect } from 'react';
import { useSidebar } from '@/components/ui/sidebar';

/**
 * Hook that auto-collapses the sidebar when the window gets smaller
 */
export function useAutoCollapse() {
  const { isMobile, toggleSidebar, state } = useSidebar();

  useEffect(() => {
    let prevWidth = window.innerWidth;

    const handleResize = () => {
      const currentWidth = window.innerWidth;
      const isGettingSmaller = currentWidth < prevWidth;
      const isCollapsed = state === 'collapsed';

      if (isGettingSmaller && !isCollapsed) {
        toggleSidebar();
      }

      prevWidth = currentWidth;
    };

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [state, toggleSidebar]);

  return { isMobile, state, toggleSidebar };
}
