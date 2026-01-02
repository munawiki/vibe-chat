/**
 * Dependency Cruiser rules for this monorepo.
 *
 * Why:
 * - Keep the module graph acyclic to avoid hidden runtime initialization order bugs.
 *
 * Invariants:
 * - No circular dependencies within `packages/**`.
 */

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Disallow circular dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Keep the check scoped to workspace packages.
    includeOnly: {
      path: "^packages",
    },
    doNotFollow: {
      path: "node_modules",
    },
    // Skip generated output folders if they appear.
    exclude: {
      path: "(?:^|/)(?:dist|build|\\.wrangler)(?:/|$)",
    },
  },
};
