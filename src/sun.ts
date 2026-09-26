// Fixed-width ASCII frames keep the sun steady in Windows Terminal. Its rays
// spread from the center and return without invoking the emoji renderer.
export const sunFrames = [
  "   .   ",
  "  (o)  ",
  " -(O)- ",
  "\\-(O)-/",
  " -(O)- ",
  "  (o)  "
] as const;

export const sunColors = [
  "#b7791f",
  "#d69e2e",
  "#f6bd44",
  "#ffd166",
  "#f6bd44",
  "#d69e2e"
] as const;
