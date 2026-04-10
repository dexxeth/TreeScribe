import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { createIgnoreMatcher } from "./ignore";
import {
	collectIconFiles,
	renderHtml,
	renderJson,
	renderMarkdown,
	renderReadmeTreeSnippet,
} from "./renderer";
import { buildTree } from "./treeBuilder";
import { BinaryHandlingMode, GenerationMetadata } from "./types";

const VSCODE_ICONS_BASE_URL =
	"https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";
const BUNDLED_ICONS_DIRECTORY = "assets/icons";
const README_TREE_START = "<!-- PROJECT-TREE:START -->";
const README_TREE_END = "<!-- PROJECT-TREE:END -->";

type ExportFormat = "markdown" | "json" | "html";

interface ProjectTreeConfig {
	additionalIgnore: string[];
	maxDepth: number;
	showFileSize: boolean;
	followSymlinks: boolean;
	binaryHandling: BinaryHandlingMode;
	asciiOnly: boolean;
	iconSource: "bundled" | "local" | "remote";
	iconAssetsDirectory: string;
	outputFileName: string;
	outputJsonFileName: string;
	outputHtmlFileName: string;
	exportFormats: ExportFormat[];
	injectIntoReadme: boolean;
}

function getConfig(resource: vscode.Uri): ProjectTreeConfig {
	const config = vscode.workspace.getConfiguration("projectTree", resource);

	return {
		additionalIgnore: config.get<string[]>("additionalIgnore", []),
		maxDepth: config.get<number>("maxDepth", 10),
		showFileSize: config.get<boolean>("showFileSize", true),
		followSymlinks: config.get<boolean>("followSymlinks", false),
		binaryHandling: config.get<BinaryHandlingMode>(
			"binaryHandling",
			"mark",
		),
		asciiOnly: config.get<boolean>("asciiOnly", false),
		iconSource: config.get<"bundled" | "local" | "remote">(
			"iconSource",
			"bundled",
		),
		iconAssetsDirectory: config.get<string>(
			"iconAssetsDirectory",
			".project-tree-icons",
		),
		outputFileName: config.get<string>("outputFileName", "project_tree.md"),
		outputJsonFileName: config.get<string>(
			"outputJsonFileName",
			"project_tree.json",
		),
		outputHtmlFileName: config.get<string>(
			"outputHtmlFileName",
			"project_tree.html",
		),
		exportFormats: config.get<ExportFormat[]>("exportFormats", [
			"markdown",
		]),
		injectIntoReadme: config.get<boolean>("injectIntoReadme", true),
	};
}

function toSvgDataUri(svg: string): string {
	const encoded = encodeURIComponent(svg)
		.replace(/%0A/g, "")
		.replace(/%20/g, " ");

	return `data:image/svg+xml;utf8,${encoded}`;
}

async function loadBundledIconData(
	context: vscode.ExtensionContext,
	iconFiles: string[],
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};

	for (const iconFile of iconFiles) {
		const iconPath = context.asAbsolutePath(
			path.join(BUNDLED_ICONS_DIRECTORY, iconFile),
		);

		try {
			const svg = await fs.readFile(iconPath, "utf8");
			result[iconFile] = toSvgDataUri(svg);
		} catch {
			// Missing bundled icon falls back to remote URL in renderer.
		}
	}

	return result;
}

function normalizePathForMarkdown(inputPath: string): string {
	return inputPath.split(path.sep).join("/");
}

function resolvePathWithinRoot(
	rootPath: string,
	configuredPath: string,
	settingName: string,
): string {
	const trimmed = configuredPath.trim();
	if (!trimmed) {
		throw new Error(`${settingName} cannot be empty.`);
	}

	const resolvedPath = path.resolve(rootPath, trimmed);
	const relative = path.relative(rootPath, resolvedPath);

	if (!relative) {
		throw new Error(
			`${settingName} must point to a file or folder inside the selected root folder, not the root itself.`,
		);
	}

	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(
			`${settingName} must stay within the selected root folder.`,
		);
	}

	return resolvedPath;
}

function toRelativePathFromRoot(
	rootPath: string,
	absolutePath: string,
): string {
	return normalizePathForMarkdown(path.relative(rootPath, absolutePath));
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function ensureLocalIconAssets(
	rootPath: string,
	iconAssetsDirectory: string,
	iconFiles: string[],
): Promise<number> {
	const iconDirPath = path.join(rootPath, iconAssetsDirectory);
	await fs.mkdir(iconDirPath, { recursive: true });

	let downloaded = 0;

	for (const iconFile of iconFiles) {
		const iconPath = path.join(iconDirPath, iconFile);

		if (await fileExists(iconPath)) {
			continue;
		}

		const response = await fetch(`${VSCODE_ICONS_BASE_URL}/${iconFile}`);
		if (!response.ok) {
			continue;
		}

		const svg = await response.text();
		await fs.writeFile(iconPath, svg, "utf8");
		downloaded += 1;
	}

	return downloaded;
}

async function ensureGitignoreHasEntry(
	rootPath: string,
	relativeFilePath: string,
): Promise<boolean> {
	const gitignorePath = path.join(rootPath, ".gitignore");
	const normalizedEntry = relativeFilePath.split(path.sep).join("/");

	try {
		const current = await fs.readFile(gitignorePath, "utf8");
		const lines = current.split(/\r?\n/).map((line) => line.trim());

		if (lines.includes(normalizedEntry)) {
			return false;
		}

		const suffix = current.endsWith("\n") ? "" : "\n";
		await fs.writeFile(
			gitignorePath,
			`${current}${suffix}${normalizedEntry}\n`,
			"utf8",
		);
		return true;
	} catch {
		await fs.writeFile(gitignorePath, `${normalizedEntry}\n`, "utf8");
		return true;
	}
}

async function injectTreeIntoReadmeIfMarked(
	rootPath: string,
	treeSnippet: string,
): Promise<boolean> {
	const readmePath = path.join(rootPath, "README.md");

	let readme: string;
	try {
		readme = await fs.readFile(readmePath, "utf8");
	} catch {
		return false;
	}

	const startIndex = readme.indexOf(README_TREE_START);
	const endIndex = readme.indexOf(README_TREE_END);

	if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
		return false;
	}

	const before = readme.slice(0, startIndex + README_TREE_START.length);
	const after = readme.slice(endIndex);
	const updated = `${before}\n${treeSnippet.trimEnd()}\n${after}`;

	if (updated === readme) {
		return false;
	}

	await fs.writeFile(readmePath, updated, "utf8");
	return true;
}

async function resolveRootUriForCommand(
	resourceUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	if (resourceUri) {
		try {
			const stat = await fs.stat(resourceUri.fsPath);
			if (stat.isDirectory()) {
				return resourceUri;
			}
			return vscode.Uri.file(path.dirname(resourceUri.fsPath));
		} catch {
			return undefined;
		}
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		return workspaceFolder.uri;
	}

	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: "Generate Tree Here",
		title: "Select a folder for Project Tree",
	});

	if (!picked || picked.length === 0) {
		return undefined;
	}

	return picked[0];
}

function normalizeExportFormats(
	formats: ExportFormat[],
	allowEmpty = false,
): ExportFormat[] {
	const valid = formats.filter((format) =>
		["markdown", "json", "html"].includes(format),
	);

	if (valid.length === 0 && !allowEmpty) {
		return ["markdown"];
	}

	return Array.from(new Set(valid));
}

async function runGenerateCommand(
	context: vscode.ExtensionContext,
	resourceUri?: vscode.Uri,
): Promise<void> {
	const rootUri = await resolveRootUriForCommand(resourceUri);
	if (!rootUri) {
		vscode.window.showErrorMessage(
			"Could not resolve a folder for project tree generation.",
		);
		return;
	}

	const rootPath = rootUri.fsPath;
	const rootName = path.basename(rootPath);
	const config = getConfig(rootUri);
	const configuredExportFormats = normalizeExportFormats(
		config.exportFormats,
	);

	let markdownOutputPath: string;
	let jsonOutputPath: string;
	let htmlOutputPath: string;
	let localIconDirectoryPathFromConfig: string;

	try {
		markdownOutputPath = resolvePathWithinRoot(
			rootPath,
			config.outputFileName,
			"projectTree.outputFileName",
		);
		jsonOutputPath = resolvePathWithinRoot(
			rootPath,
			config.outputJsonFileName,
			"projectTree.outputJsonFileName",
		);
		htmlOutputPath = resolvePathWithinRoot(
			rootPath,
			config.outputHtmlFileName,
			"projectTree.outputHtmlFileName",
		);
		localIconDirectoryPathFromConfig = resolvePathWithinRoot(
			rootPath,
			config.iconAssetsDirectory,
			"projectTree.iconAssetsDirectory",
		);
	} catch (error) {
		vscode.window.showErrorMessage(String(error));
		return;
	}

	const iconChoice = await vscode.window.showQuickPick(
		[
			{
				label: "With Icons",
				description: "Include icons in Markdown/HTML output",
				value: true,
			},
			{
				label: "Without Icons",
				description: "Text-only tree output",
				value: false,
			},
		],
		{
			placeHolder: "Generate project tree with icons?",
		},
	);

	if (!iconChoice) {
		return;
	}

	const formatChoice = await vscode.window.showQuickPick(
		[
			{
				label: "Markdown",
				description: config.outputFileName,
				value: "markdown" as ExportFormat,
				picked: configuredExportFormats.includes("markdown"),
			},
			{
				label: "JSON",
				description: config.outputJsonFileName,
				value: "json" as ExportFormat,
				picked: configuredExportFormats.includes("json"),
			},
			{
				label: "HTML",
				description: config.outputHtmlFileName,
				value: "html" as ExportFormat,
				picked: configuredExportFormats.includes("html"),
			},
		],
		{
			canPickMany: true,
			placeHolder: "Select export formats for this run",
		},
	);

	if (!formatChoice) {
		return;
	}

	const exportFormats = normalizeExportFormats(
		formatChoice.map((item) => item.value),
		true,
	);

	if (exportFormats.length === 0) {
		vscode.window.showWarningMessage(
			"Select at least one export format to generate project tree output.",
		);
		return;
	}

	const includeIcons = iconChoice.value;
	const asciiOnlyForRun = !includeIcons;
	const iconModeForRun = asciiOnlyForRun ? "none" : config.iconSource;
	const markdownOutputRelative = toRelativePathFromRoot(
		rootPath,
		markdownOutputPath,
	);
	const jsonOutputRelative = toRelativePathFromRoot(rootPath, jsonOutputPath);
	const htmlOutputRelative = toRelativePathFromRoot(rootPath, htmlOutputPath);
	const localIconDirectoryRelative = toRelativePathFromRoot(
		rootPath,
		localIconDirectoryPathFromConfig,
	);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Generating project tree",
			cancellable: false,
		},
		async (progress) => {
			progress.report({ message: "Loading ignore rules..." });
			const ignoreMatcher = await createIgnoreMatcher(
				rootPath,
				config.additionalIgnore,
			);

			progress.report({ message: "Traversing files..." });
			const scanStart = Date.now();
			const result = await buildTree(rootPath, {
				maxDepth: config.maxDepth,
				showFileSize: config.showFileSize,
				followSymlinks: config.followSymlinks,
				binaryHandling: config.binaryHandling,
				shouldIgnore: ignoreMatcher,
			});
			const scanDurationMs = Date.now() - scanStart;

			const metadata: GenerationMetadata = {
				scanDurationMs,
				effectiveSettings: {
					maxDepth: config.maxDepth,
					followSymlinks: config.followSymlinks,
					binaryHandling: config.binaryHandling,
					iconMode: iconModeForRun,
					exportFormats,
				},
			};

			let bundledIconData: Record<string, string> | undefined;
			let localIconDirectoryPath: string | undefined;

			if (!asciiOnlyForRun && config.iconSource === "local") {
				progress.report({ message: "Preparing local icon assets..." });

				const iconFiles = collectIconFiles(rootName, result.nodes);
				await ensureLocalIconAssets(
					rootPath,
					localIconDirectoryRelative,
					iconFiles,
				);

				localIconDirectoryPath = localIconDirectoryPathFromConfig;
			} else if (!asciiOnlyForRun && config.iconSource === "bundled") {
				progress.report({ message: "Loading bundled icon assets..." });

				const iconFiles = collectIconFiles(rootName, result.nodes);
				bundledIconData = await loadBundledIconData(context, iconFiles);
			}

			const createRenderOptions = (
				outputPathForFormat: string,
			): {
				showFileSize: boolean;
				asciiOnly: boolean;
				binaryHandling: BinaryHandlingMode;
				iconSource: "bundled" | "local" | "remote";
				iconBasePath?: string;
				bundledIconData?: Record<string, string>;
			} => {
				let iconBasePath: string | undefined;

				if (localIconDirectoryPath) {
					iconBasePath = normalizePathForMarkdown(
						path.relative(
							path.dirname(outputPathForFormat),
							localIconDirectoryPath,
						),
					);
				}

				return {
					showFileSize: config.showFileSize,
					asciiOnly: asciiOnlyForRun,
					binaryHandling: config.binaryHandling,
					iconSource: config.iconSource,
					iconBasePath,
					bundledIconData,
				};
			};

			progress.report({ message: "Rendering output files..." });

			const writtenFiles: string[] = [];

			if (exportFormats.includes("markdown")) {
				const markdown = renderMarkdown({
					rootPath,
					rootName,
					metadata,
					stats: result.stats,
					nodes: result.nodes,
					options: createRenderOptions(markdownOutputPath),
				});

				await fs.mkdir(path.dirname(markdownOutputPath), {
					recursive: true,
				});
				await fs.writeFile(markdownOutputPath, markdown, "utf8");
				writtenFiles.push(markdownOutputRelative);
				await ensureGitignoreHasEntry(rootPath, markdownOutputRelative);
			}

			if (exportFormats.includes("json")) {
				const json = renderJson({
					rootPath,
					rootName,
					metadata,
					stats: result.stats,
					nodes: result.nodes,
				});

				await fs.mkdir(path.dirname(jsonOutputPath), {
					recursive: true,
				});
				await fs.writeFile(jsonOutputPath, json, "utf8");
				writtenFiles.push(jsonOutputRelative);
				await ensureGitignoreHasEntry(rootPath, jsonOutputRelative);
			}

			if (exportFormats.includes("html")) {
				const html = renderHtml({
					rootPath,
					rootName,
					metadata,
					stats: result.stats,
					nodes: result.nodes,
					options: createRenderOptions(htmlOutputPath),
				});

				await fs.mkdir(path.dirname(htmlOutputPath), {
					recursive: true,
				});
				await fs.writeFile(htmlOutputPath, html, "utf8");
				writtenFiles.push(htmlOutputRelative);
				await ensureGitignoreHasEntry(rootPath, htmlOutputRelative);
			}

			if (!asciiOnlyForRun && config.iconSource === "local") {
				await ensureGitignoreHasEntry(
					rootPath,
					localIconDirectoryRelative,
				);
			}

			let readmeUpdated = false;
			if (config.injectIntoReadme) {
				const readmePath = path.join(rootPath, "README.md");
				const snippet = renderReadmeTreeSnippet({
					rootName,
					nodes: result.nodes,
					options: {
						...createRenderOptions(readmePath),
						asciiOnly: true,
					},
				});
				readmeUpdated = await injectTreeIntoReadmeIfMarked(
					rootPath,
					snippet,
				);
			}

			const warningsSummary =
				result.warnings.length > 0
					? ` (${result.warnings.length} warnings)`
					: "";

			const outputSummary =
				writtenFiles.length > 0 ? writtenFiles.join(", ") : "No files";
			vscode.window.showInformationMessage(
				`Project tree generated: ${outputSummary}. Files: ${result.stats.files}, directories: ${result.stats.directories}${warningsSummary}.`,
			);

			if (readmeUpdated) {
				vscode.window.showInformationMessage(
					"README markers found and updated.",
				);
			}

			if (writtenFiles.length > 0) {
				const firstOutputPath = exportFormats.includes("markdown")
					? markdownOutputPath
					: exportFormats.includes("html")
						? htmlOutputPath
						: jsonOutputPath;

				const doc =
					await vscode.workspace.openTextDocument(firstOutputPath);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
		},
	);
}

export function activate(context: vscode.ExtensionContext): void {
	const generateDisposable = vscode.commands.registerCommand(
		"projectTree.generate",
		async () => {
			await runGenerateCommand(context);
		},
	);

	const generateFromHereDisposable = vscode.commands.registerCommand(
		"projectTree.generateFromHere",
		async (resourceUri?: vscode.Uri) => {
			await runGenerateCommand(context, resourceUri);
		},
	);

	context.subscriptions.push(generateDisposable, generateFromHereDisposable);
}

export function deactivate(): void {
	// No-op.
}
