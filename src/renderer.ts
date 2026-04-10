import path from "node:path";
import {
	DEFAULT_FILE,
	DEFAULT_FOLDER,
	getIconForFile,
	getIconForFolder,
} from "vscode-icons-js";
import {
	GenerationMetadata,
	RenderOptions,
	TreeNode,
	TreeStats,
} from "./types";

const VSCODE_ICONS_BASE_URL =
	"https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";
const TREE_BRANCH = "├── ";
const TREE_LAST_BRANCH = "└── ";
const TREE_INDENT = "│   ";
const TREE_BLANK = "    ";

function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatExtensionBreakdown(
	extensionCounts: Record<string, number>,
	limit = 5,
): string {
	const entries = Object.entries(extensionCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([ext, count]) => `${ext}: ${count}`);

	return entries.length > 0 ? entries.join(" | ") : "none";
}

function formatSkippedBreakdown(stats: TreeStats): string {
	const parts = [
		`binary: ${stats.skippedByReason.binarySkipped}`,
		`symlink: ${stats.skippedByReason.symlinkSkipped}`,
		`circular: ${stats.skippedByReason.circularSymlink}`,
		`permission: ${stats.skippedByReason.permissionDenied}`,
		`fs: ${stats.skippedByReason.fsError}`,
	];

	return parts.join(" | ");
}

function formatEffectiveSettings(metadata: GenerationMetadata): string {
	return [
		`maxDepth=${metadata.effectiveSettings.maxDepth}`,
		`followSymlinks=${metadata.effectiveSettings.followSymlinks}`,
		`binaryHandling=${metadata.effectiveSettings.binaryHandling}`,
		`iconMode=${metadata.effectiveSettings.iconMode}`,
		`exports=${metadata.effectiveSettings.exportFormats.join(",")}`,
	].join(" | ");
}

function normalizePathForMarkdown(inputPath: string): string {
	return inputPath.split(path.sep).join("/");
}

function formatTimestamp(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function iconImg(iconPath: string, alt: string): string {
	return `<img src=\"${iconPath}\" alt=\"${escapeHtml(alt)}\" width=\"16\" height=\"16\" /> `;
}

function resolveFileIcon(name: string): string {
	return getIconForFile(name) ?? DEFAULT_FILE;
}

function resolveFolderIcon(name: string): string {
	return getIconForFolder(name) || DEFAULT_FOLDER;
}

function resolveIconSrc(iconFile: string, options: RenderOptions): string {
	if (options.iconSource === "bundled") {
		return (
			options.bundledIconData?.[iconFile] ??
			`${VSCODE_ICONS_BASE_URL}/${iconFile}`
		);
	}

	if (options.iconSource === "local" && options.iconBasePath) {
		return `${options.iconBasePath}/${iconFile}`;
	}

	return `${VSCODE_ICONS_BASE_URL}/${iconFile}`;
}

export function collectIconFiles(
	rootName: string,
	nodes: TreeNode[],
): string[] {
	const iconFiles = new Set<string>();
	iconFiles.add(resolveFolderIcon(rootName));

	const walk = (items: TreeNode[]): void => {
		for (const node of items) {
			if (node.type === "directory") {
				iconFiles.add(resolveFolderIcon(node.name));
				if (node.children && node.children.length > 0) {
					walk(node.children);
				}
				continue;
			}

			iconFiles.add(resolveFileIcon(node.name));
		}
	};

	walk(nodes);

	return Array.from(iconFiles);
}

export function renderTree(
	nodes: TreeNode[],
	options: RenderOptions,
	prefix = "",
): string {
	return renderTreeLines(nodes, prefix, (node) => {
		const safeName = options.asciiOnly ? node.name : escapeHtml(node.name);

		const icon = options.asciiOnly
			? ""
			: node.type === "directory"
				? iconImg(
						resolveIconSrc(resolveFolderIcon(node.name), options),
						`${node.name} folder`,
					)
				: iconImg(
						resolveIconSrc(resolveFileIcon(node.name), options),
						`${node.name} file`,
					);

		const size =
			options.showFileSize && typeof node.size === "number"
				? ` (${formatSize(node.size)})`
				: "";
		const binaryLabel =
			node.isBinary && options.binaryHandling === "mark"
				? " [binary]"
				: "";
		const symlinkLabel = node.isSymlink ? " [symlink]" : "";
		const suffix = node.type === "directory" ? "/" : "";

		return `${icon}${safeName}${suffix}${size}${binaryLabel}${symlinkLabel}`;
	});
}

function renderTreeLines(
	nodes: TreeNode[],
	prefix: string,
	renderLabel: (node: TreeNode) => string,
): string {
	let output = "";

	nodes.forEach((node, index) => {
		const isLast = index === nodes.length - 1;
		const connector = isLast ? TREE_LAST_BRANCH : TREE_BRANCH;
		const childPrefix = prefix + (isLast ? TREE_BLANK : TREE_INDENT);

		output += `${prefix}${connector}${renderLabel(node)}\n`;

		if (node.children && node.children.length > 0) {
			output += renderTreeLines(node.children, childPrefix, renderLabel);
		}
	});

	return output;
}

function renderTreeBlock(params: {
	rootName: string;
	nodes: TreeNode[];
	options: RenderOptions;
}): string {
	const useHtmlIcons = !params.options.asciiOnly;
	const treeBody = useHtmlIcons
		? renderTree(params.nodes, params.options)
		: renderTree(params.nodes, {
				...params.options,
				asciiOnly: true,
			});
	const safeRootName = escapeHtml(params.rootName);
	const rootIcon = useHtmlIcons
		? iconImg(
				resolveIconSrc(
					resolveFolderIcon(params.rootName),
					params.options,
				),
				`${params.rootName} root folder`,
			)
		: "";

	return useHtmlIcons
		? [
				"<pre>",
				`${rootIcon}${safeRootName}/`,
				treeBody.trimEnd(),
				"</pre>",
			].join("\n")
		: ["```", `${params.rootName}/`, treeBody.trimEnd(), "```"].join("\n");
}

export function renderReadmeTreeSnippet(params: {
	rootName: string;
	nodes: TreeNode[];
	options: RenderOptions;
}): string {
	return renderTreeBlock(params);
}

export function renderMarkdown(params: {
	rootPath: string;
	rootName: string;
	stats: TreeStats;
	nodes: TreeNode[];
	options: RenderOptions;
	metadata: GenerationMetadata;
}): string {
	const now = formatTimestamp(new Date());
	const rootPath = normalizePathForMarkdown(params.rootPath);
	const topTypes = formatExtensionBreakdown(params.stats.extensionCounts);
	const skippedBreakdown = formatSkippedBreakdown(params.stats);
	const effectiveSettings = formatEffectiveSettings(params.metadata);
	const treeBlock = renderTreeBlock({
		rootName: params.rootName,
		nodes: params.nodes,
		options: params.options,
	});

	return [
		"# Project Tree",
		"",
		`> Generated: ${now}  `,
		`> Root: \`${rootPath}\`  `,
		`> Files: ${params.stats.files} | Directories: ${params.stats.directories} | Depth: ${params.stats.maxDepthReached}`,
		`> Scan Duration: ${params.metadata.scanDurationMs} ms  `,
		`> Total Size: ${formatSize(params.stats.totalSizeBytes)}  `,
		`> Ignored: ${params.stats.ignored} | Skipped: ${params.stats.skipped} (${skippedBreakdown})  `,
		`> Top Types: ${topTypes}  `,
		`> Effective Settings: ${effectiveSettings}`,
		"",
		"## Tree",
		"",
		treeBlock,
		"",
		"---",
		"*Generated by TreeScribe Extension. Edit `.projecttreeignore` to customize.*",
		"",
	].join("\n");
}

export function renderJson(params: {
	rootPath: string;
	rootName: string;
	stats: TreeStats;
	nodes: TreeNode[];
	metadata: GenerationMetadata;
}): string {
	return JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			rootPath: normalizePathForMarkdown(params.rootPath),
			rootName: params.rootName,
			metadata: params.metadata,
			stats: params.stats,
			nodes: params.nodes,
		},
		null,
		2,
	);
}

export function renderHtml(params: {
	rootPath: string;
	rootName: string;
	stats: TreeStats;
	nodes: TreeNode[];
	options: RenderOptions;
	metadata: GenerationMetadata;
}): string {
	const now = formatTimestamp(new Date());
	const rootPath = escapeHtml(normalizePathForMarkdown(params.rootPath));
	const topTypes = escapeHtml(
		formatExtensionBreakdown(params.stats.extensionCounts),
	);
	const skippedBreakdown = escapeHtml(formatSkippedBreakdown(params.stats));
	const effectiveSettings = escapeHtml(
		formatEffectiveSettings(params.metadata),
	);
	const treeBody = renderTreeLines(params.nodes, "", (node) => {
		const safeName = escapeHtml(node.name);
		const icon = params.options.asciiOnly
			? ""
			: node.type === "directory"
				? iconImg(
						resolveIconSrc(
							resolveFolderIcon(node.name),
							params.options,
						),
						`${node.name} folder`,
					)
				: iconImg(
						resolveIconSrc(
							resolveFileIcon(node.name),
							params.options,
						),
						`${node.name} file`,
					);

		const size =
			params.options.showFileSize && typeof node.size === "number"
				? ` (${formatSize(node.size)})`
				: "";
		const binaryLabel =
			node.isBinary && params.options.binaryHandling === "mark"
				? " [binary]"
				: "";
		const symlinkLabel = node.isSymlink ? " [symlink]" : "";
		const suffix = node.type === "directory" ? "/" : "";

		return `${icon}${safeName}${suffix}${size}${binaryLabel}${symlinkLabel}`;
	});

	const rootLabel = params.options.asciiOnly
		? `${escapeHtml(params.rootName)}/`
		: `${iconImg(resolveIconSrc(resolveFolderIcon(params.rootName), params.options), `${params.rootName} root folder`)}${escapeHtml(params.rootName)}/`;

	const treeBlock = ["<pre>", rootLabel, treeBody.trimEnd(), "</pre>"].join(
		"\n",
	);

	return [
		"<!doctype html>",
		'<html lang="en">',
		"<head>",
		'  <meta charset="utf-8" />',
		'  <meta name="viewport" content="width=device-width, initial-scale=1" />',
		"  <title>Project Tree</title>",
		"  <style>",
		"    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 24px; line-height: 1.4; color: #222; }",
		"    h1 { margin: 0 0 12px; font-size: 24px; }",
		"    .meta { margin: 0 0 16px; color: #555; }",
		"    pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow: auto; }",
		"    img { vertical-align: text-bottom; }",
		"  </style>",
		"</head>",
		"<body>",
		"  <h1>Project Tree</h1>",
		`  <p class=\"meta\">Generated: ${escapeHtml(now)}<br/>Root: ${rootPath}<br/>Files: ${params.stats.files} | Directories: ${params.stats.directories} | Depth: ${params.stats.maxDepthReached}<br/>Scan Duration: ${params.metadata.scanDurationMs} ms<br/>Total Size: ${escapeHtml(formatSize(params.stats.totalSizeBytes))}<br/>Ignored: ${params.stats.ignored} | Skipped: ${params.stats.skipped} (${skippedBreakdown})<br/>Top Types: ${topTypes}<br/>Effective Settings: ${effectiveSettings}</p>`,
		`  ${treeBlock}`,
		"</body>",
		"</html>",
		"",
	].join("\n");
}
