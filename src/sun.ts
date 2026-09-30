// A five-line solar halo breathes around a rounded core. All rows stay eleven
// columns wide so the adjacent activity text never moves in Windows Terminal.
export const sunFrames = [
  [
    "           ",
    "           ",
    "     .     ",
    "           ",
    "           "
  ],
  [
    "     |     ",
    "    .-.    ",
    "  --(o)--  ",
    "    '-'    ",
    "     |     "
  ],
  [
    "  \\  |  /  ",
    "   .---.   ",
    " --(ooo)-- ",
    "   '---'   ",
    "  /  |  \\  "
  ],
  [
    "\\    |    /",
    "  .-----.  ",
    "--(ooooo)--",
    "  '-----'  ",
    "/    |    \\"
  ],
  [
    "  \\  |  /  ",
    "   .---.   ",
    " --(ooo)-- ",
    "   '---'   ",
    "  /  |  \\  "
  ],
  [
    "     |     ",
    "    .-.    ",
    "  --(o)--  ",
    "    '-'    ",
    "     |     "
  ]
] as const;

export const sunColors = [
  "#b7791f",
  "#d69e2e",
  "#f6bd44",
  "#ffd166",
  "#f6bd44",
  "#d69e2e"
] as const;
