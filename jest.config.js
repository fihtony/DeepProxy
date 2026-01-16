module.exports = {
  testEnvironment: "node",
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.js", "!src/index.js", "!src/**/*.test.js", "!src/**/__tests__/**"],
  testMatch: ["**/tests/**/*.test.js", "**/__tests__/**/*.js"],
  testPathIgnorePatterns: ["/node_modules/", "/web/", "/src_backup/"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 85,
      statements: 85,
    },
  },
  setupFilesAfterEnv: ["<rootDir>/tests/helpers/setup.js"],
  verbose: true,
  transform: {
    "^.+\\.js$": "babel-jest",
  },
};
