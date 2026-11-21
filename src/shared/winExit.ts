/** Plain words for the numbers a Windows program stops with when it cannot even start. */
export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

export function explainExit(code: number | null | undefined, signal?: string | null, platform: string = typeof process !== 'undefined' ? process.platform : 'win32'): string {
  if (platform === 'win32' && typeof code === 'number') {
    const hex = `0x${(code >>> 0).toString(16).toUpperCase()}`
    switch (code >>> 0) {
      case 0xc0000135: return `Windows could not start the program because a part it needs is missing (usually the Microsoft Visual C++ runtime, error ${hex}). Install it from ${VC_REDIST_URL} and try again.`
      case 0xc000007b: return `Windows could not start the program because of a mismatched system file (error ${hex}). Installing the Microsoft Visual C++ runtime from ${VC_REDIST_URL} usually fixes it.`
      case 0xc0000005: case 0xc0000409: return `The program crashed while starting (error ${hex}). If this keeps happening, update your graphics driver and try again.`
      case 0xc0000142: return `The program could not initialise (error ${hex}). Restarting the computer or reinstalling the program usually fixes it.`
    }
  }
  if (signal) return `The program was stopped (${signal}).`
  return `The program stopped with code ${code ?? 'unknown'}.`
}
