// Ambient declaration for the @higgsfield/client v2 subpath.
//
// The package exposes "@higgsfield/client/v2" only via its package.json
// "exports" map (→ dist/v2/index.js). The backend's tsconfig uses the classic
// moduleResolution "node", which does NOT read exports maps, so tsc cannot
// locate the subpath's bundled types. At runtime Node's CommonJS require DOES
// honor the exports map, so this shim only needs to describe the minimal
// surface illustrationService.ts consumes — config() + higgsfield.subscribe().

declare module "@higgsfield/client/v2" {
  export function config(options: { credentials: string }): void;

  interface HiggsfieldJobResult {
    raw?: { url?: string };
    min?: { url?: string };
  }

  interface HiggsfieldJob {
    status?: string;
    results?: HiggsfieldJobResult;
  }

  interface HiggsfieldJobSet {
    id?: string;
    isCompleted: boolean;
    jobs?: HiggsfieldJob[];
  }

  interface HiggsfieldSubscribeInput {
    prompt: string;
    aspect_ratio?: string;
    safety_tolerance?: number;
    seed?: number;
  }

  interface HiggsfieldSubscribeOptions {
    input: HiggsfieldSubscribeInput;
    withPolling?: boolean;
  }

  export const higgsfield: {
    subscribe(
      model: string,
      options: HiggsfieldSubscribeOptions,
    ): Promise<HiggsfieldJobSet>;
  };
}
