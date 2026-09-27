import { spawn } from "node:child_process";
import { join } from "node:path";
import { IMAGE_EXTENSIONS } from "./images.js";
import { solarDirectory } from "./solar-dir.js";

/** Opens the system file picker for images and returns the chosen paths (empty if cancelled). */
export async function pickImageFiles(): Promise<string[]> {
  if (process.platform === "win32") {
    return imagePaths(await powershell([
      "Add-Type -AssemblyName System.Windows.Forms",
      "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
      "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
      "$dialog.Title = 'Add images for Solar'",
      "$dialog.Filter = 'Images|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp'",
      "$dialog.Multiselect = $true",
      "if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.FileNames }"
    ]));
  }
  if (process.platform === "darwin") {
    return imagePaths(await run("osascript", ["-e", 'set picked to choose file with prompt "Add images for Solar" of type {"public.image"} with multiple selections allowed', "-e",
      'set out to ""', "-e", "repeat with f in picked", "-e", "set out to out & POSIX path of f & linefeed", "-e", "end repeat", "-e", "out"]));
  }
  return imagePaths(await run("zenity", ["--file-selection", "--multiple", "--separator=\n", "--title=Add images for Solar", "--file-filter=Images | *.png *.jpg *.jpeg *.gif *.webp *.bmp"]));
}

/**
 * Attaches whatever image is on the clipboard: a copied picture is saved as a PNG under
 * .solarharness/pasted, and copied image files are used where they are. Returns [] if none.
 */
export async function pasteClipboardImages(workspace: string): Promise<string[]> {
  const target = join(await solarDirectory(workspace, "pasted"), `clipboard-${Date.now()}.png`);
  if (process.platform === "win32") {
    return imagePaths(await powershell([
      "Add-Type -AssemblyName System.Windows.Forms",
      "$files = [System.Windows.Forms.Clipboard]::GetFileDropList()",
      "if ($files.Count -gt 0) { $files; exit }",
      "$image = [System.Windows.Forms.Clipboard]::GetImage()",
      `if ($image) { $image.Save('${target.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); '${target.replace(/'/g, "''")}' }`
    ]));
  }
  if (process.platform === "darwin") {
    return imagePaths(await run("osascript", ["-e", `set f to open for access POSIX file "${target}" with write permission`, "-e",
      "write (the clipboard as «class PNGf») to f", "-e", "close access f", "-e", `"${target}"`]));
  }
  const png = await run("sh", ["-c", `xclip -selection clipboard -t image/png -o > '${target.replace(/'/g, "'\\''")}' && echo '${target.replace(/'/g, "'\\''")}'`]);
  return imagePaths(png);
}

function imagePaths(output: string): string[] {
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => IMAGE_EXTENSIONS.test(line));
}

function powershell(lines: string[]): Promise<string> {
  // -STA is required for the clipboard and dialog APIs.
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", lines.join("; ")]);
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("error", error => reject(new Error(`${command} is not available: ${error.message}`)));
    child.on("close", code => {
      // A cancelled picker exits non-zero with no output (zenity) or error -128 (macOS).
      if (code === 0 || stdout.trim() || !stderr.trim() || /-128/.test(stderr)) resolve(stdout);
      else reject(new Error(stderr.trim()));
    });
  });
}
