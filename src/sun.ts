// Keep a solid, rounded disk in every frame; only the rays and warmth pulse.
// All frames occupy five rows by eleven columns, keeping the activity label still.
const nearRays = [
  "  \\  |  /  ",
  "   .---.   ",
  " -(*****)- ",
  "   '---'   ",
  "  /  |  \\  "
] as const;

const middleRays = [
  " \\   |   / ",
  "   .---.   ",
  "--(*****)--",
  "   '---'   ",
  " /   |   \\ "
] as const;

const farRays = [
  "\\    |    /",
  "   .---.   ",
  "--(*****)--",
  "   '---'   ",
  "/    |    \\"
] as const;

export const sunFrames = [nearRays, middleRays, farRays, farRays, middleRays, nearRays] as const;
export const sunColors = ["#f6bd44", "#ffc857", "#ffd166", "#ffe08a", "#ffd166", "#ffc857"] as const;
