import { promises as fs } from "node:fs";
import path from "node:path";
import {
	SkipReason,
	TreeBuildOptions,
	TreeBuildResult,
	TreeNode,
	TreeStats,
} from "./types";

const KNOWN_BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".pdf",
	".zip",
	".gz",
	".tar",
	".7z",
	".rar",
	".jar",
	".exe",
	".dll",
	".so",
	".dylib",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp3",
	".mp4",
	".mov",
	".avi",
	".wav",
	".webm",
	".sqlite",
	".db",
]);

function toRelativePath(parentRelative: string, name: string): string {
	if (!parentRelative) {
		return name;
	}
	return `${parentRelative}/${name}`;
}

async function isBinaryFile(
	filePath: string,
	extension: string,
): Promise<boolean> {
	if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
		return true;
	}

	try {
		const handle = await fs.open(filePath, "r");
		const buffer = Buffer.alloc(512);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		await handle.close();

		for (let i = 0; i < bytesRead; i += 1) {
			if (buffer[i] === 0) {
				return true;
			}
		}
	} catch {
		return false;
	}

	return false;
}

function createInitialStats(): TreeStats {
	return {
		files: 0,
		directories: 0,
		maxDepthReached: 0,
		ignored: 0,
		skipped: 0,
		skippedByReason: {
			binarySkipped: 0,
			symlinkSkipped: 0,
			circularSymlink: 0,
			permissionDenied: 0,
			fsError: 0,
		},
		totalSizeBytes: 0,
		extensionCounts: {},
	};
}

function classifyFsSkipReason(error: unknown): SkipReason {
	const code =
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code?: string }).code ?? "")
			: "";

	if (code === "EACCES" || code === "EPERM") {
		return "permissionDenied";
	}

	return "fsError";
}

function incrementSkip(stats: TreeStats, reason: SkipReason): void {
	stats.skipped += 1;
	stats.skippedByReason[reason] += 1;
}

function trackExtension(stats: TreeStats, extension: string): void {
	const key = extension || "(none)";
	stats.extensionCounts[key] = (stats.extensionCounts[key] ?? 0) + 1;
}

export async function buildTree(
	rootPath: string,
	options: TreeBuildOptions,
): Promise<TreeBuildResult> {
	const stats = createInitialStats();
	const warnings: string[] = [];
	const visitedRealPaths = new Set<string>();

	async function walk(
		absoluteDirectoryPath: string,
		relativeDirectoryPath: string,
		depth: number,
	): Promise<TreeNode[]> {
		if (depth > options.maxDepth) {
			return [];
		}

		if (depth > stats.maxDepthReached) {
			stats.maxDepthReached = depth;
		}

		let entries: import("node:fs").Dirent<string>[];

		try {
			entries = (await fs.readdir(absoluteDirectoryPath, {
				withFileTypes: true,
				encoding: "utf8",
			})) as import("node:fs").Dirent<string>[];
		} catch (error) {
			warnings.push(
				`Cannot read ${absoluteDirectoryPath}: ${String(error)}`,
			);
			incrementSkip(stats, classifyFsSkipReason(error));
			return [];
		}

		entries.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) {
				return a.isDirectory() ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

		const nodes: TreeNode[] = [];

		for (const entry of entries) {
			const absolutePath = path.join(absoluteDirectoryPath, entry.name);
			const relativePath = toRelativePath(
				relativeDirectoryPath,
				entry.name,
			);

			let lstat;
			try {
				lstat = await fs.lstat(absolutePath);
			} catch (error) {
				warnings.push(`Cannot stat ${absolutePath}: ${String(error)}`);
				incrementSkip(stats, classifyFsSkipReason(error));
				continue;
			}

			const isSymlink = lstat.isSymbolicLink();
			let isDirectory = entry.isDirectory();
			let effectiveAbsolutePath = absolutePath;

			if (isSymlink) {
				if (!options.followSymlinks) {
					incrementSkip(stats, "symlinkSkipped");
					continue;
				}

				try {
					const realPath = await fs.realpath(absolutePath);
					if (visitedRealPaths.has(realPath)) {
						warnings.push(
							`Circular symlink skipped: ${absolutePath}`,
						);
						incrementSkip(stats, "circularSymlink");
						continue;
					}

					visitedRealPaths.add(realPath);
					effectiveAbsolutePath = realPath;

					const stat = await fs.stat(realPath);
					isDirectory = stat.isDirectory();
				} catch (error) {
					warnings.push(
						`Cannot resolve symlink ${absolutePath}: ${String(error)}`,
					);
					incrementSkip(stats, classifyFsSkipReason(error));
					continue;
				}
			}

			if (options.shouldIgnore(relativePath, isDirectory)) {
				stats.ignored += 1;
				continue;
			}

			if (isDirectory) {
				stats.directories += 1;

				const nextDepth = depth + 1;
				const children =
					nextDepth <= options.maxDepth
						? await walk(
								effectiveAbsolutePath,
								relativePath,
								nextDepth,
							)
						: [];

				nodes.push({
					name: entry.name,
					type: "directory",
					children,
					isSymlink,
				});
			} else {
				const extension = path.extname(entry.name).toLowerCase();
				const binary =
					options.binaryHandling === "off"
						? false
						: await isBinaryFile(effectiveAbsolutePath, extension);

				if (binary && options.binaryHandling === "skip") {
					incrementSkip(stats, "binarySkipped");
					continue;
				}

				stats.files += 1;
				trackExtension(stats, extension);

				let measuredSize: number | undefined;
				if (isSymlink) {
					try {
						const stat = await fs.stat(effectiveAbsolutePath);
						measuredSize = stat.size;
					} catch {
						measuredSize = undefined;
					}
				} else {
					measuredSize = lstat.size;
				}

				if (typeof measuredSize === "number") {
					stats.totalSizeBytes += measuredSize;
				}

				const size = options.showFileSize ? measuredSize : undefined;

				nodes.push({
					name: entry.name,
					type: "file",
					size,
					extension,
					isBinary: binary,
					isSymlink,
				});
			}
		}

		return nodes;
	}

	const nodes = await walk(rootPath, "", 0);
	return { nodes, stats, warnings };
}
