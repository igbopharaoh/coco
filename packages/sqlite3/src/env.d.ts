declare function setTimeout(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): number;

declare const process: {
  env: Record<string, string | undefined>;
};
