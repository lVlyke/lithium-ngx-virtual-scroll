#!/usr/bin/env node
//@ts-check

import child_process from "child_process";

const [
    NODE_MAJOR_VER,
    NODE_MINOR_VER
] = process.versions.node.split(".").map(Number);

(function main() {
    // Determine which Node flags to pass to allow extensionless imports
    let NODE_OPTS;
    if (NODE_MAJOR_VER < 19) {
        NODE_OPTS = "--es-module-specifier-resolution=node";
    } else if (NODE_MAJOR_VER <= 20 && NODE_MINOR_VER < 6) {
        NODE_OPTS = "--experimental-loader=extensionless";
    } else {
        NODE_OPTS = "--import=extensionless/register";
    }

    // Run tests and generate coverage reports
    child_process.execSync(`NODE_OPTIONS=${NODE_OPTS} npx c8 jasmine`, { stdio: "inherit" });

    // Generate coverage badge
    child_process.execSync("npx istanbul-cobertura-badger -b coverage -e 90 -r coverage/cobertura-coverage.xml -d coverage/", { stdio: "inherit" });
})();
