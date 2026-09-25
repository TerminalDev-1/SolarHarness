export const PET_NAMES = ["cat", "dog", "fox"] as const;
export type PetName = typeof PET_NAMES[number];
export type PetSelection = PetName | "off";

const frames: Record<PetName, readonly [string, string]> = {
  cat: ["=^.^=", "=^-^="],
  dog: ["/^_^\\", "/^o^\\"],
  fox: ["/^v^\\", "/^w^\\"],
};

export function petFrame(pet: PetSelection, tick: number): string {
  return pet === "off" ? "" : frames[pet][Math.floor(tick / 2) % 2];
}

/** Three shaded rows give the small terminal companions visible depth. */
export function petSprite(pet: PetSelection, tick: number): readonly string[] {
  if (pet === "off") return [];
  const blink = Math.floor(tick / 8) % 7 === 0;
  const bounce = tick % 4 < 2;
  const eyes = blink ? "- -" : pet === "dog" ? "O O" : "o o";
  const ears = pet === "cat" ? "/\\_/\\" : pet === "dog" ? "/ \\_/ \\" : "/\\^/\\";
  const muzzle = pet === "cat" ? "^" : pet === "dog" ? "U" : "v";
  return [
    `   ${ears}`,
    `  / ${eyes} \\░`,
    ` /|   ${muzzle}   |\\▒`,
    "  \\_______/▓",
    bounce ? "    ░░░░" : "   ░░░░░░"
  ];
}
