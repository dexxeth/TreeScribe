import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";

const DEFAULT_IGNORE_PATTERNS = [
	"node_modules",
	".next",
	".nuxt",
	".svelte-kit",
	"dist",
	"build",
	"out",
	".cache",
	".turbo",
	"__pycache__",
	".venv",
	"venv",
	"env",
	".git",
	".svn",
	".hg",
	".DS_Store",
	"Thumbs.db",
	"coverage",
	".nyc_output",
	".idea",
	".vscode",
	"*.suo",
	"*.user",
	"target",
	"vendor",
	".terraform",
	"Pods",
	"project_tree.md",
	"project_tree.json",
	"project_tree.html",
	".vs",
];

function normalizeForIgnore(relativePath: string): string {
	return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

async function readIgnoreFile(
	rootPath: string,
	fileName: string,
): Promise<string[]> {
	try {
		const content = await fs.readFile(
			path.join(rootPath, fileName),
			"utf8",
		);
		return content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
	} catch {
		return [];
	}
}

export async function createIgnoreMatcher(
	rootPath: string,
	additionalIgnore: string[],
): Promise<(relativePath: string, isDirectory: boolean) => boolean> {
	const matcher = ignore();

	const gitignorePatterns = await readIgnoreFile(rootPath, ".gitignore");
	const projectTreeIgnorePatterns = await readIgnoreFile(
		rootPath,
		".projecttreeignore",
	);

	matcher.add(DEFAULT_IGNORE_PATTERNS);
	matcher.add(gitignorePatterns);
	matcher.add(projectTreeIgnorePatterns);
	matcher.add(additionalIgnore);

	return (relativePath: string, isDirectory: boolean): boolean => {
		const normalized = normalizeForIgnore(relativePath);
		if (!normalized) {
			return false;
		}

		// Directory checks use a trailing slash to match ignore patterns that are directory-specific.
		if (isDirectory && matcher.ignores(`${normalized}/`)) {
			return true;
		}

		return matcher.ignores(normalized);
	};
}
