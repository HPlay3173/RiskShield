declare const __RISKSHIELD_COMMIT__: string;

export const PRODUCT_VERSION = "0.5.0-alpha.1" as const;
export const SOURCE_COMMIT = typeof __RISKSHIELD_COMMIT__ === "string"
  ? __RISKSHIELD_COMMIT__
  : "development";
