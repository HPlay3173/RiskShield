declare const __RISKSHIELD_COMMIT__: string;

export const PRODUCT_VERSION = "0.5.0-alpha.1" as const;
/** Increment with each production Sites release so screenshots and API evidence identify the deployment. */
export const SITES_VERSION = 50 as const;
export const SOURCE_COMMIT = typeof __RISKSHIELD_COMMIT__ === "string"
  ? __RISKSHIELD_COMMIT__
  : "development";
