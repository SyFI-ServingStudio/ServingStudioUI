import { Box } from '@mui/material';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function SelectionBoundary({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [boundaryGeometry, setBoundaryGeometry] = useState({ width: 0, height: 0, radius: 0 });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const updateSize = () => {
      const bounds = svg.getBoundingClientRect();
      const parentRadius =
        Number.parseFloat(getComputedStyle(svg.parentElement ?? svg).borderTopLeftRadius) || 0;
      setBoundaryGeometry((current) =>
        current.width === bounds.width &&
        current.height === bounds.height &&
        current.radius === parentRadius
          ? current
          : { width: bounds.width, height: bounds.height, radius: parentRadius },
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const { width, height, radius: parentRadius } = boundaryGeometry;
  const inset = 1;
  // The stroke's outer edge must follow the card's CSS radius exactly. Since
  // the 2 px stroke is centred 1 px inward, its centreline radius is 1 px less.
  const radius = Math.min(
    Math.max(0, parentRadius - inset),
    Math.max(0, height / 2 - inset),
    Math.max(0, width / 2 - inset),
  );
  const middleY = height / 2;
  const leftX = inset;
  const rightX = Math.max(inset, width - inset);
  const topY = inset;
  const bottomY = Math.max(inset, height - inset);
  // Keep the complete left edge visible, then grow both halves from the two
  // left corners until they meet at the middle of the right edge.
  const leftPath = `M ${leftX + radius} ${topY} Q ${leftX} ${topY} ${leftX} ${topY + radius} L ${leftX} ${bottomY - radius} Q ${leftX} ${bottomY} ${leftX + radius} ${bottomY}`;
  const topPath = `M ${leftX + radius} ${topY} L ${rightX - radius} ${topY} Q ${rightX} ${topY} ${rightX} ${topY + radius} L ${rightX} ${middleY}`;
  const bottomPath = `M ${leftX + radius} ${bottomY} L ${rightX - radius} ${bottomY} Q ${rightX} ${bottomY} ${rightX} ${bottomY - radius} L ${rightX} ${middleY}`;
  const boundaryProgress = useMotionValue(0);

  useEffect(() => {
    if (width <= 0 || height <= 0) return undefined;
    if (reduceMotion) {
      boundaryProgress.set(1);
      return undefined;
    }
    boundaryProgress.set(0);
    const animation = animate(boundaryProgress, 1, {
      duration: 0.9,
      ease: [0.4, 0, 0.2, 1],
    });
    return () => animation.stop();
  }, [boundaryProgress, height, reduceMotion, width]);

  return (
    <Box
      component="svg"
      ref={svgRef}
      aria-hidden="true"
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {width > 0 && height > 0 && (
        <>
          <path
            d={leftPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <motion.path
            d={topPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: boundaryProgress, filter: `drop-shadow(0 0 3px ${color}55)` }}
          />
          <motion.path
            d={bottomPath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: boundaryProgress, filter: `drop-shadow(0 0 3px ${color}55)` }}
          />
        </>
      )}
    </Box>
  );
}
