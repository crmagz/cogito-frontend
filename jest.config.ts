import type { Config } from "jest";

const config: Config = {
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  testEnvironment: "jsdom",
  transform: { "^.+\\.(ts|tsx)$": ["ts-jest", { useESM: true }] }
};

export default config;
