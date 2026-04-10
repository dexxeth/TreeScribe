import { promises as fs } from "node:fs";
import path from "node:path";

const ICONS_METADATA_PATH = path.join(
	"node_modules",
	"vscode-icons-js",
	"data",
	"generated",
	"icons.json",
);
const OUTPUT_DIR = path.join("assets", "icons");
const ICONS_BASE_URL =
	"https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";
const CONCURRENCY = 16;

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function collectIconFiles(iconsJson) {
	const definitions = iconsJson.iconDefinitions ?? {};
	const iconFiles = new Set();

	for (const value of Object.values(definitions)) {
		if (!value || typeof value !== "object") {
			continue;
		}

		const iconPath = value.iconPath;
		if (typeof iconPath !== "string" || !iconPath.endsWith(".svg")) {
			continue;
		}

		iconFiles.add(path.basename(iconPath));
	}

	return Array.from(iconFiles).sort();
}

async function downloadIcon(iconFile) {
	const response = await fetch(`${ICONS_BASE_URL}/${iconFile}`);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const svg = await response.text();
	await fs.writeFile(path.join(OUTPUT_DIR, iconFile), svg, "utf8");
}

async function run() {
	const iconsJsonRaw = await fs.readFile(ICONS_METADATA_PATH, "utf8");
	const iconsJson = JSON.parse(iconsJsonRaw);
	const iconFiles = collectIconFiles(iconsJson);

	if (iconFiles.length === 0) {
		throw new Error("No icon files discovered in icons metadata.");
	}

	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	let existing = 0;
	let downloaded = 0;
	let failed = 0;
	let cursor = 0;

	const workers = Array.from({ length: CONCURRENCY }, async () => {
		while (true) {
			const index = cursor;
			cursor += 1;

			if (index >= iconFiles.length) {
				break;
			}

			const iconFile = iconFiles[index];
			const outputPath = path.join(OUTPUT_DIR, iconFile);

			if (await fileExists(outputPath)) {
				existing += 1;
				continue;
			}

			try {
				await downloadIcon(iconFile);
				downloaded += 1;
			} catch (error) {
				failed += 1;
				console.warn(
					`Failed to download ${iconFile}: ${String(error)}`,
				);
			}
		}
	});

	await Promise.all(workers);

	console.log(
		`Icon vendoring complete. total=${iconFiles.length} downloaded=${downloaded} existing=${existing} failed=${failed}`,
	);

	if (failed > 0) {
		process.exitCode = 1;
	}
}

run().catch((error) => {
	console.error(`Icon vendoring failed: ${String(error)}`);
	process.exitCode = 1;
});
