import React, { useRef, useState, useEffect } from 'react';

interface FariaWordmarkProps {
  height?: number;
  flameColor?: string;
  textColor?: string;
  className?: string;
  style?: React.CSSProperties;
  animate?: boolean;
  flameRef?: React.Ref<SVGPathElement>;
}

// Original flame path data (from Inkscape SVG, unscaled).
// Bounding box ≈ x:[132..146], y:[56..97] → center ~139, ~76
const FLAME_PATH = 'm 146.0252,87.432859 c 3.00528,-3.205288 1.53472,-7.176438 0,-8.446621 -0.16811,4.075092 -4.53139,6.058604 -6.41096,9.115675 -0.65704,1.070178 -1.13772,2.203772 -0.90132,4.007171 0.14822,1.133971 1.77901,4.984294 6.31039,4.306989 -1.21765,-1.085564 -2.02704,-2.079198 -1.82666,-3.882218 0.30056,-2.303967 1.42628,-3.498352 2.82855,-5.100996 z m -2.23567,-7.576818 c -2.50435,3.90661 -7.88151,6.342661 -7.31266,11.884185 0.1925,1.90321 1.73511,4.675847 3.63832,5.076603 -6.21058,-0.568863 -11.28718,-7.011712 -6.81171,-14.324361 1.77113,-2.89309 5.70963,-4.708119 7.11227,-7.713405 1.30208,-2.604155 0.20038,-6.010197 -2.70472,-6.811707 2.80491,-0.400378 6.35504,1.835294 7.14417,4.60793 0.73734,2.572262 0.33659,5.177167 -1.06567,7.280755';
// Flame bounding box in original path coordinates
const FLAME_X = 132;
const FLAME_Y = 56;
const FLAME_W = 14;
const FLAME_H = 41;

const FariaWordmark: React.FC<FariaWordmarkProps> = ({
  height = 80,
  flameColor = 'var(--color-accent)',
  textColor = 'var(--color-text)',
  className,
  style,
  animate = false,
  flameRef,
}) => {
  const VIEWBOX_W = 155;
  const VIEWBOX_H = 70;
  const FONT_SIZE = 54;
  const TEXT_Y = 58;
  const width = Math.round(VIEWBOX_W * (height / VIEWBOX_H));

  const iTspanRef = useRef<SVGTSpanElement>(null);
  const [iBox, setIBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = iTspanRef.current;
      if (!el) return;
      const len = el.getNumberOfChars();
      if (len === 0) return;
      // getExtentOfChar gives the glyph bounding box in SVG user units
      const ext = el.getExtentOfChar(0);
      setIBox({ x: ext.x, y: ext.y, w: ext.width, h: ext.height });
    };
    // Measure after font loads
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure);
    } else {
      // Fallback: measure on next frame
      requestAnimationFrame(measure);
    }
  }, []);

  // Compute stem and flame positions from measured "i" glyph box.
  // getExtentOfChar returns the full glyph cell (advance width + full ascent/descent),
  // so we derive the thin visual stem from the font size, not the box dimensions.
  // In the original SVG: stem width = 6.725 at fontSize 74.0872 → ~9.07% of fontSize.
  // Stem height = 38.311 at fontSize 74.0872 → ~51.7% of fontSize.
  const stemW = iBox ? FONT_SIZE * 0.091 : 0;
  const stemH = iBox ? FONT_SIZE * 0.517 : 0;
  // Center the stem horizontally within the glyph box
  const stemX = iBox ? iBox.x + (iBox.w - stemW) / 2 : 0;
  // Position stem bottom to align with text baseline (TEXT_Y), top derived from height
  const stemY = iBox ? TEXT_Y - stemH : 0;

  // Flame: scale to sit above the stem, roughly 2.5x stem width
  const flameTargetW = stemW * 2.5;
  const flameTargetH = iBox ? (stemY - iBox.y) * 1.3 : 0;
  const flameScale = iBox ? Math.min(flameTargetW / FLAME_W, flameTargetH / FLAME_H) : 0;
  const flameTx = iBox ? (stemX + stemW / 2) - (FLAME_X + FLAME_W / 2) * flameScale : 0;
  const flameTy = iBox ? (stemY - 4) - (FLAME_Y + FLAME_H) * flameScale : 0;

  const flameCx = iBox ? stemX + stemW / 2 : 0;
  const flameCy = iBox ? stemY - flameTargetH / 2 : 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
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
      {/* Full word "Faria" — browser handles kerning natively */}
      <text
        xmlSpace="preserve"
        style={{
          fontSize: `${FONT_SIZE}px`,
          fontFamily: "'Bricolage Grotesque'",
          textAnchor: 'middle',
          fill: textColor,
        }}
        x={VIEWBOX_W / 2}
        y={TEXT_Y}
      >
        Far<tspan ref={iTspanRef} fill="transparent">i</tspan>a
      </text>
      {iBox && (
        <>
          {/* "i" stem */}
          <rect
            x={stemX}
            y={stemY}
            width={stemW}
            height={stemH}
            fill={textColor}
          />
          {/* Flame (replaces dot of "i") */}
          <path
            ref={flameRef}
            className={animate && !flameRef ? 'flame-breathing' : undefined}
            style={flameRef ? { transformOrigin: `${flameCx}px ${flameCy}px` } : undefined}
            d={FLAME_PATH}
            transform={`translate(${flameTx},${flameTy}) scale(${flameScale})`}
            fill={flameColor}
            fillRule="nonzero"
          />
        </>
      )}
    </svg>
  );
};

export default FariaWordmark;
