import fs from "fs";
import path from "path";
import archiver from "archiver";

// Create a release zip containing the plugin files expected by Obsidian
const outName = process.env.OUT_NAME || "notion-sync-release.zip";
const outPath = path.resolve(process.cwd(), outName);

const files = [
  "manifest.json",
  "main.js",
  "styles.css",
  "README.md",
];

async function run() {
  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    console.log(`${archive.pointer()} total bytes`);
    console.log(`Created ${outPath}`);
  });

  archive.on("warning", (err) => {
    if (err.code === "ENOENT") console.warn(err.message);
    else throw err;
  });

  archive.on("error", (err) => {
    throw err;
  });

  archive.pipe(output);

  for (const f of files) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) {
      archive.file(p, { name: path.basename(f) });
    } else {
      console.warn(`Skipping missing file: ${f}`);
    }
  }

  await archive.finalize();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
