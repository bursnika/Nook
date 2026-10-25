/** Pixel icons are ASCII grids rendered as crisp SVG rects (docs/design.md). `.` is transparent. */
const COLORS: Record<string, string> = {
  O: '#2b1e33',
  P: '#ec4e95',
  p: '#f9c6de',
  L: '#c4abe4',
  l: '#eee6f8',
  B: '#9ec2ec',
  b: '#e3eefb',
  W: '#ffffff',
  G: '#bdb8c6',
};

const ICONS = {
  heart: [
    '.OO...OO.',
    'OPPO.OPPO',
    'OPWPOPPPO',
    'OPPPPPPPO',
    '.OPPPPPO.',
    '..OPPPO..',
    '...OPO...',
    '....O....',
  ],
  folder: [
    '.OOOOO........',
    'OLLLLLOOOOOOOO',
    'OLLLLLLLLLLLLO',
    'OOOOOOOOOOOOOO',
    'OlllllllllbbbO',
    'OllWllllbbbbbO',
    'OllllllbbbWbbO',
    'OllllbbbbbbbbO',
    'OlbbbbbbWbbbBO',
    'ObbbbbbbbbBBBO',
    'OOOOOOOOOOOOOO',
  ],
  tasks: [
    '.OOOOOOOOOO.',
    'OWWWWWWWWWWO',
    'OWOOOWWWWWWO',
    'OWOPOWGGGGWO',
    'OWOOOWWWWWWO',
    'OWWWWWWWWWWO',
    'OWOOOWWWWWWO',
    'OWOWOWGGGGWO',
    'OWOOOWWWWWWO',
    'OWWWWWWWWWWO',
    '.OOOOOOOOOO.',
  ],
  calendar: [
    '..O....O....',
    'OOOOOOOOOOOO',
    'OPPPPPPPPPPO',
    'OPPPPPPPPPPO',
    'OOOOOOOOOOOO',
    'OWWWWWWWWWWO',
    'OWbWbWbWbWWO',
    'OWWWWWWWWWWO',
    'OWbWbWPWbWWO',
    'OWWWWWWWWWWO',
    'OWbWbWbWWWWO',
    'OOOOOOOOOOOO',
  ],
  sparkle: [
    '....O....',
    '....O....',
    '...OLO...',
    '...OLO...',
    'OOOLWLOOO',
    '...OLO...',
    '...OLO...',
    '....O....',
    '....O....',
  ],
  chat: [
    '.OOOOOOOOO.',
    'OLLLLLLLLLO',
    'OLWLLWLLWLO',
    'OLLLLLLLLLO',
    '.OOOLOOOOO.',
    '...OLO.....',
    '....O......',
  ],
  trash: [
    '..OOOOOO..',
    'OOOOOOOOOO',
    'OppppppppO',
    'OOOOOOOOOO',
    '.OpppppppO',
    '.OpPPpPPpO',
    '.OpPPPPPpO',
    '.OppPPPppO',
    '.OpppPpppO',
    '.OppppppppO',
    '..OOOOOOO.',
  ],
  warning: [
    '.....OO.....',
    '....OLLO....',
    '....OLLO....',
    '...OLLLLO...',
    '...OLOOLO...',
    '..OLLOOLLO..',
    '..OLLOOLLO..',
    '.OLLLOOLLLO.',
    '.OLLLLLLLLO.',
    'OLLLLOOLLLLO',
    'OLLLLLLLLLLO',
    'OOOOOOOOOOOO',
  ],
  home: [
    '.....O.....',
    '....OPO....',
    '...OPPPO...',
    '..OPPPPPO..',
    '.OOOOOOOOO.',
    '..OWWWWWO..',
    '..OWWOOWO..',
    '..OWWOOWO..',
    '..OOOOOOO..',
  ],
  page: [
    'OOOOOOO..',
    'OWWWWWOO.',
    'OWGGGWOWO',
    'OWWWWWOOO',
    'OWGGGGGWO',
    'OWWWWWWWO',
    'OWGGGGGWO',
    'OWWWWWWWO',
    'OWGGGWWWO',
    'OWWWWWWWO',
    'OOOOOOOOO',
  ],
  gear: ['...O.O...', '.OOOLOOO.', '.OLLLLLO.', 'OOLLOLLOO', '.OLLLLLO.', '.OOOLOOO.', '...O.O...'],
  plus: ['..OO..', '..OO..', 'OOOOOO', 'OOOOOO', '..OO..', '..OO..'],
  logout: [
    'OOOO......',
    'OWWO..O...',
    'OWWO..OO..',
    'OWWOOOOOO.',
    'OWWOOOOOOO',
    'OWWOOOOOO.',
    'OWWO..OO..',
    'OWWO..O...',
    'OOOO......',
  ],
  lock: [
    '..OOOO..',
    '.O....O.',
    '.O....O.',
    'OOOOOOOO',
    'OLLLLLLO',
    'OLLOOLLO',
    'OLLOOLLO',
    'OLLLLLLO',
    'OOOOOOOO',
  ],
  desktop: [
    'OOOOOOOOOOOO',
    'OBBBBBBBBBBO',
    'OBbbBBBBBBBO',
    'OBBBBBBBBBBO',
    'OBBBBBBBBBBO',
    'OOOOOOOOOOOO',
    '....OOOO....',
    '..OOOOOOOO..',
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const rows: readonly string[] = ICONS[name];
  const width = Math.max(...rows.map((row) => row.length));
  return (
    <svg
      viewBox={`0 0 ${width} ${rows.length}`}
      width={size}
      height={(size * rows.length) / width}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className="pixel-icon"
    >
      {rows.flatMap((row, y) =>
        [...row].map((char, x) =>
          COLORS[char] ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[char]} />
          ) : null,
        ),
      )}
    </svg>
  );
}
