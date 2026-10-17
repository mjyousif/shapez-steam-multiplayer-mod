const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIRS_TO_CHECK = [
    path.join(ROOT_DIR, "src"),
    path.join(ROOT_DIR, "scripts"),
    path.join(ROOT_DIR, "tests"),
];

function getJsFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
        const fullPath = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            results = results.concat(getJsFiles(fullPath));
        } else if (ent.isFile() && ent.name.endsWith(".js")) {
            results.push(fullPath);
        }
    }
    return results;
}

function main() {
    console.log("=== Checking JavaScript Syntax (node --check) ===");

    let totalChecked = 0;
    let errors = 0;

    for (const dir of DIRS_TO_CHECK) {
        const files = getJsFiles(dir);
        for (const f of files) {
            const rel = path.relative(ROOT_DIR, f);
            try {
                execFileSync(process.execPath, ["--check", f], {
                    stdio: ["ignore", "ignore", "pipe"],
                });
                console.log(` [PASS] ${rel}`);
                totalChecked++;
            } catch (err) {
                console.error(` [FAIL] ${rel}`);
                if (err.stderr) console.error(err.stderr.toString());
                errors++;
            }
        }
    }

    console.log(`\nChecked ${totalChecked} files. Failures: ${errors}`);
    if (errors > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, getJsFiles };
