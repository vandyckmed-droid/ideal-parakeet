import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * The small in-row trace. Deliberately axis-free and label-free: at this size
 * it conveys shape only, and the precise numbers live in the adjacent column.
 */
export const Sparkline = React.memo(function Sparkline({
  values,
  color,
  width = 64,
  height = 26,
  strokeWidth = 1.6,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  const d = useMemo(() => {
    if (values.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // A perfectly flat series would divide by zero; draw it down the middle.
    const span = max - min || 1;
    const pad = strokeWidth / 2;
    const usable = height - strokeWidth;

    // Cap the point count so a 500-session series does not emit a 500-command
    // path for 64 logical pixels of width.
    const maxPoints = Math.min(values.length, 60);
    const step = (values.length - 1) / (maxPoints - 1);

    let path = '';
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round(i * step);
      const x = (i / (maxPoints - 1)) * width;
      const y = pad + (1 - (values[idx] - min) / span) * usable;
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return path;
  }, [values, width, height, strokeWidth]);

  if (!d) return <Svg width={width} height={height} />;

  return (
    <Svg width={width} height={height}>
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
});
