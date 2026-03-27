import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface StarsBackgroundProps extends React.HTMLAttributes<HTMLCanvasElement> {
  shootingStars?: boolean;
}

interface Star {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

interface ShootingStar {
  x: number;
  y: number;
  len: number;
  speed: number;
}

// Target ~30fps for smooth but efficient animation
const TARGET_FRAME_TIME = 1000 / 30;
const NUM_STARS = 100;
const TWO_PI = Math.PI * 2;
const ANGLE_COS = Math.cos(Math.PI / 4); // Pre-calculate for 45 degrees
const ANGLE_SIN = Math.sin(Math.PI / 4);

const StarsBackground = React.forwardRef<HTMLCanvasElement, StarsBackgroundProps>(({ className, shootingStars = false, ...props }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const isDarkRef = useRef(document.documentElement.classList.contains('dark'));
  const bgColorRef = useRef('#000000');
  const fgColorRef = useRef('#ffffff');

  const updateThemeColors = () => {
    const styles = getComputedStyle(document.documentElement);
    bgColorRef.current = styles.getPropertyValue('--background').trim() || (isDarkRef.current ? '#000000' : '#ffffff');
    fgColorRef.current = styles.getPropertyValue('--foreground').trim() || (isDarkRef.current ? '#ffffff' : '#000000');
  };

  useEffect(() => {
    updateThemeColors();
    const timer = setTimeout(() => {
      setIsAnimating(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      isDarkRef.current = document.documentElement.classList.contains('dark');
      updateThemeColors();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isAnimating) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      // Debounce resize to avoid excessive canvas resizing
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
      }, 100);
    };
    window.addEventListener('resize', handleResize);

    // Initialize stars
    const stars: Star[] = [];
    for (let i = 0; i < NUM_STARS; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 1.5 + 0.5,
        vx: Math.random() * 0.1 + 0.05,
        vy: -(Math.random() * 0.1) - 0.05,
      });
    }

    // Group stars by size for batched drawing
    const smallStars: Star[] = [];
    const mediumStars: Star[] = [];
    const largeStars: Star[] = [];
    for (const star of stars) {
      const radius = star.z * 0.5;
      if (radius < 0.5) smallStars.push(star);
      else if (radius < 0.75) mediumStars.push(star);
      else largeStars.push(star);
    }

    let shootingStar: ShootingStar | null = null;
    let animationFrameId: number;
    let lastFrameTime = 0;

    const draw = (currentTime: number) => {
      // Throttle frame rate
      const deltaTime = currentTime - lastFrameTime;
      if (deltaTime < TARGET_FRAME_TIME) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = currentTime - (deltaTime % TARGET_FRAME_TIME);

      // Clear canvas with theme background
      ctx.fillStyle = bgColorRef.current;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = fgColorRef.current;

      // Batch draw stars by size group
      const drawStarGroup = (group: Star[], radius: number) => {
        ctx.beginPath();
        for (const star of group) {
          // Update position
          star.x += star.vx * star.z;
          star.y += star.vy * star.z;

          // Wrap around
          if (star.x > width + 5 || star.y < -5) {
            if (Math.random() > 0.5) {
              star.x = -5;
              star.y = Math.random() * height;
            } else {
              star.x = Math.random() * width;
              star.y = height + 5;
            }
          }

          // Add to path (use integer coords for performance)
          ctx.moveTo((star.x + radius) | 0, star.y | 0);
          ctx.arc(star.x | 0, star.y | 0, radius, 0, TWO_PI);
        }
        ctx.fill();
      };

      drawStarGroup(smallStars, 0.35);
      drawStarGroup(mediumStars, 0.6);
      drawStarGroup(largeStars, 0.85);

      // Draw shooting star
      if (shootingStars) {
        if (!shootingStar && Math.random() < 0.005) {
          shootingStar = {
            x: Math.random() * width,
            y: Math.random() * (height / 2),
            len: Math.random() * 80 + 15,
            speed: Math.random() * 8 + 4, // 4-12 px/frame at 30fps = same visual speed as 2-6 at 60fps
          };
        }

        if (shootingStar) {
          const { x, y, len, speed } = shootingStar;
          const endX = x - len * ANGLE_COS;
          const endY = y - len * ANGLE_SIN;

          // Create gradient (unavoidable for proper trail effect)
          const gradient = ctx.createLinearGradient(x, y, endX, endY);
          gradient.addColorStop(0, fgColorRef.current);
          gradient.addColorStop(1, 'transparent');

          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x | 0, y | 0);
          ctx.lineTo(endX | 0, endY | 0);
          ctx.stroke();

          shootingStar.x += speed;
          shootingStar.y += speed;

          if (shootingStar.x > width + len || shootingStar.y > height + len) {
            shootingStar = null;
          }
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isAnimating, shootingStars]);

  return <canvas ref={ref || canvasRef} className={cn('fixed top-0 left-0 w-full h-full -z-10 transition-opacity duration-1000 ease-in-out', isAnimating ? 'opacity-100' : 'opacity-0', className)} {...props} />;
});

StarsBackground.displayName = 'StarsBackground';

export { StarsBackground };
