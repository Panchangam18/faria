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

// Original wordmark geometry from the source Inkscape SVG.
const FLAME_PATH = 'm 146.0252,87.432859 c 3.00528,-3.205288 1.53472,-7.176438 0,-8.446621 -0.16811,4.075092 -4.53139,6.058604 -6.41096,9.115675 -0.65704,1.070178 -1.13772,2.203772 -0.90132,4.007171 0.14822,1.133971 1.77901,4.984294 6.31039,4.306989 -1.21765,-1.085564 -2.02704,-2.079198 -1.82666,-3.882218 0.30056,-2.303967 1.42628,-3.498352 2.82855,-5.100996 z m -2.23567,-7.576818 c -2.50435,3.90661 -7.88151,6.342661 -7.31266,11.884185 0.1925,1.90321 1.73511,4.675847 3.63832,5.076603 -6.21058,-0.568863 -11.28718,-7.011712 -6.81171,-14.324361 1.77113,-2.89309 5.70963,-4.708119 7.11227,-7.713405 1.30208,-2.604155 0.20038,-6.010197 -2.70472,-6.811707 2.80491,-0.400378 6.35504,1.835294 7.14417,4.60793 0.73734,2.572262 0.33659,5.177167 -1.06567,7.280755';
const VIEWBOX_X = 12;
const VIEWBOX_Y = 66;
const VIEWBOX_W = 168;
const VIEWBOX_H = 80;
const A_X_OFFSET = -7.3;
const STEM_X_OFFSET = -8;
const STEM_Y_OFFSET = .8;
const STEM_WIDTH = 6.95;
const FLAME_X_OFFSET = -6.8;
const FLAME_Y_OFFSET = 13.8;
const FLAME_TRANSLATE_X = -0.7322149;
const FLAME_TRANSLATE_Y = -12.2209932;
const FLAME_CX = 138.2677851;
const FLAME_CY = 64.2790068;

const FariaWordmark: React.FC<FariaWordmarkProps> = ({
  height = 80,
  flameColor = 'var(--color-accent)',
  textColor = 'var(--color-text)',
  className,
  style,
  animate = false,
  flameRef,
}) => {
  const width = Math.round(VIEWBOX_W * (height / VIEWBOX_H));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${VIEWBOX_X} ${VIEWBOX_Y} ${VIEWBOX_W} ${VIEWBOX_H}`}
      fill="none"
      className={className}
      style={style}
    >
      {animate && !flameRef && (
        <style>{`
          @keyframes flame-breathe {
            0%, 100% { opacity: 0.6; }
            20%, 80% { opacity: 1; }
          }
          .flame-breathing {
            animation: flame-breathe 6s ease-in-out infinite;
          }
        `}</style>
      )}
      <text
        xmlSpace="preserve"
        style={{
          fontSize: '74.0872px',
          fontFamily: "'Bricolage Grotesque'",
          textAnchor: 'start',
          fill: textColor,
        }}
        x={19.527618}
        y={141.34897}
      >Far</text>
      <text
        xmlSpace="preserve"
        style={{
          fontSize: '74.0872px',
          fontFamily: "'Bricolage Grotesque'",
          textAnchor: 'start',
          fill: textColor,
        }}
        x={148.8922 + A_X_OFFSET}
        y={141.72099}
      >a</text>
      <rect
        x={136.3123 + STEM_X_OFFSET - ((STEM_WIDTH - 6.725) / 2)}
        y={103.01218 + STEM_Y_OFFSET}
        width={STEM_WIDTH}
        height={38.311085}
        fill={textColor}
      />
      <path
        ref={flameRef}
        className={animate && !flameRef ? 'flame-breathing' : undefined}
        style={flameRef ? { transformOrigin: `${FLAME_CX + FLAME_X_OFFSET}px ${FLAME_CY + FLAME_Y_OFFSET}px` } : undefined}
        d={FLAME_PATH}
        transform={`translate(${FLAME_TRANSLATE_X + FLAME_X_OFFSET},${FLAME_TRANSLATE_Y + FLAME_Y_OFFSET})`}
        fill={flameColor}
        fillRule="nonzero"
      />
    </svg>
  );
};

export default FariaWordmark;
