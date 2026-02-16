import React from 'react';

interface FariaLogoProps {
  size?: number;
  flameColor?: string;
  handleColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

const VIEWBOX_W = 114;
const VIEWBOX_H = 331;

const FariaLogo: React.FC<FariaLogoProps> = ({
  size = 48,
  flameColor = 'var(--color-accent)',
  handleColor = 'var(--color-text)',
  className,
  style,
}) => {
  const width = size * (VIEWBOX_W / VIEWBOX_H);

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      fill="none"
      className={className}
      style={style}
    >
      {/* Flame */}
      <path
        d="M 100.910156 136.324219 C 121.84375 113.992188 111.601562 86.332031 100.910156 77.480469 C 99.738281 105.871094 69.339844 119.6875 56.25 140.984375 C 51.671875 148.4375 48.320312 156.335938 49.96875 168.898438 C 51.003906 176.796875 62.363281 203.621094 93.929688 198.90625 C 85.445312 191.339844 79.808594 184.417969 81.203125 171.855469 C 83.296875 155.808594 91.140625 147.488281 100.910156 136.324219 Z M 85.335938 83.539062 C 67.890625 110.753906 30.429688 127.726562 34.394531 166.332031 C 35.734375 179.589844 46.480469 198.90625 59.738281 201.695312 C 16.472656 197.734375 -18.890625 152.847656 12.285156 101.90625 C 24.625 81.753906 52.0625 69.109375 61.832031 48.175781 C 70.902344 30.03125 63.226562 6.304688 42.988281 0.722656 C 62.53125 -2.070312 87.261719 13.507812 92.761719 32.820312 C 97.894531 50.742188 95.105469 68.886719 85.335938 83.539062"
        fill={flameColor}
        fillRule="nonzero"
      />
      {/* Handle */}
      <rect
        x={29.601562}
        y={226.25}
        width={52.769532}
        height={104.75}
        fill={handleColor}
      />
    </svg>
  );
};

export default FariaLogo;
