import React from 'react';

interface FariaWordmarkProps {
  height?: number;
  flameColor?: string;
  textColor?: string;
  className?: string;
  style?: React.CSSProperties;
  animate?: boolean;
  flameRef?: React.Ref<SVGPathElement>;
}

const FariaWordmark: React.FC<FariaWordmarkProps> = ({
  height = 80,
  flameColor = 'var(--color-accent)',
  textColor = 'var(--color-text)',
  className,
  style,
  animate = false,
  flameRef,
}) => {
  const VIEWBOX_W = 195;
  const VIEWBOX_H = 92;
  const width = Math.round(VIEWBOX_W * (height / VIEWBOX_H));

  // Center of the flame for scale transform origin
  const flameCx = 141;
  const flameCy = 73;

  return (
    <svg
      width={width}
      height={height}
      viewBox="10 45 195 92"
      fill="none"
      className={className}
      style={style}
    >
      {animate && !flameRef && (
        <style>{`
          @keyframes flame-breathe {
            0%, 100% { transform: scale(1) translateY(0); opacity: 0.85; }
            50% { transform: scale(1.18) translateY(-2.5px); opacity: 1; }
          }
          .flame-breathing {
            animation: flame-breathe 3s ease-in-out infinite;
            transform-origin: ${flameCx}px ${flameCy}px;
          }
        `}</style>
      )}
      {/* Flame (dot of "i") */}
      <path
        ref={flameRef}
        className={animate && !flameRef ? 'flame-breathing' : undefined}
        style={flameRef ? { transformOrigin: `${flameCx}px ${flameCy}px` } : undefined}
        d="m 143.95251,75.736798 c 3.00528,-3.205288 1.53472,-7.176438 0,-8.446621 -0.16811,4.075092 -4.53139,6.058604 -6.41096,9.115675 -0.65704,1.070178 -1.13772,2.203772 -0.90132,4.007171 0.14822,1.133971 1.77901,4.984294 6.31039,4.306989 -1.21765,-1.085564 -2.02704,-2.079198 -1.82666,-3.882218 0.30056,-2.303967 1.42628,-3.498352 2.82855,-5.100996 z m -2.23567,-7.576818 c -2.50435,3.90661 -7.88151,6.342661 -7.31266,11.884185 0.1925,1.90321 1.73511,4.675847 3.63832,5.076603 -6.21058,-0.568863 -11.28718,-7.011712 -6.81171,-14.324361 1.77113,-2.89309 5.70963,-4.708119 7.11227,-7.713405 1.30208,-2.604155 0.20038,-6.010197 -2.70472,-6.811707 2.80491,-0.400378 6.35504,1.835294 7.14417,4.60793 0.73734,2.572262 0.33659,5.177167 -1.06567,7.280755"
        fill={flameColor}
        fillRule="nonzero"
      />
      {/* "i" stem */}
      <rect
        x={134.1162}
        y={91.386}
        width={6.8207}
        height={40.206}
        fill={textColor}
      />
      {/* "Far" */}
      <text
        xmlSpace="preserve"
        style={{
          fontSize: '74.0872px',
          fontFamily: "'Noto Sans JP'",
          textAnchor: 'start',
          fill: textColor,
        }}
        x={18.914}
        y={131.672}
      >
        Far
      </text>
      {/* "a" (after the i) */}
      <text
        xmlSpace="preserve"
        style={{
          fontSize: '74.0872px',
          fontFamily: "'Noto Sans JP'",
          textAnchor: 'start',
          fill: textColor,
        }}
        x={147.819}
        y={131.668}
      >
        a
      </text>
    </svg>
  );
};

export default FariaWordmark;
