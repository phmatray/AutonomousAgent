import { useEffect, useState } from 'react';
import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [dashOffset, setDashOffset] = useState(1000);

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // Animate dash offset from 1000 to 0 on mount (draw-in effect)
  useEffect(() => {
    // Small delay to ensure the element is mounted before animating
    const frame = requestAnimationFrame(() => {
      setDashOffset(0);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        strokeDasharray: 1000,
        strokeDashoffset: dashOffset,
        transition: 'stroke-dashoffset 0.5s ease-out',
      }}
    />
  );
}
