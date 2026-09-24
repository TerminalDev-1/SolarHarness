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
