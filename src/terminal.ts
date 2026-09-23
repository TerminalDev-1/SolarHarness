const green = (value: string) => `\u001B[38;5;46m${value}\u001B[0m`;
const dimGreen = (value: string) => `\u001B[38;5;28m${value}\u001B[0m`;

export const terminal = {
  logo(): void {
    console.log(green(`
   ███████╗ ██████╗ ██╗      █████╗ ██████╗
   ██╔════╝██╔═══██╗██║     ██╔══██╗██╔══██╗
   ███████╗██║   ██║██║     ███████║██████╔╝
   ╚════██║██║   ██║██║     ██╔══██║██╔══██╗
   ███████║╚██████╔╝███████╗██║  ██║██║  ██║
   ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
      ▓▓▓  H A R N E S S  ▓▓▓
`));
  },
  solar(message: string): void { console.log(green(`Solar › ${message}`)); },
  subAgent(id: string, message: string): void { console.log(dimGreen(`  [${id}] ${message}`)); },
  error(message: string): void { console.error(`\u001B[38;5;196mSolar › ${message}\u001B[0m`); },
  prompt(): string { return green("solar › "); }
};
