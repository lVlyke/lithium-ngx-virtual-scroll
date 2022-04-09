#!/usr/bin/env node
//@ts-check

import fs from "fs-extra";
import child_process from "child_process";

const BUILD_DIR = "./spec/build";

(function main() {
    fs.removeSync(BUILD_DIR);

    child_process.execSync("ngc --p ./spec", { stdio: "inherit" });
})();