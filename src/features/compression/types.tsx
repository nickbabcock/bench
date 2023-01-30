export type CompressionProfileData = {
  algorithm: string;
  elapsedMs: number;
  size: number;
};

export type BenchmarkProfile =
  | ({
      action: "compression";
    } & CompressionProfileData)
  | {
      action: "decompression";
      algorithm: string;
      elapsedMs: number;
    };
